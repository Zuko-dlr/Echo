import Foundation
import UniformTypeIdentifiers
import WebKit

/// Adresse interne d'un fichier de la bibliothèque (morceau, vidéo, pochette…).
/// L'interface ne lit jamais le disque elle-même : c'est l'app qui lui transmet les fichiers autorisés.
/// Indispensable pour les disques externes, que les processus cloisonnés de WebKit ne peuvent pas lire.
func mediaURL(_ path: String) -> String {
    var c = URLComponents()
    c.scheme = MediaSchemeHandler.scheme
    c.host = "local"
    c.path = path
    return c.url?.absoluteString ?? ""
}

/// Chemin du fichier correspondant à une adresse interne (ou à une ancienne adresse file://)
func mediaPath(_ url: String) -> String? {
    guard let u = URL(string: url) else { return nil }
    if u.scheme == MediaSchemeHandler.scheme || u.isFileURL { return u.path }
    return nil
}

/// Sert les fichiers autorisés à l'interface, avec prise en charge des plages d'octets (« Range »)
/// dont les lecteurs audio et vidéo ont besoin pour démarrer vite et se déplacer dans un morceau.
final class MediaSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "verre-media"
    private static let rangeRE = try! NSRegularExpression(pattern: #"bytes=(\d*)-(\d*)"#)
    private let allowed: (String) -> Bool
    private var stopped = Set<ObjectIdentifier>()
    private let io = DispatchQueue(label: "verre.media", qos: .userInitiated, attributes: .concurrent)

    init(allowed: @escaping (String) -> Bool) { self.allowed = allowed }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        stopped.remove(id)
        guard let url = task.request.url, url.host == "local" else { return fail(task, url: task.request.url, 400) }
        let path = url.path
        guard allowed(path),
              let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.int64Value, size > 0 else {
            return fail(task, url: url, 404)
        }

        var start: Int64 = 0, end: Int64 = size - 1, partial = false
        if let range = task.request.value(forHTTPHeaderField: "Range"),
           let m = Self.rangeRE.firstMatch(in: range, range: NSRange(range.startIndex..., in: range)) {
            let a = Range(m.range(at: 1), in: range).flatMap { Int64(range[$0]) }
            let b = Range(m.range(at: 2), in: range).flatMap { Int64(range[$0]) }
            if let a { start = a; end = min(b ?? size - 1, size - 1) }
            else if let b { start = max(0, size - b) }          // « bytes=-N » : les N derniers octets
            partial = true
            guard start <= end else { return fail(task, url: url, 416) }
        }
        let length = end - start + 1
        var headers = ["Content-Type": Self.mime(path), "Content-Length": String(length), "Accept-Ranges": "bytes", "Cache-Control": "no-store"]
        if partial { headers["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
        task.didReceive(HTTPURLResponse(url: url, statusCode: partial ? 206 : 200, httpVersion: "HTTP/1.1", headerFields: headers)!)

        io.async { [weak self] in
            guard let fh = FileHandle(forReadingAtPath: path) else {
                DispatchQueue.main.async { self?.finish(task, id, failed: true) }; return
            }
            defer { try? fh.close() }
            try? fh.seek(toOffset: UInt64(start))
            var remaining = length
            while remaining > 0 {
                guard let data = try? fh.read(upToCount: Int(min(remaining, 1 << 20))), !data.isEmpty else { break }
                remaining -= Int64(data.count)
                var cancelled = false
                DispatchQueue.main.sync {
                    if self == nil || self!.stopped.contains(id) { cancelled = true } else { task.didReceive(data) }
                }
                if cancelled { return }
            }
            DispatchQueue.main.async { self?.finish(task, id, failed: remaining > 0) }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func finish(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, failed: Bool = false) {
        if stopped.remove(id) != nil { return }   // WebKit a annulé : il ne faut plus rien lui envoyer
        if failed { task.didFailWithError(URLError(.cannotOpenFile)) } else { task.didFinish() }
    }

    private func fail(_ task: WKURLSchemeTask, url: URL?, _ code: Int) {
        if let url { task.didReceive(HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!) }
        task.didFinish()
    }

    private static let mimeTypes = [
        "mp3": "audio/mpeg", "m4a": "audio/mp4", "m4b": "audio/mp4", "aac": "audio/aac", "flac": "audio/flac",
        "wav": "audio/wav", "aif": "audio/aiff", "aiff": "audio/aiff", "caf": "audio/x-caf", "alac": "audio/mp4",
        "mp4": "video/mp4", "m4v": "video/x-m4v", "mov": "video/quicktime",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"]

    private static func mime(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        return mimeTypes[ext] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
}
