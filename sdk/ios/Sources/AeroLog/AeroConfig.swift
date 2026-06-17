import Foundation

public struct AeroConfig {
    public let serverUrl: String
    public let token: String
    public let batchSize: Int
    public let flushInterval: TimeInterval
    public let storageLimit: Int
    public let autoTrackAppLifecycle: Bool
    public let debug: Bool

    public init(
        serverUrl: String,
        token: String,
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
