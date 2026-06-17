import Foundation

/// 简易 SQLite 队列：使用文件 + 行 JSON 的极简实现，避免引入额外依赖。
/// 生产级别建议替换为 GRDB 或 sqlite3 直连。
final class EventStore {
    struct Item {
        let id: Int64
        let payload: String
    }

    private let url: URL
    private let queue = DispatchQueue(label: "dev.aerolog.store")
    private var nextId: Int64 = 0
    private let limit: Int

    init(limit: Int) {
        self.limit = limit
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("AeroLog", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.url = dir.appendingPathComponent("events.ndjson")
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
    }

    func add(_ payload: String) {
        queue.sync {
            nextId += 1
            let line = "\(nextId)\t\(payload)\n"
            if let data = line.data(using: .utf8),
               let h = try? FileHandle(forWritingTo: url) {
                defer { try? h.close() }
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: data)
            }
            evictIfNeeded()
        }
    }

    func take(_ n: Int) -> [Item] {
        queue.sync {
            guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [] }
            return raw.split(separator: "\n").prefix(n).compactMap { line -> Item? in
                let parts = line.split(separator: "\t", maxSplits: 1)
                guard parts.count == 2, let id = Int64(parts[0]) else { return nil }
                return Item(id: id, payload: String(parts[1]))
            }
        }
    }

    func remove(ids: [Int64]) {
        guard !ids.isEmpty else { return }
        queue.sync {
            let set = Set(ids)
            guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return }
            let kept = raw.split(separator: "\n").filter { line in
                guard let id = line.split(separator: "\t", maxSplits: 1).first.flatMap({ Int64($0) }) else { return false }
                return !set.contains(id)
            }
            let out = kept.joined(separator: "\n") + (kept.isEmpty ? "" : "\n")
            try? out.write(to: url, atomically: true, encoding: .utf8)
        }
    }

    private func evictIfNeeded() {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return }
        let lines = raw.split(separator: "\n")
        if lines.count <= limit { return }
        let keep = lines.suffix(limit)
        let out = keep.joined(separator: "\n") + "\n"
        try? out.write(to: url, atomically: true, encoding: .utf8)
    }
}
