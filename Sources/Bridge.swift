import AppKit
import MediaPlayer
import WebKit

/// Pont entre l'interface (JavaScript) et le Mac.
/// JS : `await window.webkit.messageHandlers.native.postMessage({cmd, args})`
/// Mac → JS : `Native.emit(évènement, données)`
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?
    weak var window: NSWindow?
    let library: Library

    init(library: Library) {
        self.library = library
        super.init()
        library.onEvent = { [weak self] event, json in self?.emit(event, json) }
        setupRemoteCommands()
    }

    func emit(_ event: String, _ json: String) {
        webView?.evaluateJavaScript("window.Native && Native.emit(\(event.json), \(json))", completionHandler: nil)
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "message invalide"); return
        }
        let args = body["args"] as? [String: Any] ?? [:]
        Task { @MainActor in
            do { replyHandler(try await self.handle(cmd, args), nil) }
            catch { replyHandler(nil, error.localizedDescription) }
        }
    }

    private func handle(_ cmd: String, _ a: [String: Any]) async throws -> Any? {
        let lib = library
        switch cmd {
        case "state":
            return lib.stateJSON()

        case "addFolder":
            let kind = a["kind"] as? String ?? "music"
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = true
            panel.prompt = "Ajouter"
            panel.message = kind == "music" ? "Choisissez le dossier où se trouve votre musique" : "Choisissez un dossier de films ou de séries"
            guard let window, await panel.beginSheetModal(for: window) == .OK else { return false }
            for u in panel.urls {
                if kind == "music" { if !lib.settings.musicFolders.contains(u.path) { lib.settings.musicFolders.append(u.path) } }
                else if !lib.settings.videoFolders.contains(u.path) { lib.settings.videoFolders.append(u.path) }
            }
            lib.saveSettings()
            lib.refresh()
            return true

        case "removeFolder":
            let path = a["path"] as? String ?? ""
            lib.settings.musicFolders.removeAll { $0 == path }
            lib.settings.videoFolders.removeAll { $0 == path }
            lib.saveSettings()
            lib.refresh()
            return true

        case "rescan":
            lib.refresh(retryUnmatched: true)
            return true

        case "setKey":
            try await lib.setKey(a["key"] as? String ?? "")
            return true

        case "search":
            return try await lib.search(a["kind"] as? String ?? "movie", a["query"] as? String ?? "")

        case "setMatch":
            guard let key = a["key"] as? String, let id = (a["id"] as? NSNumber)?.intValue else { return false }
            lib.setMatch(key, id)
            return true

        case "playlistCreate":
            return lib.playlistCreate(a["name"] as? String ?? "", a["tracks"] as? [String] ?? [])
        case "playlistRename":
            lib.playlistRename(a["id"] as? String ?? "", a["name"] as? String ?? ""); return true
        case "playlistDelete":
            lib.playlistDelete(a["id"] as? String ?? ""); return true
        case "playlistAdd":
            return lib.playlistAdd(a["id"] as? String ?? "", a["tracks"] as? [String] ?? [])
        case "playlistRemove":
            lib.playlistRemove(a["id"] as? String ?? "", (a["index"] as? NSNumber)?.intValue ?? -1); return true
        case "playlistMove":
            lib.playlistMove(a["id"] as? String ?? "", (a["from"] as? NSNumber)?.intValue ?? -1, (a["to"] as? NSNumber)?.intValue ?? 0); return true

        case "saveProgress":
            guard let id = a["id"] as? String else { return false }
            lib.saveProgress(id, (a["pos"] as? NSNumber)?.doubleValue ?? 0, (a["dur"] as? NSNumber)?.doubleValue ?? 0)
            return true

        case "openExternal":
            // MKV, AVI… : ouverts dans Elmedia Player s'il est installé, sinon l'app par défaut
            // uniquement un fichier vidéo de la bibliothèque
            guard let path = a["path"] as? String, lib.isLibraryVideo(path) else { return false }
            let url = URL(fileURLWithPath: path), fallback = "/Applications/Elmedia Player.app"
            if let elmedia = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.Eltima.ElmediaPlayer")
                ?? (FileManager.default.fileExists(atPath: fallback) ? URL(fileURLWithPath: fallback) : nil) {
                _ = try? await NSWorkspace.shared.open([url], withApplicationAt: elmedia, configuration: .init())
            } else {
                NSWorkspace.shared.open(url)
            }
            return true

        case "reveal":
            // uniquement un fichier de la bibliothèque
            guard let path = a["path"] as? String, lib.isAllowedMedia(path) else { return false }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            return true

        case "openURL":
            // seuls les liens vers TMDB (création de compte, clé d'API) sont utilisés par l'interface
            if let s = a["url"] as? String, let u = URL(string: s), u.scheme == "https",
               u.host == "www.themoviedb.org" || u.host == "themoviedb.org" { NSWorkspace.shared.open(u) }
            return true

        case "log":
            // erreurs de l'interface, affichées seulement en mode débogage (VERRE_DEBUG=1)
            if env["VERRE_DEBUG"] == "1" { print("[interface]", a["msg"] as? String ?? "") }
            return true

        case "toggleFullScreen":
            window?.toggleFullScreen(nil)
            return true

        case "windowButtons":
            let visible = a["visible"] as? Bool ?? true, alpha: CGFloat = visible ? 1 : 0
            window?.trafficLights.forEach { $0.isEnabled = visible }   // cachés = inactifs
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.5
                window?.trafficLights.forEach { $0.animator().alphaValue = alpha }
            }, completionHandler: nil)
            return true

        case "nowPlaying":
            updateNowPlaying(a)
            return true

        default:
            throw NSError(domain: "Écho", code: 1, userInfo: [NSLocalizedDescriptionKey: "commande inconnue : \(cmd)"])
        }
    }

    // MARK: « À l'écoute » de macOS et touches média du clavier

    private var artworkURL: String?
    private var artwork: MPMediaItemArtwork?

    private func updateNowPlaying(_ a: [String: Any]) {
        let center = MPNowPlayingInfoCenter.default()
        guard let title = a["title"] as? String else {
            center.nowPlayingInfo = nil
            center.playbackState = .stopped
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: a["artist"] as? String ?? "",
            MPMediaItemPropertyAlbumTitle: a["album"] as? String ?? "",
            MPMediaItemPropertyPlaybackDuration: (a["duration"] as? NSNumber)?.doubleValue ?? 0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: (a["position"] as? NSNumber)?.doubleValue ?? 0,
            MPNowPlayingInfoPropertyPlaybackRate: (a["playing"] as? Bool ?? false) ? 1.0 : 0.0,
        ]
        if let art = a["art"] as? String, let artPath = mediaPath(art) {
            if art != artworkURL, let img = NSImage(contentsOfFile: artPath) {
                artworkURL = art
                artwork = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
            }
            if art == artworkURL, let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        }
        center.nowPlayingInfo = info
        center.playbackState = (a["playing"] as? Bool ?? false) ? .playing : .paused
    }

    private func setupRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        let map: [(MPRemoteCommand, String)] = [(c.playCommand, "play"), (c.pauseCommand, "pause"), (c.togglePlayPauseCommand, "toggle"),
                                                (c.nextTrackCommand, "next"), (c.previousTrackCommand, "prev")]
        for (cmd, name) in map {
            cmd.isEnabled = true
            cmd.addTarget { [weak self] _ in
                MainActor.assumeIsolated { self?.emit("remote", name.json) }
                return .success
            }
        }
        c.changePlaybackPositionCommand.isEnabled = true
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            let pos = (e as? MPChangePlaybackPositionCommandEvent)?.positionTime ?? 0
            MainActor.assumeIsolated { self?.emit("seek", String(pos)) }
            return .success
        }
    }
}
