import AppKit
import WebKit

/// La vue web qui affiche l'interface. La bande du haut (28 px) sert à déplacer la fenêtre,
/// comme une barre de titre (double-clic : agrandir).
final class AppWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let fromTop = isFlipped ? p.y : bounds.height - p.y
        if fromTop < 28, let window, !window.styleMask.contains(.fullScreen) {
            if event.clickCount == 2 { window.performZoom(nil) } else { window.performDrag(with: event) }
            return
        }
        super.mouseDown(with: event)
    }
}

extension NSWindow {
    /// boutons fermer, réduire, agrandir
    var trafficLights: [NSButton] { [.closeButton, .miniaturizeButton, .zoomButton].compactMap(standardWindowButton) }
}

/// Fenêtre dont les boutons fermer / réduire / agrandir sont placés à l'intérieur
/// du panneau de verre de la barre latérale (et non sur son coin arrondi).
final class AppWindow: NSWindow {
    /// centre du bouton « fermer », mesuré depuis le coin haut gauche de la fenêtre
    static let firstButtonCenter = NSPoint(x: 32, y: 32)
    private var spacing: CGFloat?
    private var placing = false
    private var observing = false

    // AppKit recalcule la barre de titre à chaque mise en page : on repasse derrière lui
    override func layoutIfNeeded() {
        super.layoutIfNeeded()
        placeTrafficLights()
    }

    func placeTrafficLights() {
        let buttons = trafficLights
        guard !placing, !styleMask.contains(.fullScreen), buttons.count == 3, let container = buttons[0].superview?.superview else { return }
        placing = true
        defer { placing = false }
        if !observing {
            observing = true
            for v in [container, buttons[0]] {
                v.postsFrameChangedNotifications = true
                NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: v, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.placeTrafficLights() }
                }
            }
        }
        let step = spacing ?? max(18, buttons[1].frame.minX - buttons[0].frame.minX)
        spacing = step
        let size = buttons[0].frame.size, c = Self.firstButtonCenter
        // zone de titre réduite au coin des boutons : le reste du haut de la fenêtre reste cliquable dans l'interface
        let height = c.y * 2, width = c.x + step * 2 + size.width / 2 + 14
        container.frame = NSRect(x: 0, y: frame.height - height, width: width, height: height)
        for (i, b) in buttons.enumerated() {
            b.setFrameOrigin(NSPoint(x: c.x - size.width / 2 + CGFloat(i) * step, y: (height - size.height) / 2))
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: AppWindow!
    var webView: AppWebView!
    let library = Library()
    lazy var bridge = Bridge(library: library)

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()

        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.preferences.isElementFullscreenEnabled = true
        cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        // les fichiers (morceaux, vidéos, images) passent par l'app : l'interface ne lit pas le disque elle-même
        let library = self.library
        cfg.setURLSchemeHandler(MediaSchemeHandler(allowed: { path in MainActor.assumeIsolated { library.isAllowedMedia(path) } }),
                                forURLScheme: MediaSchemeHandler.scheme)

        webView = AppWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: cfg)
        webView.navigationDelegate = self
        webView.isInspectable = env["VERRE_DEBUG"] == "1"
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]

        let window = AppWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                               styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                               backing: .buffered, defer: false)
        self.window = window
        window.title = "Écho"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.039, green: 0.039, blue: 0.063, alpha: 1)   // même fond que l'interface (#0a0a10)
        window.minSize = NSSize(width: 960, height: 620)
        window.collectionBehavior = [.fullScreenPrimary]
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("Verre")
        bridge.webView = webView
        bridge.window = window
        // boutons de fenêtre cachés pendant l'animation de lancement
        window.trafficLights.forEach { $0.alphaValue = 0 }
        // AppKit replace les boutons à chaque redimensionnement / plein écran / activation : on les remet en place
        window.placeTrafficLights()
        for name in [NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didExitFullScreenNotification,
                     NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification, NSWindow.didChangeScreenNotification] {
            NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { _ in
                MainActor.assumeIsolated { window.placeTrafficLights() }
            }
        }

        // VERRE_WEB : charger l'interface depuis le dossier du projet (développement)
        let webDir = env["VERRE_WEB"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        // lecture autorisée uniquement dans le dossier de l'interface
        webView.loadFileURL(webDir.appendingPathComponent("index.html"), allowingReadAccessTo: webDir)

        window.makeKeyAndOrderFront(nil)
        DispatchQueue.main.async { window.placeTrafficLights() }
        NSApp.activate(ignoringOtherApps: true)
        library.start()
        debugSnapshot()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // Sécurité : la fenêtre n'affiche que l'interface de Verre. Tout autre chargement est refusé
    // (ex. un fichier glissé sur la fenêtre) ; les liens web éventuels s'ouvrent dans le navigateur.
    private var interfaceLoaded = false
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        if !interfaceLoaded, action.targetFrame?.isMainFrame == true, url?.isFileURL == true, url?.lastPathComponent == "index.html" {
            decisionHandler(.allow); return
        }
        if action.navigationType == .linkActivated, let url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { interfaceLoaded = true }

    // MARK: menus

    private func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem(); let menu = NSMenu(title: title)
            items.forEach(menu.addItem); item.submenu = menu; main.addItem(item)
        }
        func item(_ t: String, _ a: Selector?, _ k: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = mods; return i
        }
        add("Écho", [
            item("À propos d’Écho", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Réglages…", #selector(openSettings), ","),
            .separator(),
            item("Masquer Écho", #selector(NSApplication.hide(_:)), "h"),
            item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            item("Quitter Écho", #selector(NSApplication.terminate(_:)), "q"),
        ])
        add("Fichier", [item("Nouvelle playlist", #selector(newPlaylist), "n")])
        add("Édition", [
            item("Annuler", Selector(("undo:")), "z"), item("Rétablir", Selector(("redo:")), "z", [.command, .shift]), .separator(),
            item("Couper", #selector(NSText.cut(_:)), "x"), item("Copier", #selector(NSText.copy(_:)), "c"),
            item("Coller", #selector(NSText.paste(_:)), "v"), item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
            .separator(), item("Rechercher", #selector(focusSearch), "f"),
        ])
        add("Lecture", [
            item("Lecture / Pause", #selector(togglePlay), "p"),
            item("Suivant", #selector(nextTrack), String(Character(UnicodeScalar(NSRightArrowFunctionKey)!))),
            item("Précédent", #selector(prevTrack), String(Character(UnicodeScalar(NSLeftArrowFunctionKey)!))),
        ])
        add("Présentation", [
            item("Albums", #selector(showView(_:)), "1"), item("Films", #selector(showView(_:)), "2"), item("Séries", #selector(showView(_:)), "3"),
            .separator(), item("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        add("Fenêtre", [item("Réduire", #selector(NSWindow.miniaturize(_:)), "m"), item("Fermer", #selector(NSWindow.performClose(_:)), "w")])
        NSApp.mainMenu = main
    }

    private func menu(_ action: String) { bridge.emit("menu", action.json) }
    @objc func openSettings() { menu("settings") }
    @objc func newPlaylist() { menu("new-playlist") }
    @objc func focusSearch() { menu("search") }
    @objc func togglePlay() { menu("toggle") }
    @objc func nextTrack() { menu("next") }
    @objc func prevTrack() { menu("prev") }
    @objc func showView(_ sender: NSMenuItem) { menu(["1": "albums", "2": "movies", "3": "shows"][sender.keyEquivalent] ?? "albums") }

    // MARK: capture de la fenêtre pour vérifier l'interface (VERRE_SNAPSHOT=chemin.png)

    private func debugSnapshot() {
        guard let path = env["VERRE_SNAPSHOT"] else { return }
        let delay = Double(env["VERRE_SNAPSHOT_DELAY"] ?? "") ?? 6
        Task { @MainActor in
            if let js = env["VERRE_EVAL"] {
                try? await Task.sleep(nanoseconds: UInt64((delay - 2) * 1e9))
                _ = try? await webView.evaluateJavaScript(js)
                let after = Double(env["VERRE_EVAL_AFTER"] ?? "") ?? 2   // temps laissé au script de test
                try? await Task.sleep(nanoseconds: UInt64(after * 1e9))
            } else {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1e9))
            }
            let img = try? await webView.takeSnapshot(configuration: nil)
            if let tiff = img?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: path))
            }
            if env["VERRE_QUIT"] == "1" { NSApp.terminate(nil) }
        }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
