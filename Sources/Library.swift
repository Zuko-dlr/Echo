import AppKit

struct Settings: Codable {
    var musicFolders: [String]
    var videoFolders: [String]
    var tmdbKey: String?
    var matches: [String: Int]   // identification corrigée à la main : clé du film/série → id TMDB
}

struct Progress: Codable { var pos: Double; var dur: Double; var at: Double }

struct EpisodeMeta: Codable { var title: String?; var overview: String?; var still: String?; var runtime: Int? }

/// Infos d'un film ou d'une série (venues de TMDB), mises en cache dans meta.json
struct MediaMeta: Codable {
    var tmdbId: Int?
    var title: String?
    var year: Int?
    var overview: String?
    var runtime: Int?
    var genres: [String]?
    var rating: Double?
    var poster: String?
    var backdrop: String?
    var colors: [String]?
    var episodes: [String: EpisodeMeta]?   // clé "saison-épisode"
    var verified: Bool?                    // identification confirmée (durée, ou choix manuel)
}

// MARK: ce que reçoit l'interface

struct FileOut: Codable {
    var id: String, url: String, path: String, ext: String, volume: String
    var size: Int64, available: Bool, native: Bool
}
struct MovieOut: Codable {
    var id: String, key: String, title: String
    var year: Int?, overview: String?, runtime: Int?, genres: [String], rating: Double?
    var poster: String?, backdrop: String?, thumb: String?, colors: [String]?, tmdbId: Int?
    var files: [FileOut]
}
struct EpisodeOut: Codable {
    var id: String, s: Int, e: Int, title: String
    var overview: String?, still: String?, runtime: Int?
    var file: FileOut
}
struct SeasonOut: Codable { var n: Int; var episodes: [EpisodeOut] }
struct ShowOut: Codable {
    var id: String, key: String, title: String
    var year: Int?, overview: String?, genres: [String], rating: Double?
    var poster: String?, backdrop: String?, thumb: String?, colors: [String]?, tmdbId: Int?
    var seasons: [SeasonOut]
}
struct VolumeOut: Codable { var uuid: String, name: String; var mounted: Bool, external: Bool; var movies: Int, episodes: Int }
struct SettingsOut: Codable { var musicFolders: [String], videoFolders: [String]; var hasKey: Bool }
struct StateOut: Codable {
    var albums: [AlbumOut], movies: [MovieOut], shows: [ShowOut], volumes: [VolumeOut]
    var playlists: [PlaylistOut]
    var settings: SettingsOut, progress: [String: Progress], status: String?
}

/// Playlist enregistrée : on garde le chemin du fichier et ses infos, pour l'afficher même disque débranché
struct PlaylistEntry: Codable { var path: String; var title: String; var artist: String; var album: String }
struct Playlist: Codable { var id: String; var name: String; var entries: [PlaylistEntry]; var created: Double }
struct PlaylistTrackOut: Codable { var id: String; var title: String; var artist: String; var album: String }
struct PlaylistOut: Codable { var id: String; var name: String; var tracks: [PlaylistTrackOut] }

@MainActor
final class Library {
    var settings: Settings
    // caches réécrits sur le disque seulement s'ils ont changé (voir `save`)
    private var musicCache: [String: TrackMeta] { didSet { unsaved.insert(Self.musicFile) } }
    /// v2 : morceaux sans album rangés en singles (l'ancien cache nommait l'album d'après le dossier « Music »)
    private static let musicFile = "music-v2.json"
    private var palettes: [String: [String]] { didSet { unsaved.insert("palettes.json") } }
    private var files: [VideoFile] { didSet { unsaved.insert("videos.json") } }
    private var volumeNames: [String: String] { didSet { unsaved.insert("volumes.json") } }
    private var meta: [String: MediaMeta] { didSet { unsaved.insert("meta.json") } }
    private var unsaved = Set<String>()
    private var thumbs: [String: String]
    private var progress: [String: Progress]
    private var durations: [String: Double]   // durée des fichiers vidéo (secondes), par id
    private var playlists: [Playlist]
    private var trackIndex: [String: (path: String, meta: TrackMeta)] = [:]   // id du morceau → fichier
    private var albums: [AlbumOut] = []
    private var musicPaths = Set<String>()   // morceaux présents : seuls fichiers audio servis à l'interface
    private var videoPaths = Set<String>()   // vidéos présentes (disques branchés)
    private var mounted: [String: Volume] = [:]
    let tmdb = TMDB()

    /// (évènement, JSON) envoyé à l'interface
    var onEvent: ((String, String) -> Void)?
    var status: String? { didSet { if status != oldValue { onEvent?("status", (status ?? "").json) } } }
    private var job: Task<Void, Never>?
    private var emitPending = false

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        settings = readJSON(Settings.self, "settings.json")
            ?? Settings(musicFolders: [home + "/Music"], videoFolders: [home + "/Movies"], tmdbKey: nil, matches: [:])
        musicCache = readJSON([String: TrackMeta].self, Self.musicFile) ?? [:]
        try? FileManager.default.removeItem(at: Paths.support.appendingPathComponent("music.json"))   // ancien cache
        palettes = readJSON([String: [String]].self, "palettes.json") ?? [:]
        files = readJSON([VideoFile].self, "videos.json") ?? []
        volumeNames = readJSON([String: String].self, "volumes.json") ?? [:]
        meta = readJSON([String: MediaMeta].self, "meta.json") ?? [:]
        thumbs = readJSON([String: String].self, "thumbs.json") ?? [:]
        progress = readJSON([String: Progress].self, "progress.json") ?? [:]
        durations = readJSON([String: Double].self, "durations.json") ?? [:]
        playlists = readJSON([Playlist].self, "playlists.json") ?? []
        tmdb.key = settings.tmdbKey
    }

    func start() {
        let nc = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didMountNotification, NSWorkspace.didUnmountNotification, NSWorkspace.didRenameVolumeNotification] {
            nc.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                MainActor.assumeIsolated { self?.volumesChanged(note) }
            }
        }
        refreshMounted()
        refresh()
    }

    /// Relance l'analyse complète (musique, vidéos, puis affiches)
    func refresh(retryUnmatched: Bool = false) {
        if retryUnmatched, meta.values.contains(where: { $0.tmdbId == nil }) { meta = meta.filter { $0.value.tmdbId != nil } }
        job?.cancel()
        job = Task {
            await scanMusic()
            if Task.isCancelled { return }
            await scanVideos()
            if Task.isCancelled { return }
            emitState()
            await enrich()
            if Task.isCancelled { return }
            if status?.hasPrefix("Clé") != true && status?.hasPrefix("Pas de") != true { status = nil }
            emitState()
        }
    }

    private func save<T: Encodable>(_ value: T, _ file: String) {
        if unsaved.remove(file) != nil { writeJSON(value, file) }
    }

    func saveSettings() {
        writeJSON(settings, "settings.json")
        // contient la clé TMDB : lisible par votre seul compte
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Paths.support.appendingPathComponent("settings.json").path)
    }

    /// Fichiers que l'interface a le droit de recevoir : morceaux et vidéos de la bibliothèque, images en cache
    func isAllowedMedia(_ path: String) -> Bool {
        if path.split(separator: "/").contains("..") { return false }   // pas de sortie du dossier par « .. »
        if path.hasPrefix(Paths.support.path + "/") && !path.hasSuffix(".json") { return true }
        return musicPaths.contains(path) || videoPaths.contains(path) || isLibraryVideo(path)
    }

    /// Le chemin correspond-il à une vidéo connue de la bibliothèque ?
    func isLibraryVideo(_ path: String) -> Bool {
        files.contains { f in resolve(f)?.path == path }
    }

    // MARK: disques

    private func refreshMounted() {
        var m: [String: Volume] = [:]
        for v in Video.mountedVolumes() { m[v.uuid] = v }
        for f in settings.videoFolders + settings.musicFolders {
            if let v = Video.volume(of: URL(fileURLWithPath: f)) { m[v.uuid] = v }
        }
        mounted = m
    }

    private func volumesChanged(_ note: Notification) {
        let name = note.userInfo?[NSWorkspace.localizedVolumeNameUserInfoKey] as? String ?? "Disque"
        refreshMounted()
        if note.name == NSWorkspace.didUnmountNotification {
            status = "« \(name) » est débranché"
            emitState()
            Task { try? await Task.sleep(nanoseconds: 4_000_000_000); if self.status?.hasSuffix("débranché") == true { self.status = nil } }
        } else {
            status = "« \(name) » est branché : analyse…"
            refresh()
        }
    }

    private func resolve(_ f: VideoFile) -> URL? {
        if f.rel.hasPrefix("/") { return mounted[f.volume] != nil ? URL(fileURLWithPath: f.rel) : nil }
        return mounted[f.volume]?.root.appendingPathComponent(f.rel)
    }

    // MARK: musique

    private func scanMusic() async {
        status = "Analyse de la musique…"
        var roots: [(URL, Set<String>)] = settings.musicFolders.map { (URL(fileURLWithPath: $0), Music.exts) }
        roots += mounted.values.filter { $0.external }.map { ($0.root, Music.volumeExts) }
        let list = await Task.detached { roots.flatMap { Music.files(in: $0.0, exts: $0.1) } }.value
        var seen = Set<String>(), result: [(path: String, meta: TrackMeta)] = [], toRead: [(String, Double, Int)] = []
        for (u, m, depth) in list where seen.insert(u.path).inserted {
            if let c = musicCache[u.path], c.mtime == m { result.append((u.path, c)) } else { toRead.append((u.path, m, depth)) }
        }
        // 8 lectures en parallèle : chaque morceau lu laisse sa place au suivant
        await withTaskGroup(of: (String, TrackMeta).self) { g in
            var next = toRead.makeIterator(), done = 0
            func readNext() {
                guard !Task.isCancelled, let (p, m, depth) = next.next() else { return }
                g.addTask { (p, await Music.read(URL(fileURLWithPath: p), mtime: m, depth: depth)) }
            }
            for _ in 0..<8 { readNext() }
            for await (p, t) in g {
                musicCache[p] = t
                result.append((p, t))
                done += 1
                if done % 8 == 0 || done == toRead.count { status = "Lecture des morceaux… \(done) / \(toRead.count)" }
                readNext()
            }
        }
        if Task.isCancelled { return }
        if musicCache.keys.contains(where: { !seen.contains($0) }) { musicCache = musicCache.filter { seen.contains($0.key) } }
        save(musicCache, Self.musicFile)
        // albums (et couleurs des nouvelles pochettes) calculés hors du fil principal : l'interface reste fluide
        let tracks = result, known = palettes
        let (albums, found, index) = await Task.detached {
            var p = known
            let albums = Music.albums(from: tracks, palettes: &p)
            return (albums, p, Dictionary(tracks.map { (sha($0.path), $0) }, uniquingKeysWith: { a, _ in a }))
        }.value
        if Task.isCancelled { return }
        if found.count > known.count { palettes.merge(found) { current, _ in current } }
        save(palettes, "palettes.json")
        self.albums = albums
        musicPaths = Set(tracks.map(\.path))
        trackIndex = index
        reconcilePlaylists()
    }

    // MARK: vidéos

    private func scanVideos() async {
        status = "Recherche des films et séries…"
        refreshMounted()
        let sources: [(URL, Volume)] = settings.videoFolders.compactMap { f in
            let u = URL(fileURLWithPath: f)
            return Video.volume(of: u).map { (u, $0) }
        } + mounted.values.filter { $0.external }.map { ($0.root, $0) }
        var scanned = Set(sources.map { $0.1.uuid })
        if let rootVol = Video.volume(of: URL(fileURLWithPath: NSHomeDirectory())) { scanned.insert(rootVol.uuid) }
        let found = await Task.detached { sources.flatMap { Video.scan($0.0, on: $0.1) } }.value
        if Task.isCancelled { return }
        var byId: [String: VideoFile] = [:]
        for f in files where !scanned.contains(f.volume) { byId[f.id] = f }   // disques débranchés : on les garde
        for f in found { byId[f.id] = f }
        if Set(byId.values) != Set(files) { files = Array(byId.values) }
        for (_, v) in sources where v.external && volumeNames[v.uuid] != v.name { volumeNames[v.uuid] = v.name }
        save(files, "videos.json")
        save(volumeNames, "volumes.json")
    }

    private func movieKey(_ f: VideoFile) -> String { "movie:" + normalized(f.title) + "|" + (f.year.map(String.init) ?? "") }
    private func showKey(_ f: VideoFile) -> String { "tv:" + normalized(f.title) }
    private var movieGroups: [String: [VideoFile]] { Dictionary(grouping: files.filter { $0.kind == "movie" }, by: movieKey) }
    private var showGroups: [String: [VideoFile]] { Dictionary(grouping: files.filter { $0.kind == "episode" }, by: showKey) }

    /// Affiches et infos TMDB, puis vignettes pour ce qui n'a pas d'image
    private func enrich() async {
        let movieGroups = self.movieGroups, showGroups = self.showGroups

        // fiches devenues inutiles (ex. faux films « Ep 1 » avant que les épisodes soient reconnus)
        let live = Set(movieGroups.keys).union(showGroups.keys)
        if meta.keys.contains(where: { !live.contains($0) }) { meta = meta.filter { live.contains($0.key) } }
        save(meta, "meta.json")

        if tmdb.key != nil {
            // identifications faites sans vérifier la durée : si le film trouvé n'a pas la durée du fichier,
            // c'était le mauvais (ex. « Avatar » 2009 au lieu du film d'animation) → on cherche à nouveau
            for (key, group) in movieGroups where settings.matches[key] == nil {
                guard var m = meta[key], m.tmdbId != nil, m.verified != true else { continue }
                if Task.isCancelled { return }
                if let rt = m.runtime, rt > 0 {
                    guard let secs = await fileDuration(group[0]) else { continue }
                    if abs(Double(rt) - secs / 60) > 25 { meta[key] = nil; continue }
                }
                m.verified = true
                meta[key] = m
            }
            save(meta, "meta.json")

            let todo = movieGroups.filter { meta[$0.key] == nil }.map { ($0.key, $0.value, "movie") }
                + showGroups.filter { meta[$0.key] == nil }.map { ($0.key, $0.value, "tv") }
            for (i, (key, group, kind)) in todo.enumerated() {
                if Task.isCancelled { return }
                status = "Recherche des affiches… \(i + 1) / \(todo.count)"
                do {
                    var id = settings.matches[key]
                    if id == nil {
                        id = kind == "movie" ? try await bestMovie(group) : try await bestShow(group)
                    }
                    if let id {
                        meta[key] = kind == "movie" ? try await movieMeta(id)
                            : try await showMeta(id, episodes: Set(group.compactMap { f in f.season.map { "\($0)-\(f.episode ?? 0)" } }))
                        meta[key]?.verified = true
                    } else {
                        meta[key] = MediaMeta()   // introuvable : on ne recherche plus (sauf « Analyser à nouveau »)
                    }
                } catch TMDB.Failure.badKey {
                    status = TMDB.Failure.badKey.errorDescription
                    return
                } catch TMDB.Failure.offline {
                    status = "Pas de connexion : les affiches seront cherchées au prochain lancement."
                    break
                } catch {
                    continue
                }
                save(meta, "meta.json")
                scheduleEmit()
            }
        }

        // vignettes : films sans affiche, épisodes sans image
        let needs = files.filter { f in
            guard thumbs[f.id] == nil, resolve(f) != nil else { return false }
            if f.kind == "movie" { return meta[movieKey(f)]?.poster == nil }
            return meta[showKey(f)]?.episodes?["\(f.season ?? 0)-\(f.episode ?? 0)"]?.still == nil
        }
        for (i, f) in needs.enumerated() {
            if Task.isCancelled { return }
            guard let url = resolve(f) else { continue }
            status = "Création des vignettes… \(i + 1) / \(needs.count)"
            if let t = await Video.thumbnail(url, id: f.id) {
                thumbs[f.id] = t.path
                if palettes[t.path] == nil, let p = palette(of: t) { palettes[t.path] = p }
                writeJSON(thumbs, "thumbs.json")
                scheduleEmit()
            }
        }
        save(palettes, "palettes.json")
    }

    private func fileDuration(_ f: VideoFile) async -> Double? {
        if let d = durations[f.id] { return d }
        guard let url = resolve(f), let d = await Video.duration(url) else { return nil }
        durations[f.id] = d
        writeJSON(durations, "durations.json")
        return d
    }

    /// Choisit le bon film parmi les résultats TMDB : ordre de pertinence, année,
    /// indice « animation » du dossier, et surtout durée du fichier comparée à celle du film.
    private func bestMovie(_ group: [VideoFile]) async throws -> Int? {
        let f = group[0]
        let results = try await tmdb.search("movie", f.title, year: f.year)
        let anim = Video.animationHint(f.rel)
        var scored: [(id: Int, score: Double)] = []
        for (rank, r) in results.prefix(8).enumerated() {
            guard let id = r["id"] as? Int else { continue }
            var score = 10 - Double(rank) * 0.6
            if let fy = f.year, let y = Int(((r["release_date"] as? String) ?? "").prefix(4)) { score += fy == y ? 5 : abs(fy - y) == 1 ? 2 : -2 }
            if anim { score += (r["genre_ids"] as? [Int] ?? []).contains(16) ? 4 : -2 }
            scored.append((id, score))
        }
        if let secs = await fileDuration(f), secs > 20 * 60 {
            let minutes = secs / 60
            for i in scored.indices.sorted(by: { scored[$0].score > scored[$1].score }).prefix(5) {
                guard let d = try? await tmdb.details("movie", scored[i].id), let rt = d["runtime"] as? Int, rt > 0 else { continue }
                let diff = abs(Double(rt) - minutes)
                scored[i].score += diff <= 6 ? 8 : diff <= 15 ? 3 : diff > 30 ? -6 : 0
            }
        }
        return scored.max { $0.score < $1.score }?.id
    }

    /// Choisit la bonne série : elle doit contenir les saisons et épisodes présents sur le disque.
    /// Si le nom ne donne rien (faute de frappe : « Stars Wars Dark Maul »), on réessaie en retirant des mots.
    private func bestShow(_ group: [VideoFile]) async throws -> Int? {
        let f = group[0]
        let anim = Video.animationHint(f.rel)
        var need: [Int: Int] = [:]   // saison → plus grand numéro d'épisode sur le disque
        for g in group { if let s = g.season, let e = g.episode { need[s] = max(need[s] ?? 0, e) } }
        let words = f.title.split(separator: " ").map(String.init)
        var queries = [f.title]
        if words.count > 1 {
            for i in 1..<words.count { queries.append(words[i...].joined(separator: " ")) }
            for i in stride(from: words.count - 1, to: 0, by: -1) { queries.append(words[..<i].joined(separator: " ")) }
        }
        var fallback: Int?
        for q in queries where q.count >= 3 {
            let results = try await tmdb.search("tv", q, year: f.year)
            if results.isEmpty { continue }
            var scored: [(id: Int, score: Double, fits: Bool)] = []
            for (rank, r) in results.prefix(6).enumerated() {
                guard let id = r["id"] as? Int else { continue }
                var score = 10 - Double(rank) * 0.6
                if anim { score += (r["genre_ids"] as? [Int] ?? []).contains(16) ? 4 : -2 }
                scored.append((id, score, false))
            }
            for i in scored.indices.sorted(by: { scored[$0].score > scored[$1].score }).prefix(4) {
                guard let d = try? await tmdb.details("tv", scored[i].id), let seasons = d["seasons"] as? [[String: Any]] else { continue }
                var counts: [Int: Int] = [:]
                for s in seasons { if let n = s["season_number"] as? Int, let c = s["episode_count"] as? Int { counts[n] = c } }
                let fits = need.allSatisfy { (counts[$0.key] ?? 0) >= $0.value }
                scored[i].score += fits ? 8 : -6
                scored[i].fits = fits
            }
            guard let best = scored.max(by: { $0.score < $1.score }) else { continue }
            if best.fits { return best.id }
            if fallback == nil { fallback = best.id }
        }
        return fallback
    }

    private func common(_ d: [String: Any], _ m: inout MediaMeta) async {
        m.overview = d["overview"] as? String
        m.genres = (d["genres"] as? [[String: Any]])?.compactMap { $0["name"] as? String }
        if let r = d["vote_average"] as? Double, r > 0 { m.rating = r }
        let poster = await tmdb.image(d["poster_path"] as? String, size: "w500")
        let backdrop = await tmdb.image(d["backdrop_path"] as? String, size: "w1280")
        m.poster = poster?.path
        m.backdrop = backdrop?.path
        if let src = poster ?? backdrop { m.colors = palette(of: src) }
    }

    private func movieMeta(_ id: Int) async throws -> MediaMeta {
        let d = try await tmdb.details("movie", id)
        var m = MediaMeta(tmdbId: id)
        m.title = d["title"] as? String
        m.year = Int((d["release_date"] as? String ?? "").prefix(4))
        m.runtime = d["runtime"] as? Int
        await common(d, &m)
        return m
    }

    private func showMeta(_ id: Int, episodes: Set<String>) async throws -> MediaMeta {
        let d = try await tmdb.details("tv", id)
        var m = MediaMeta(tmdbId: id)
        m.title = d["name"] as? String
        m.year = Int((d["first_air_date"] as? String ?? "").prefix(4))
        m.runtime = (d["episode_run_time"] as? [Int])?.first
        await common(d, &m)
        var eps: [String: EpisodeMeta] = [:]
        let seasons = Set(episodes.compactMap { Int($0.split(separator: "-")[0]) })
        for s in seasons.sorted() {
            guard let sd = try? await tmdb.season(id, s), let list = sd["episodes"] as? [[String: Any]] else { continue }
            for ep in list {
                guard let n = ep["episode_number"] as? Int, episodes.contains("\(s)-\(n)") else { continue }
                let still = await tmdb.image(ep["still_path"] as? String, size: "w300")
                eps["\(s)-\(n)"] = EpisodeMeta(title: ep["name"] as? String, overview: ep["overview"] as? String,
                                               still: still?.path, runtime: ep["runtime"] as? Int)
            }
        }
        m.episodes = eps
        return m
    }

    // MARK: actions demandées par l'interface

    func setKey(_ key: String) async throws {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            settings.tmdbKey = nil; tmdb.key = nil; saveSettings(); emitState(); return
        }
        let old = tmdb.key
        tmdb.key = trimmed
        do { try await tmdb.validate() } catch { tmdb.key = old; throw error }
        settings.tmdbKey = trimmed
        saveSettings()
        refresh(retryUnmatched: true)
    }

    func search(_ kind: String, _ query: String) async throws -> String {
        struct R: Codable { var id: Int; var title: String; var year: String; var poster: String?; var overview: String? }
        let res = try await tmdb.search(kind, query)
        return res.prefix(12).compactMap { r -> R? in
            guard let id = r["id"] as? Int else { return nil }
            let date = (r["release_date"] ?? r["first_air_date"]) as? String ?? ""
            return R(id: id, title: cleanTitle((r["title"] ?? r["name"]) as? String ?? ""), year: String(date.prefix(4)),
                     poster: (r["poster_path"] as? String).map { "https://image.tmdb.org/t/p/w154" + $0 },
                     overview: r["overview"] as? String)
        }.json
    }

    func setMatch(_ key: String, _ id: Int) {
        settings.matches[key] = id
        meta[key] = nil
        saveSettings()
        refresh()
    }

    // MARK: playlists

    private func savePlaylists() {
        writeJSON(playlists, "playlists.json")
        emitState()
    }

    /// Réassocie les entrées de playlist dont le fichier a été déplacé, si un seul morceau
    /// de la bibliothèque correspond exactement à son titre, son artiste et son album.
    private func reconcilePlaylists() {
        let byMetadata = Dictionary(grouping: trackIndex.values, by: { item in
            [item.meta.title, item.meta.artist, item.meta.album].map(normalized).joined(separator: "\u{0}")
        })
        let currentPaths = Set(trackIndex.values.map(\.path))
        var changed = false
        for playlistIndex in playlists.indices {
            for entryIndex in playlists[playlistIndex].entries.indices {
                let entry = playlists[playlistIndex].entries[entryIndex]
                guard !currentPaths.contains(entry.path) else { continue }
                let key = [entry.title, entry.artist, entry.album].map(normalized).joined(separator: "\u{0}")
                guard let matches = byMetadata[key], matches.count == 1, let match = matches.first else { continue }
                playlists[playlistIndex].entries[entryIndex].path = match.path
                changed = true
            }
        }
        if changed { savePlaylists() }
    }

    private func entries(_ trackIds: [String]) -> [PlaylistEntry] {
        trackIds.compactMap { id in
            trackIndex[id].map { PlaylistEntry(path: $0.path, title: $0.meta.title, artist: $0.meta.artist, album: $0.meta.album) }
        }
    }

    private func cleanName(_ name: String) -> String {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return String((n.isEmpty ? "Nouvelle playlist" : n).prefix(120))
    }

    func playlistCreate(_ name: String, _ trackIds: [String]) -> String {
        let id = sha(UUID().uuidString)
        playlists.append(Playlist(id: id, name: cleanName(name), entries: entries(trackIds), created: Date().timeIntervalSince1970))
        savePlaylists()
        return id
    }

    func playlistRename(_ id: String, _ name: String) {
        guard let i = playlists.firstIndex(where: { $0.id == id }) else { return }
        playlists[i].name = cleanName(name)
        savePlaylists()
    }

    func playlistDelete(_ id: String) {
        playlists.removeAll { $0.id == id }
        savePlaylists()
    }

    /// Ajoute des morceaux (ceux déjà présents ne sont pas ajoutés deux fois). Renvoie le nombre ajouté.
    func playlistAdd(_ id: String, _ trackIds: [String]) -> Int {
        guard let i = playlists.firstIndex(where: { $0.id == id }) else { return 0 }
        let have = Set(playlists[i].entries.map(\.path))
        let new = entries(trackIds).filter { !have.contains($0.path) }
        playlists[i].entries += new
        savePlaylists()
        return new.count
    }

    func playlistRemove(_ id: String, _ index: Int) {
        guard let i = playlists.firstIndex(where: { $0.id == id }), playlists[i].entries.indices.contains(index) else { return }
        playlists[i].entries.remove(at: index)
        savePlaylists()
    }

    func playlistMove(_ id: String, _ from: Int, _ to: Int) {
        guard let i = playlists.firstIndex(where: { $0.id == id }), playlists[i].entries.indices.contains(from) else { return }
        let e = playlists[i].entries.remove(at: from)
        playlists[i].entries.insert(e, at: max(0, min(to, playlists[i].entries.count)))
        savePlaylists()
    }

    func saveProgress(_ id: String, _ pos: Double, _ dur: Double) {
        progress[id] = Progress(pos: pos, dur: dur, at: Date().timeIntervalSince1970)
        writeJSON(progress, "progress.json")
    }

    // MARK: état envoyé à l'interface

    private func scheduleEmit() {
        guard !emitPending else { return }
        emitPending = true
        Task { try? await Task.sleep(nanoseconds: 800_000_000); emitPending = false; emitState() }
    }

    func emitState() { onEvent?("state", stateJSON()) }

    func stateJSON() -> String {
        let fm = FileManager.default
        func url(_ p: String?) -> String? { p.map(mediaURL) }
        var vpaths = Set<String>()
        func out(_ f: VideoFile) -> FileOut {
            let u = resolve(f)
            let path = u?.path ?? (f.rel.hasPrefix("/") ? f.rel : "/Volumes/\(f.volumeName)/\(f.rel)")
            if let u { vpaths.insert(u.path) }
            return FileOut(id: f.id, url: u.map { mediaURL($0.path) } ?? "", path: path, ext: f.ext,
                           volume: volumeNames[f.volume] ?? f.volumeName, size: f.size,
                           available: u.map { fm.fileExists(atPath: $0.path) } ?? false, native: Video.native.contains(f.ext))
        }

        var movies: [MovieOut] = []
        for (key, group) in movieGroups {
            let m = meta[key] ?? MediaMeta()
            let outs = group.map(out).sorted { ($0.available ? 1 : 0, $0.size) > ($1.available ? 1 : 0, $1.size) }
            let thumb = group.lazy.compactMap { self.thumbs[$0.id] }.first
            movies.append(MovieOut(id: sha(key), key: key, title: cleanTitle(m.title ?? group[0].title), year: m.year ?? group[0].year,
                                   overview: m.overview, runtime: m.runtime, genres: m.genres ?? [], rating: m.rating,
                                   poster: url(m.poster), backdrop: url(m.backdrop), thumb: url(thumb),
                                   colors: m.colors ?? thumb.flatMap { palettes[$0] }, tmdbId: m.tmdbId, files: outs))
        }
        var shows: [ShowOut] = []
        for (key, group) in showGroups {
            let m = meta[key] ?? MediaMeta()
            var seasons: [SeasonOut] = []
            for (s, eps) in Dictionary(grouping: group, by: { $0.season ?? 0 }) {
                var seen = Set<Int>()
                let list = eps.sorted { ($0.episode ?? 0, $1.size) < ($1.episode ?? 0, $0.size) }.filter { seen.insert($0.episode ?? 0).inserted }
                seasons.append(SeasonOut(n: s, episodes: list.map { f in
                    let e = f.episode ?? 0
                    let em = m.episodes?["\(s)-\(e)"]
                    return EpisodeOut(id: f.id, s: s, e: e, title: em?.title ?? "Épisode \(e)", overview: em?.overview,
                                      still: url(em?.still ?? thumbs[f.id]), runtime: em?.runtime ?? m.runtime, file: out(f))
                }))
            }
            let thumb = group.lazy.compactMap { self.thumbs[$0.id] }.first
            shows.append(ShowOut(id: sha(key), key: key, title: cleanTitle(m.title ?? group[0].title), year: m.year, overview: m.overview,
                                 genres: m.genres ?? [], rating: m.rating, poster: url(m.poster), backdrop: url(m.backdrop),
                                 thumb: url(thumb), colors: m.colors ?? thumb.flatMap { palettes[$0] }, tmdbId: m.tmdbId,
                                 seasons: seasons.sorted { $0.n < $1.n }))
        }

        var vols: [VolumeOut] = []
        let externalUUIDs = Set(volumeNames.keys).union(mounted.values.filter { $0.external }.map(\.uuid))
        for uuid in externalUUIDs {
            let fs = files.filter { $0.volume == uuid }
            let v = mounted[uuid]
            if fs.isEmpty && v == nil { continue }
            vols.append(VolumeOut(uuid: uuid, name: v?.name ?? volumeNames[uuid] ?? "Disque", mounted: v != nil, external: true,
                                  movies: fs.filter { $0.kind == "movie" }.count, episodes: fs.filter { $0.kind == "episode" }.count))
        }

        videoPaths = vpaths
        let byTitle = { (a: String, b: String) in a.localizedStandardCompare(b) == .orderedAscending }
        return StateOut(albums: albums,
                        movies: movies.sorted { byTitle($0.title, $1.title) },
                        shows: shows.sorted { byTitle($0.title, $1.title) },
                        volumes: vols.sorted { byTitle($0.name, $1.name) },
                        playlists: playlists.map { pl in
                            PlaylistOut(id: pl.id, name: pl.name, tracks: pl.entries.map {
                                PlaylistTrackOut(id: sha($0.path), title: $0.title, artist: $0.artist, album: $0.album) })
                        },
                        settings: SettingsOut(musicFolders: settings.musicFolders, videoFolders: settings.videoFolders, hasKey: settings.tmdbKey != nil),
                        progress: progress, status: status).json
    }
}
