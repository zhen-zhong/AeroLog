import Foundation

public struct AeroConfig {
    /// AeroLog SaaS 官方 Collector 入口；私有化客户请覆盖 `serverUrl`。
    public static let defaultServerUrl = "https://collector.aerolog.cc"

    public let serverUrl: String
    public let token: String
    public let batchSize: Int
    public let flushInterval: TimeInterval
    public let storageLimit: Int
    public let autoTrackAppLifecycle: Bool
    public let debug: Bool

    public init(
        token: String,
        serverUrl: String = AeroConfig.defaultServerUrl,
        batchSize: Int = 50,
        flushInterval: TimeInterval = 5,
        storageLimit: Int = 10_000,
        autoTrackAppLifecycle: Bool = true,
        debug: Bool = false
    ) {
        self.serverUrl = serverUrl
        self.token = token
        self.batchSize = batchSize
        self.flushInterval = flushInterval
        self.storageLimit = storageLimit
        self.autoTrackAppLifecycle = autoTrackAppLifecycle
        self.debug = debug
    }
}
