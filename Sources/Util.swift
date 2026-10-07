import AppKit
import CryptoKit

/// Réglages de test : VERRE_SUPPORT, VERRE_WEB, VERRE_DEBUG, VERRE_NO_VOLUMES, VERRE_SNAPSHOT…
let env = ProcessInfo.processInfo.environment

/// Dossiers de l'app dans ~/Library/Application Support/Verre
/// (VERRE_SUPPORT permet d'utiliser un autre dossier, pour les tests)
enum Paths {
    static let support: URL = {
        let u = env["VERRE_SUPPORT"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Verre", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()

    private static func dir(_ name: String) -> URL {
        let u = support.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    static let art = dir("art")        // pochettes extraites des fichiers audio
    static let images = dir("images")  // affiches, fonds et vignettes
    static let tmdb = dir("tmdb")      // réponses TMDB en cache
}

func readJSON<T: Decodable>(_ type: T.Type, _ file: String) -> T? {
    guard let data = try? Data(contentsOf: Paths.support.appendingPathComponent(file)) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
}

func writeJSON<T: Encodable>(_ value: T, _ file: String) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    try? data.write(to: Paths.support.appendingPathComponent(file), options: .atomic)
}

extension Encodable {
    var json: String { (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? "null" }
}

private let hexDigits = Array("0123456789abcdef".utf8)

/// Identifiant court et stable : 20 caractères hexadécimaux du SHA-256
func sha(_ s: String) -> String {
    var out: [UInt8] = []
    out.reserveCapacity(20)
    for b in SHA256.hash(data: Data(s.utf8)).prefix(10) { out += [hexDigits[Int(b >> 4)], hexDigits[Int(b & 15)]] }
    return String(decoding: out, as: UTF8.self)
}

/// Normalise un titre pour comparer (minuscules, sans accents ni ponctuation)
func normalized(_ s: String) -> String {
    s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
}

func writeJPEG(_ cg: CGImage, to url: URL) -> Bool {
    guard let data = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.84]) else { return false }
    return (try? data.write(to: url, options: .atomic)) != nil
}

/// Quatre couleurs tirées d'une image : trois vives puis une sombre (pour le fond « verre »)
func palette(of url: URL) -> [String]? {
    guard let img = NSImage(contentsOf: url),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    let w = 24, h = 24
    var px = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.interpolationQuality = .medium
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

    struct Bucket { var r = 0.0, g = 0.0, b = 0.0, n = 0 }
    var buckets: [Int: Bucket] = [:]
    for i in stride(from: 0, to: px.count, by: 4) {
        let r = Int(px[i]), g = Int(px[i + 1]), b = Int(px[i + 2])
        let k = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5)
        var e = buckets[k] ?? Bucket()
        e.r += Double(r); e.g += Double(g); e.b += Double(b); e.n += 1
        buckets[k] = e
    }
    struct C { var r, g, b: Double; var n: Int; var s: Double; var l: Double }
    let colors: [C] = buckets.values.map { e in
        let r = e.r / Double(e.n) / 255, g = e.g / Double(e.n) / 255, b = e.b / Double(e.n) / 255
        let mx = max(r, g, b), mn = min(r, g, b), l = (mx + mn) / 2
        let s = mx == mn ? 0 : (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn))
        return C(r: r, g: g, b: b, n: e.n, s: s, l: l)
    }
    guard !colors.isEmpty else { return nil }
    let score = { (c: C) in Double(c.n) * (0.25 + c.s) * (1 - abs(c.l - 0.5)) }
    let vivid = colors.sorted { score($0) > score($1) }
    var pick: [C] = []
    for c in vivid where pick.count < 3 {
        if pick.allSatisfy({ abs($0.r - c.r) + abs($0.g - c.g) + abs($0.b - c.b) > 0.25 }) { pick.append(c) }
    }
    while pick.count < 3 { pick.append(vivid[pick.count % vivid.count]) }
    let dark = colors.min { $0.l < $1.l }!
    let hex = { (c: C) in String(format: "#%02X%02X%02X", Int(c.r * 255), Int(c.g * 255), Int(c.b * 255)) }
    return pick.map(hex) + [hex(dark)]
}

/// Retire les marques de direction invisibles (U+200E…) et les espaces que TMDB laisse parfois dans les titres
func cleanTitle(_ s: String) -> String {
    s.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{FEFF}")))
}
