import AVFoundation

/// Ce qu'on retient d'un fichier audio (mis en cache, relu seulement s'il a changé)
struct TrackMeta: Codable {
    var mtime: Double
    var title: String
    var artist: String
    var albumArtist: String?
    var album: String
    var year: String?
    var genre: String?
    var n: Int
    var disc: Int
    var duration: Double
    var art: String?   // nom du fichier image dans Paths.art
}

struct TrackOut: Codable {
    var id: String, title: String, artist: String, n: Int, duration: Double, url: String
}

struct AlbumOut: Codable {
    var id: String, title: String, artist: String
    var year: String?, genre: String?, art: String?, colors: [String]?
    var tracks: [TrackOut]
}

enum Music {
    static let exts: Set<String> = ["mp3", "m4a", "m4b", "aac", "flac", "wav", "aif", "aiff", "alac", "caf"]
    /// Sur un disque externe, on ignore les .wav/.aiff (souvent des sons de projets, pas des albums)
    static let volumeExts: Set<String> = ["mp3", "m4a", "aac", "flac", "alac"]

    /// Dossiers dont le nom ne dit rien de l'album (« Music/morceau.flac ») : leurs morceaux sans tag deviennent des singles
    static let genericDirs: Set<String> = ["music", "musique", "musiques", "audio", "itunes media", "downloads", "téléchargements", "telechargements"]

    /// Morceaux trouvés sous `root`, avec leur profondeur (0 = directement dans `root`)
    static func files(in root: URL, exts: Set<String>) -> [(URL, Double, Int)] {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
        guard let en = FileManager.default.enumerator(at: root, includingPropertiesForKeys: Array(keys),
                                                      options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var out: [(URL, Double, Int)] = []
        for case let u as URL in en {
            if Video.skipDirs.contains(u.lastPathComponent) { en.skipDescendants(); continue }
            guard exts.contains(u.pathExtension.lowercased()), let v = try? u.resourceValues(forKeys: keys), v.isRegularFile == true else { continue }
            out.append((u, v.contentModificationDate?.timeIntervalSince1970 ?? 0, en.level - 1))
        }
        return out
    }

    private static func string(_ item: AVMetadataItem) async -> String? {
        if let s = try? await item.load(.stringValue), !s.isEmpty { return s }
        if let n = try? await item.load(.numberValue) { return n.stringValue }
        return nil
    }

    /// Numéro de piste : "3/12" (ID3) ou octets [0,0,0,3,0,12,…] (iTunes)
    private static func number(_ item: AVMetadataItem) async -> Int? {
        if let s = await string(item), let n = Int(s.split(separator: "/").first?.trimmingCharacters(in: .whitespaces) ?? "") { return n }
        if let d = try? await item.load(.dataValue), d.count >= 4 { return Int(d[d.startIndex + 2]) << 8 | Int(d[d.startIndex + 3]) }
        return nil
    }

    /// « 01 Artiste - Titre » : numéro, artiste et titre facultatifs
    private static let fileNameRE = try! NSRegularExpression(pattern: #"^(?:(\d{1,3})[\s.\-_]+)?(?:(.+?)\s+-\s+)?(.+)$"#)

    static func read(_ url: URL, mtime: Double, depth: Int = 2) async -> TrackMeta {
        let asset = AVURLAsset(url: url)
        var title: String?, artist: String?, albumArtist: String?, album: String?, year: String?, genre: String?
        var n = 0, disc = 0, artData: Data?
        var duration = 0.0
        if let d = try? await asset.load(.duration), d.seconds.isFinite { duration = d.seconds }
        let items = (try? await asset.load(.metadata)) ?? []
        for it in items {
            let id = it.identifier
            switch it.commonKey {
            case .commonKeyTitle?: if title == nil { title = await string(it) }
            case .commonKeyArtist?: if artist == nil { artist = await string(it) }
            case .commonKeyAlbumName?: if album == nil { album = await string(it) }
            case .commonKeyArtwork?: if artData == nil { artData = try? await it.load(.dataValue) }
            case .commonKeyCreationDate?: if year == nil { year = await string(it) }
            default: break
            }
            switch id {
            case .id3MetadataBand?, .iTunesMetadataAlbumArtist?: if albumArtist == nil { albumArtist = await string(it) }
            case .id3MetadataTrackNumber?, .iTunesMetadataTrackNumber?: if n == 0 { n = await number(it) ?? 0 }
            case .id3MetadataPartOfASet?, .iTunesMetadataDiscNumber?: if disc == 0 { disc = await number(it) ?? 0 }
            case .id3MetadataYear?, .id3MetadataRecordingTime?, .iTunesMetadataReleaseDate?: if year == nil { year = await string(it) }
            case .id3MetadataContentType?, .iTunesMetadataUserGenre?: if genre == nil { genre = await string(it) }
            case .id3MetadataTitleDescription?: if title == nil { title = await string(it) }
            case .id3MetadataLeadPerformer?: if artist == nil { artist = await string(it) }
            case .id3MetadataAlbumTitle?: if album == nil { album = await string(it) }
            default: break
            }
            // FLAC / Ogg : « Vorbis comments » (identifiants vorb/CLÉ)
            if let raw = id?.rawValue, raw.hasPrefix("vorb/") {
                switch raw.dropFirst(5).uppercased() {
                case "TITLE": if title == nil { title = await string(it) }
                case "ARTIST": if artist == nil { artist = await string(it) }
                case "ALBUM": if album == nil { album = await string(it) }
                case "ALBUMARTIST", "ALBUM ARTIST": if albumArtist == nil { albumArtist = await string(it) }
                case "TRACKNUMBER": if n == 0 { n = await number(it) ?? 0 }
                case "DISCNUMBER": if disc == 0 { disc = await number(it) ?? 0 }
                case "DATE", "YEAR": if year == nil { year = await string(it) }
                case "GENRE": if genre == nil { genre = await string(it) }
                // pochette FLAC, quel que soit son type (« couverture » ou « autre »)
                case "METADATA_BLOCK_PICTURE": if artData == nil { artData = try? await it.load(.dataValue) }
                default: break
                }
            }
        }

        if artData == nil, url.pathExtension.lowercased() == "flac" { artData = flacPicture(url) }

        // Sans tags : « Artiste/Album/01 Titre.mp3 » ou « Artiste - Titre.mp3 »
        let base = url.deletingPathExtension().lastPathComponent
        let parts = url.pathComponents
        if title == nil || artist == nil || n == 0 {
            if let m = fileNameRE.firstMatch(in: base, range: NSRange(base.startIndex..., in: base)) {
                func g(_ i: Int) -> String? { Range(m.range(at: i), in: base).map { String(base[$0]) } }
                if n == 0, let s = g(1) { n = Int(s) ?? 0 }
                if artist == nil { artist = g(2) }
                if title == nil { title = g(3) }
            }
        }
        // dossiers « Artiste/Album » seulement s'ils existent vraiment sous le dossier de musique ;
        // sinon un morceau sans album devient un single, comme dans Apple Music
        let folder = parts.count >= 2 ? parts[parts.count - 2] : ""
        let inAlbumDir = depth >= 1 && !genericDirs.contains(folder.lowercased())
        if artist == nil, depth >= 2, inAlbumDir { artist = parts[parts.count - 3] }
        if album == nil { album = inAlbumDir ? folder : "\(title ?? base) - Single" }

        let finalArtist = artist ?? "Artiste inconnu"
        let finalAlbum = album ?? "Sans album"
        var artName: String?
        if let artData, !artData.isEmpty {
            let ext = artData.starts(with: [0x89, 0x50]) ? "png" : "jpg"
            artName = sha((albumArtist ?? finalArtist) + "|" + finalAlbum) + "." + ext
            let dest = Paths.art.appendingPathComponent(artName!)
            if !FileManager.default.fileExists(atPath: dest.path) { try? artData.write(to: dest) }
        }
        if let g = genre { genre = g.replacingOccurrences(of: #"^\(\d+\)"#, with: "", options: .regularExpression) }
        return TrackMeta(mtime: mtime, title: title ?? base, artist: finalArtist, albumArtist: albumArtist, album: finalAlbum,
                         year: year.map { String($0.prefix(4)) }, genre: genre, n: n, disc: disc, duration: duration, art: artName)
    }

    /// Pochette d'un FLAC lue directement dans ses blocs « PICTURE » :
    /// macOS ignore les images qui ne sont pas marquées « couverture ». On préfère la couverture s'il y en a une.
    static func flacPicture(_ url: URL) -> Data? {
        guard let h = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? h.close() }
        guard let magic = try? h.read(upToCount: 4), magic == Data("fLaC".utf8) else { return nil }
        var offset: UInt64 = 4, found: Data?
        while true {
            try? h.seek(toOffset: offset)
            guard let hdr = try? h.read(upToCount: 4), hdr.count == 4 else { return found }
            let last = hdr[0] & 0x80 != 0, type = hdr[0] & 0x7f
            let len = Int(hdr[1]) << 16 | Int(hdr[2]) << 8 | Int(hdr[3])
            if type == 6, let b = try? h.read(upToCount: len), b.count == len {
                var p = 0
                func u32() -> Int { let v = b[p..<p + 4].reduce(0) { $0 << 8 | Int($1) }; p += 4; return v }
                let kind = u32()
                p += u32()            // type MIME
                p += u32()            // description
                p += 16               // largeur, hauteur, profondeur, couleurs
                let size = u32()
                if size > 0, p + size <= b.count {
                    let img = b.subdata(in: p..<p + size)
                    if kind == 3 { return img }
                    if found == nil { found = img }
                }
            }
            if last { return found }
            offset += 4 + UInt64(len)
        }
    }

    /// Regroupe les morceaux en albums, triés par artiste puis titre
    static func albums(from tracks: [(path: String, meta: TrackMeta)], palettes: inout [String: [String]]) -> [AlbumOut] {
        var groups: [String: [(String, TrackMeta)]] = [:]
        for t in tracks { groups[(t.meta.albumArtist ?? t.meta.artist) + "\u{0}" + t.meta.album, default: []].append(t) }
        var out: [AlbumOut] = []
        for (key, list) in groups {
            let sorted = list.sorted { a, b in
                (a.1.disc, a.1.n == 0 ? 999 : a.1.n, a.1.title) < (b.1.disc, b.1.n == 0 ? 999 : b.1.n, b.1.title)
            }
            let first = sorted[0].1
            let art = sorted.lazy.compactMap { $0.1.art }.first
            var colors: [String]?
            if let art {
                if let p = palettes[art] { colors = p }
                else if let p = palette(of: Paths.art.appendingPathComponent(art)) { palettes[art] = p; colors = p }
            }
            out.append(AlbumOut(
                id: sha(key), title: first.album, artist: first.albumArtist ?? first.artist,
                year: sorted.lazy.compactMap { $0.1.year }.first, genre: sorted.lazy.compactMap { $0.1.genre }.first,
                art: art.map { mediaURL(Paths.art.appendingPathComponent($0).path) }, colors: colors,
                tracks: sorted.map { p, m in
                    TrackOut(id: sha(p), title: m.title, artist: m.artist, n: m.n, duration: m.duration,
                             url: mediaURL(p))
                }))
        }
        return out.sorted { ($0.artist.lowercased(), $0.title.lowercased()) < ($1.artist.lowercased(), $1.title.lowercased()) }
    }
}
