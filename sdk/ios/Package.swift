// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AeroLog",
    platforms: [.iOS(.v13), .macOS(.v11)],
    products: [
        .library(name: "AeroLog", targets: ["AeroLog"])
    ],
    targets: [
        .target(name: "AeroLog", path: "Sources/AeroLog"),
        .testTarget(name: "AeroLogTests", dependencies: ["AeroLog"], path: "Tests/AeroLogTests")
    ]
)
