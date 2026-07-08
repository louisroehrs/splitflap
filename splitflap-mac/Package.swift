// swift-tools-version: 6.0
import PackageDescription

// Native macOS Tahoe (macOS 26) split-flap board. Pure SwiftUI + AppKit — no
// SDL2, no Homebrew. Build/run from the command line:
//
//     swift run splitflap-mac https://example.com/board.txt --cols 32 --rows 6
//
// or open Package.swift in Xcode 26 and Run.
let package = Package(
    name: "splitflap-mac",
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(
            name: "splitflap-mac",
            path: "Sources/splitflap-mac"
        ),
    ]
)
