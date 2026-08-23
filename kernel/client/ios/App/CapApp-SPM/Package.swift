// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),
        .package(name: "AparajitaCapacitorSecureStorage", path: "../../../../../node_modules/.bun/@aparajita+capacitor-secure-storage@8.0.0/node_modules/@aparajita/capacitor-secure-storage"),
        .package(name: "CapacitorApp", path: "../../../../../node_modules/.bun/@capacitor+app@8.1.1+6139e07751574bda/node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../../../node_modules/.bun/@capacitor+browser@8.0.4+6139e07751574bda/node_modules/@capacitor/browser")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "AparajitaCapacitorSecureStorage", package: "AparajitaCapacitorSecureStorage"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser")
            ]
        )
    ]
)
