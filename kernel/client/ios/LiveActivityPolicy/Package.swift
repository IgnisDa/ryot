// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "IosLiveActivityPolicy",
    targets: [
        .target(name: "IosLiveActivityPolicy"),
        .testTarget(name: "IosLiveActivityPolicyTests", dependencies: ["IosLiveActivityPolicy"])
    ]
)
