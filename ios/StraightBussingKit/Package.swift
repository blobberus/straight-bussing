// swift-tools-version:5.9
// StraightBussingKit: the pure logic of the Straight Bussing web app (web/js/core, web/js/data) ported to
// Swift value types, shared by the iPhone app and (later) its widget / Live Activity extension.
import PackageDescription

let package = Package(
    name: "StraightBussingKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "StraightBussingKit", targets: ["StraightBussingKit"]),
    ],
    targets: [
        .target(name: "StraightBussingKit", path: "Sources/StraightBussingKit"),
        .testTarget(
            name: "StraightBussingKitTests",
            dependencies: ["StraightBussingKit"],
            path: "Tests/StraightBussingKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
