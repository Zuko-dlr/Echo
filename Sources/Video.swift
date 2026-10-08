import AVFoundation

/// Un fichier vidéo repéré sur un disque. Identifié par l'UUID du volume + le chemin relatif,
/// pour le retrouver même si le disque est remonté ailleurs ou débranché.
struct VideoFile: Codable, Hashable {
    var id: String
    var volume: String       // UUID du volume
    var volumeName: String
    var rel: String          // chemin relatif à la racine du volume
    var size: Int64
    var ext: String
    var kind: String         // "movie", "episode" ou "youtube"
    var title: String        // film : titre ; épisode : nom de la série ; YouTube : titre de la vidéo
    var year: Int?
    var season: Int?
    var episode: Int?
}

struct Volume {
    var uuid: String, name: String, root: URL, external: Bool
}

enum Video {
    static let exts: Set<String> = ["mp4", "m4v", "mov", "mkv", "avi", "webm", "wmv", "ts", "m2ts", "mpg"]
    /// Formats lus directement dans l'app ; les autres s'ouvrent dans Elmedia Player
    static let native: Set<String> = ["mp4", "m4v", "mov"]
    static let skipDirs: Set<String> = ["System Volume Information", "$RECYCLE.BIN", ".Trashes", ".Spotlight-V100",
                                        ".fseventsd", "Backups.backupdb", ".DocumentRevisions-V100", ".TemporaryItems"]

    // MARK: volumes

    static func volume(of url: URL) -> Volume? {
        let keys: Set<URLResourceKey> = [.volumeURLKey, .volumeUUIDStringKey, .volumeNameKey, .volumeIsInternalKey]
        guard let v = try? url.resourceValues(forKeys: keys), let root = v.volume else { return nil }
        return Volume(uuid: v.volumeUUIDString ?? "path:" + root.path, name: v.volumeName ?? root.lastPathComponent,
                      root: root, external: v.volumeIsInternal != true)
    }

    /// Disques montés dans /Volumes (clés USB, disques durs, NAS…), hors disque système
    static func mountedVolumes() -> [Volume] {
        if ProcessInfo.processInfo.environment["VERRE_NO_VOLUMES"] == "1" { return [] }   // tests : ignorer les disques branchés
        let keys: [URLResourceKey] = [.volumeUUIDStringKey, .volumeNameKey, .volumeIsBrowsableKey,
                                      .volumeIsRootFileSystemKey, .volumeIsInternalKey]
        let urls = FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: keys, options: [.skipHiddenVolumes]) ?? []
        return urls.compactMap { u in
            guard u.path.hasPrefix("/Volumes/"), let v = try? u.resourceValues(forKeys: Set(keys)),
                  v.volumeIsBrowsable == true, v.volumeIsRootFileSystem != true else { return nil }
            return Volume(uuid: v.volumeUUIDString ?? "path:" + u.path, name: v.volumeName ?? u.lastPathComponent,
                          root: u, external: v.volumeIsInternal != true)
        }
    }

    // MARK: parcours

    static func scan(_ folder: URL, on vol: Volume) -> [VideoFile] {
        let keys: Set<URLResourceKey> = [.fileSizeKey, .isRegularFileKey]
        guard let en = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: Array(keys),
                                                      options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var out: [VideoFile] = []
        let rootPath = vol.root.path.hasSuffix("/") ? vol.root.path : vol.root.path + "/"
        for case let u as URL in en {
            if skipDirs.contains(u.lastPathComponent) { en.skipDescendants(); continue }
            let ext = u.pathExtension.lowercased()
            guard exts.contains(ext), let v = try? u.resourceValues(forKeys: keys), v.isRegularFile == true else { continue }
            let size = Int64(v.fileSize ?? 0)
            let rel = u.path.hasPrefix(rootPath) ? String(u.path.dropFirst(rootPath.count)) : u.path
            if let title = youtubeTitle(u) {   // les vidéos YouTube peuvent être courtes : pas de filtre de taille
                out.append(VideoFile(id: sha(vol.uuid + "|" + rel), volume: vol.uuid, volumeName: vol.name, rel: rel, size: size,
                                     ext: ext, kind: "youtube", title: title))
                continue
            }
            if size < 20_000_000 { continue }                                          // extraits, pubs
            if size < 400_000_000, u.deletingPathExtension().lastPathComponent.range(of: "sample", options: .caseInsensitive) != nil { continue }
            let p = parse(u)
            out.append(VideoFile(id: sha(vol.uuid + "|" + rel), volume: vol.uuid, volumeName: vol.name, rel: rel, size: size,
                                 ext: ext, kind: p.episode != nil ? "episode" : "movie", title: p.title, year: p.year,
                                 season: p.season, episode: p.episode))
        }
        return out
    }

    // MARK: vidéos YouTube (téléchargées avec yt-dlp)

    /// Nom par défaut de yt-dlp : « Titre [identifiant de 11 caractères].ext »
    private static let youtubeIdRE = re(#"\s*\[[A-Za-z0-9_-]{11}\]$"#)

    /// Titre si c'est une vidéo YouTube (nom yt-dlp, ou rangée dans un dossier « YouTube »), sinon nil
    static func youtubeTitle(_ url: URL) -> String? {
        let name = url.deletingPathExtension().lastPathComponent.precomposedStringWithCanonicalMapping
        let tagged = youtubeIdRE.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
        guard tagged || url.pathComponents.dropLast().contains(where: { $0.lowercased() == "youtube" }) else { return nil }
        let title = replace(youtubeIdRE, name, with: "").trimmingCharacters(in: .whitespaces)
        return title.isEmpty ? name : title
    }

    /// Titre, chaîne, date de mise en ligne et miniature écrits dans le fichier par yt-dlp
    /// (`--embed-metadata --embed-thumbnail`) ; lisible seulement pour mp4 / m4v / mov
    static func youtubeInfo(_ file: URL) async -> (title: String?, channel: String?, date: String?, art: Data?) {
        var title: String?, channel: String?, date: String?, art: Data?
        for it in (try? await AVURLAsset(url: file).load(.metadata)) ?? [] {
            switch it.commonKey {
            case .commonKeyTitle?: if title == nil { title = try? await it.load(.stringValue) }
            case .commonKeyArtist?: if channel == nil { channel = try? await it.load(.stringValue) }
            case .commonKeyCreationDate?: if date == nil { date = try? await it.load(.stringValue) }
            case .commonKeyArtwork?: if art == nil { art = try? await it.load(.dataValue) }
            default: break
            }
            // yt-dlp écrit la date de mise en ligne dans le tag iTunes « ©day »
            if date == nil, it.identifier == .iTunesMetadataReleaseDate { date = try? await it.load(.stringValue) }
        }
        return (title, channel, date, art)
    }

    // MARK: noms de fichiers → titre, année, saison, épisode

    private static func re(_ pattern: String) -> NSRegularExpression { try! NSRegularExpression(pattern: pattern) }
    private static let junk = re(
        #"(?i)\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|dvdrip|webrip|web-dl|webdl|web|hdtv|hdrip|x264|x265|h264|h265|h\.264|h\.265|hevc|avc|hdr10|hdr|dv|10bit|8bit|dts|dts-hd|truehd|atmos|ac3|eac3|aac|ddp5\.1|dd5\.1|5\.1|7\.1|multi|multi-vf2|truefrench|french|vostfr|vff|vfq|vf|vf2|vo|subfrench|remux|proper|repack|extended|unrated|imax|complete|integrale|intégrale)\b"#)
    private static let brackets = re(#"\[[^\]]*\]|\{[^}]*\}"#), separators = re(#"[._]"#), emptyParens = re(#"\(\s*\)"#), spaces = re(#"\s+"#)
    private static let seasonDirRE = re(#"(?i)^(?:saison|season|s)[\s._\-]*(\d{1,2})$"#)
    private static let sxxexxRE = re(#"(?i)^(.*?)[\s._\-\[\(]*s(\d{1,2})[\s._\-]*e(\d{1,3})"#)
    private static let nxnnRE = re(#"(?i)^(.*?)[\s._\-]+(\d{1,2})x(\d{2,3})\b"#)
    private static let episodeRE = re(#"(?i)^(?:ep|episode|épisode|e)[\s._\-]*(\d{1,3})(?!\d)"#)
    private static let leadingNumberRE = re(#"^(\d{1,3})(?!\d)"#)
    private static let showSeasonRE = re(#"(?i)^(.*?)[\s._\-]+(?:saison|season|s)[\s._\-]*(\d{1,2})$"#)
    private static let yearRE = re(#"^(.*?)[\s._\(\[\-]+((?:19|20)\d{2})(?:[\s._\)\]]|$)"#)
    private static let durationRE = re(#"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)"#)

    private static func replace(_ re: NSRegularExpression, _ s: String, with t: String) -> String {
        re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: t)
    }

    static func clean(_ raw: String) -> String {
        var s = replace(separators, replace(brackets, raw, with: " "), with: " ")
        if let m = junk.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), let r = Range(m.range, in: s), r.lowerBound > s.startIndex {
            s = String(s[..<r.lowerBound])
        }
        s = replace(spaces, replace(emptyParens, s, with: " "), with: " ")
        return s.trimmingCharacters(in: CharacterSet(charactersIn: " -–(").union(.whitespaces))
    }

    private static func match(_ re: NSRegularExpression, _ s: String) -> [String?]? {
        guard let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { Range(m.range(at: $0), in: s).map { String(s[$0]) } }
    }

    static func parse(_ url: URL) -> (title: String, year: Int?, season: Int?, episode: Int?) {
        // forme composée des accents (les disques formatés ailleurs stockent parfois « e » + accent séparé)
        let name = url.deletingPathExtension().lastPathComponent.precomposedStringWithCanonicalMapping
        let parent = url.deletingLastPathComponent().lastPathComponent.precomposedStringWithCanonicalMapping
        let grand = url.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent.precomposedStringWithCanonicalMapping
        let seasonDir = match(seasonDirRE, parent)

        // Série : « Nom.S01E02 », « Nom 1x02 »
        if let m = match(sxxexxRE, name) ?? match(nxnnRE, name) {
            var show = clean(m[1] ?? "")
            if show.count < 2 { show = clean(seasonDir != nil ? grand : parent) }
            return (show, nil, Int(m[2] ?? ""), Int(m[3] ?? ""))
        }
        // Épisode nommé seul : « Ep 1 », « EP01 », « Épisode 3 », « E03 » (ou « 03 - Titre » dans un dossier de saison)
        let epToken = match(episodeRE, name)
        if let sd = seasonDir, let e = epToken ?? match(leadingNumberRE, name) {
            return (clean(grand), nil, Int(sd[1] ?? ""), Int(e[1] ?? ""))   // « Série/S1/Ep 1.mkv »
        }
        if let e = epToken {
            // pas de dossier de saison : la série est le dossier parent (« Série S2 » donne la saison)
            if let m = match(showSeasonRE, parent) {
                return (clean(m[1] ?? parent), nil, Int(m[2] ?? "") ?? 1, Int(e[1] ?? ""))
            }
            return (clean(parent), nil, 1, Int(e[1] ?? ""))
        }
        // Film : « Titre (2019) », « Titre.2019.1080p »
        func movie(_ s: String) -> (String, Int?) {
            if let m = match(yearRE, s), let t = m[1], !clean(t).isEmpty {
                return (clean(t), Int(m[2] ?? ""))
            }
            return (clean(s), nil)
        }
        var (title, year) = movie(name)
        if title.count < 2 || ["movie", "film", "video"].contains(title.lowercased()) { (title, year) = movie(parent) }
        return (title, year, nil, nil)
    }

    // MARK: indices pour reconnaître le bon film

    /// Rangé dans un dossier « Anime », « Animation », « Dessins animés »… : on favorise les films d'animation
    static func animationHint(_ rel: String) -> Bool {
        let words: Set<String> = ["anime", "animes", "animation", "animations", "dessin anime", "dessins animes", "cartoon", "cartoons"]
        return rel.split(separator: "/").dropLast().contains { words.contains(normalized(String($0))) }
    }

    /// Durée en secondes (AVFoundation pour mp4/mov, ffmpeg pour mkv/avi…)
    static func duration(_ file: URL) async -> Double? {
        if native.contains(file.pathExtension.lowercased()) {
            guard let d = try? await AVURLAsset(url: file).load(.duration), d.seconds.isFinite, d.seconds > 0 else { return nil }
            return d.seconds
        }
        guard let ffmpeg else { return nil }
        let probe = await run(ffmpeg, ["-hide_banner", "-i", file.path])
        guard let parts = match(durationRE, probe)?.dropFirst().compactMap({ $0.flatMap { Double($0) } }), parts.count == 3 else { return nil }
        let secs = parts[0] * 3600 + parts[1] * 60 + parts[2]
        return secs > 0 ? secs : nil
    }

    // MARK: vignettes (image tirée de la vidéo)

    static let ffmpeg: String? = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].first { FileManager.default.isExecutableFile(atPath: $0) }

    static func thumbnail(_ file: URL, id: String) async -> URL? {
        let out = Paths.images.appendingPathComponent("thumb-\(id).jpg")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        if native.contains(file.pathExtension.lowercased()) {
            let asset = AVURLAsset(url: file)
            let dur = (try? await asset.load(.duration))?.seconds ?? 0
            let gen = AVAssetImageGenerator(asset: asset)
            gen.appliesPreferredTrackTransform = true
            gen.maximumSize = CGSize(width: 960, height: 960)
            let t = dur.isFinite && dur > 0 ? min(dur * 0.15, 420) : 5
            if let (cg, _) = try? await gen.image(at: CMTime(seconds: t, preferredTimescale: 600)), writeJPEG(cg, to: out) { return out }
            return nil
        }
        guard let ffmpeg else { return nil }
        // durée et dimensions, pour viser ~20 % du film (après le générique) et vérifier le recadrage
        let probe = await run(ffmpeg, ["-hide_banner", "-i", file.path])
        func ints(_ pattern: String) -> [Int] { match(re(pattern), probe)?.dropFirst().compactMap { $0.flatMap { Int($0) } } ?? [] }
        let d = ints(#"Duration: (\d+):(\d+):(\d+)"#), dims = ints(#", (\d{3,5})x(\d{3,5})"#)
        let duration = d.count == 3 ? Double(d[0] * 3600 + d[1] * 60 + d[2]) : 0
        let seeks = duration > 60 ? [duration * 0.2, duration * 0.35, 5] : [30, 2]
        for seek in seeks.map({ String(Int($0)) }) {
            // bandes noires : on ne recadre que si elles sont symétriques (sinon c'est juste une scène sombre)
            let detect = await run(ffmpeg, ["-hide_banner", "-ss", seek, "-i", file.path, "-frames:v", "8", "-vf", "cropdetect=limit=0.1:round=2", "-f", "null", "-"])
            var filter = "scale=960:-2"
            if dims.count == 2, let c = detect.components(separatedBy: "crop=").last?.prefix(while: { !$0.isWhitespace }) {
                let v = c.split(separator: ":").compactMap { Int($0) }
                if v.count == 4 {
                    let (w, h, x, y) = (v[0], v[1], v[2], v[3]), (sw, sh) = (dims[0], dims[1])
                    let symmetric = abs(y - (sh - h - y)) <= 12 && abs(x - (sw - w - x)) <= 12
                    if symmetric, (w < sw || h < sh), h > sh / 3, w > sw / 3 { filter = "crop=\(w):\(h):\(x):\(y)," + filter }
                }
            }
            _ = await run(ffmpeg, ["-v", "error", "-y", "-ss", seek, "-i", file.path, "-frames:v", "1", "-vf", filter, "-q:v", "4", out.path])
            if FileManager.default.fileExists(atPath: out.path) { return out }
        }
        return nil
    }

    /// Lance un outil et renvoie sa sortie d'erreur (où ffmpeg écrit ses infos)
    private static func run(_ tool: String, _ args: [String]) async -> String {
        let log = FileManager.default.temporaryDirectory.appendingPathComponent("verre-\(UUID().uuidString).log")
        FileManager.default.createFile(atPath: log.path, contents: nil)
        defer { try? FileManager.default.removeItem(at: log) }
        guard let handle = try? FileHandle(forWritingTo: log) else { return "" }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: tool)
            p.arguments = args
            p.standardOutput = FileHandle.nullDevice
            p.standardError = handle
            p.terminationHandler = { _ in cont.resume() }
            do { try p.run() } catch { cont.resume() }
        }
        try? handle.close()
        return (try? String(contentsOf: log, encoding: .utf8)) ?? ""
    }
}
