import Foundation

/// Client TMDB (themoviedb.org). Accepte une « clé d'API » v3 ou un « jeton d'accès » v4.
/// Seuls des titres de films/séries sont envoyés ; les réponses et images sont mises en cache.
final class TMDB {
    enum Failure: LocalizedError {
        case noKey, badKey, http(Int), offline
        var errorDescription: String? {
            switch self {
            case .noKey: return "Aucune clé TMDB."
            case .badKey: return "Clé TMDB refusée. Vérifiez-la dans les Réglages."
            case .http(let c): return "TMDB ne répond pas correctement (erreur \(c))."
            case .offline: return "Pas de connexion à TMDB."
            }
        }
    }

    var key: String?
    private let base = "https://api.themoviedb.org/3"

    func get(_ path: String, _ query: [String: String] = [:]) async throws -> [String: Any] {
        guard let key, !key.isEmpty else { throw Failure.noKey }
        var comps = URLComponents(string: base + path)!
        var items = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        let bearer = key.hasPrefix("eyJ")
        if !bearer { items.append(URLQueryItem(name: "api_key", value: key)) }
        comps.queryItems = items
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if bearer { req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw Failure.offline }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw Failure.badKey }
        guard code == 200, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.http(code) }
        return obj
    }

    /// Réponse gardée 30 jours sur le disque
    private func cached(_ name: String, _ fetch: () async throws -> [String: Any]) async throws -> [String: Any] {
        let file = Paths.tmdb.appendingPathComponent(name + ".json")
        if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
           let date = attrs[.modificationDate] as? Date, Date().timeIntervalSince(date) < 30 * 86400,
           let data = try? Data(contentsOf: file), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return obj
        }
        let obj = try await fetch()
        if let data = try? JSONSerialization.data(withJSONObject: obj) { try? data.write(to: file, options: .atomic) }
        return obj
    }

    func validate() async throws { _ = try await get("/configuration") }

    func search(_ kind: String, _ query: String, year: Int? = nil) async throws -> [[String: Any]] {
        var q = ["query": query, "language": "fr-FR", "include_adult": "false"]
        if let year { q[kind == "tv" ? "first_air_date_year" : "year"] = String(year) }
        var results = try await get("/search/\(kind)", q)["results"] as? [[String: Any]] ?? []
        if results.isEmpty, year != nil { results = try await search(kind, query) }
        return results
    }

    func details(_ kind: String, _ id: Int) async throws -> [String: Any] {
        var d = try await cached("\(kind)-\(id)") { try await get("/\(kind)/\(id)", ["language": "fr-FR"]) }
        if (d["overview"] as? String ?? "").isEmpty,
           let en = try? await cached("\(kind)-\(id)-en", { try await get("/\(kind)/\(id)", ["language": "en-US"]) }) {
            d["overview"] = en["overview"]
        }
        return d
    }

    func season(_ id: Int, _ n: Int) async throws -> [String: Any] {
        try await cached("tv-\(id)-s\(n)") { try await get("/tv/\(id)/season/\(n)", ["language": "fr-FR"]) }
    }

    /// Télécharge une image TMDB (une seule fois) et renvoie son fichier local
    func image(_ path: String?, size: String) async -> URL? {
        guard let path, !path.isEmpty else { return nil }
        let out = Paths.images.appendingPathComponent(size + path.replacingOccurrences(of: "/", with: "_"))
        if FileManager.default.fileExists(atPath: out.path) { return out }
        guard let url = URL(string: "https://image.tmdb.org/t/p/\(size)\(path)"),
              let (data, resp) = try? await URLSession.shared.data(from: url),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        try? data.write(to: out, options: .atomic)
        return out
    }
}
