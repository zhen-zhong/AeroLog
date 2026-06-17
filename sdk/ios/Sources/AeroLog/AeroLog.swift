import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// AeroLog iOS SDK 入口（线程安全单例）
public final class AeroLog {

    public static let shared = AeroLog()

    private static let SDK_NAME = "ios"
    private static let SDK_VERSION = "0.1.0"

    private var config: AeroConfig?
    private let lock = NSLock()
    private var buffer: [[String: Any]] = []
    private var superProps: [String: Any] = [:]
    private var anonId: String = ""
    private var userId: String?
    private var sessionId: String = UUID().uuidString
    private var store: EventStore?
    private var timer: Timer?
    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 15
        return URLSession(configuration: cfg)
    }()

    private init() {}

    // MARK: Public API

    public func setup(_ cfg: AeroConfig) {
        lock.lock(); defer { lock.unlock() }
        self.config = cfg
        self.store = EventStore(limit: cfg.storageLimit)
        let ud = UserDefaults.standard
        if let v = ud.string(forKey: "aerolog.anon_id") {
            anonId = v
        } else {
            anonId = "anon_" + UUID().uuidString
            ud.setValue(anonId, forKey: "aerolog.anon_id")
        }
        userId = ud.string(forKey: "aerolog.user_id")

        DispatchQueue.main.async { self.startTimer() }
        if cfg.autoTrackAppLifecycle { observeLifecycle() }
    }

    public func track(_ event: String, properties: [String: Any]? = nil) {
        enqueue(type: "track", event: event, properties: properties)
    }

    public func identify(_ uid: String) {
        let prev = userId
        userId = uid
        UserDefaults.standard.setValue(uid, forKey: "aerolog.user_id")
        if prev == nil {
            track("$SignUp", properties: ["$anonymous_id": anonId])
        }
    }

    public func logout() {
        userId = nil
        UserDefaults.standard.removeObject(forKey: "aerolog.user_id")
    }

    public func setProfile(_ props: [String: Any]) {
        enqueue(type: "profile_set", event: "", properties: props)
    }

    public func registerSuperProperties(_ props: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        for (k, v) in props { superProps[k] = v }
    }

    public func flush(completion: (() -> Void)? = nil) {
        DispatchQueue.global(qos: .utility).async {
            self.doFlush()
            completion?()
        }
    }

    // MARK: Internals

    private func enqueue(type: String, event: String, properties: [String: Any]?) {
        guard let cfg = config else {
            assertionFailure("AeroLog.shared.setup() not called"); return
        }
        let distinctId = userId ?? anonId
        var props: [String: Any] = [
            "$insert_id": UUID().uuidString,
            "$session_id": sessionId,
        ]
        autoProps(into: &props)
        for (k, v) in superProps { props[k] = v }
        properties?.forEach { props[$0.key] = $0.value }

        var ev: [String: Any] = [
            "type": type,
            "event": event,
            "distinct_id": distinctId,
            "anonymous_id": anonId,
            "time": Int(Date().timeIntervalSince1970 * 1000),
            "lib": ["name": Self.SDK_NAME, "version": Self.SDK_VERSION],
            "properties": props,
        ]
        if let uid = userId { ev["user_id"] = uid }

        lock.lock()
        buffer.append(ev)
        let isFull = buffer.count >= cfg.batchSize
        lock.unlock()
        if isFull { flush() }
    }

    private func autoProps(into p: inout [String: Any]) {
        p["$lib"] = Self.SDK_NAME
        p["$lib_version"] = Self.SDK_VERSION
        p["$os"] = "iOS"
        #if canImport(UIKit)
        p["$os_version"] = UIDevice.current.systemVersion
        p["$model"] = UIDevice.current.model
        if let w = UIScreen.main.bounds.width as CGFloat? { p["$screen_width"] = Int(w * UIScreen.main.scale) }
        if let h = UIScreen.main.bounds.height as CGFloat? { p["$screen_height"] = Int(h * UIScreen.main.scale) }
        #endif
        if let ver = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            p["$app_version"] = ver
        }
    }

    private func startTimer() {
        guard let cfg = config else { return }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: cfg.flushInterval, repeats: true) { [weak self] _ in
            self?.flush()
        }
    }

    private func doFlush() {
        guard let cfg = config else { return }
        // 1. 内存缓冲
        lock.lock()
        let pending = buffer; buffer.removeAll()
        lock.unlock()
        if !pending.isEmpty {
            let lines = pending.compactMap(toJSONString)
            if !send(lines: lines) { lines.forEach { store?.add($0) } }
        }
        // 2. 持久化重传
        while let items = store?.take(cfg.batchSize), !items.isEmpty {
            if send(lines: items.map { $0.payload }) {
                store?.remove(ids: items.map { $0.id })
            } else { break }
        }
    }

    private func send(lines: [String]) -> Bool {
        guard let cfg = config else { return false }
        let body = "[" + lines.joined(separator: ",") + "]"
        guard let data = body.data(using: .utf8),
              let url = URL(string: "\(cfg.serverUrl.trimmingCharacters(in: ["/"]))/v1/track?token=\(cfg.token)")
        else { return false }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("ios/\(Self.SDK_VERSION)", forHTTPHeaderField: "X-AeroLog-SDK")
        req.httpBody = data

        let sema = DispatchSemaphore(value: 0)
        var ok = false
        let task = session.dataTask(with: req) { _, resp, _ in
            if let r = resp as? HTTPURLResponse {
                ok = (200..<300).contains(r.statusCode) || (r.statusCode >= 400 && r.statusCode < 500 && r.statusCode != 429)
            }
            sema.signal()
        }
        task.resume()
        _ = sema.wait(timeout: .now() + 20)
        return ok
    }

    private func toJSONString(_ d: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: d) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    #if canImport(UIKit)
    private func observeLifecycle() {
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            self.track("$AppStart")
        }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            self.track("$AppEnd")
            self.flush()
        }
    }
    #else
    private func observeLifecycle() {}
    #endif
}

private extension CharacterSet {
    init(_ s: String) { self.init(charactersIn: s) }
}
