// SplitflapApp — the macOS Tahoe app entry point.
//
// A plain SwiftUI window (resizable, with the standard green full-screen
// button; `f` toggles full screen, `q`/Esc quit). The window is the board; on
// full screen it fills the display like the Pi/SDL builds, but here it's an
// ordinary desktop window you can also run alongside other apps.

import SwiftUI
import AppKit

/// Command-line configuration. With no URL it falls back to the shared demo
/// board, so `swift run splitflap-mac` (or a double-click) just works.
struct Config {
    var url = "https://gist.githubusercontent.com/louisroehrs/003813d760ae8e0588dc53690c5c530f/raw/hackerdojosign.txt"
    var cols = 32
    var rows = 6
    var interval: TimeInterval = 60
    var volume: Float = 0.6
    var sound = true
}

func parseConfig() -> Config {
    var cfg = Config()
    let args = Array(CommandLine.arguments.dropFirst())
    var i = 0
    while i < args.count {
        let a = args[i]
        func value() -> String? { i + 1 < args.count ? { i += 1; return args[i] }() : nil }
        switch a {
        case "--cols": if let v = value(), let n = Int(v) { cfg.cols = n }
        case "--rows": if let v = value(), let n = Int(v) { cfg.rows = n }
        case "--interval": if let v = value(), let n = Double(v) { cfg.interval = n }
        case "--volume": if let v = value(), let n = Float(v) { cfg.volume = n }
        case "--mute", "--no-sound": cfg.sound = false
        default: if !a.hasPrefix("--") { cfg.url = a }
        }
        i += 1
    }
    return cfg
}

/// Make the SwiftPM executable behave like a normal foreground app (Dock icon,
/// menu bar, key focus) and quit when its window closes.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
struct SplitflapApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model: BoardModel

    init() {
        let cfg = parseConfig()
        _model = State(initialValue: BoardModel(
            url: cfg.url, cols: cfg.cols, rows: cfg.rows, interval: cfg.interval,
            volume: cfg.volume, sound: cfg.sound
        ))
    }

    var body: some Scene {
        WindowGroup("Split-Flap Board") {
            BoardView(model: model)
                .background(Color.black)
                .ignoresSafeArea()
                .onAppear { model.start() }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 960, height: 540)
        .commands {
            CommandGroup(replacing: .newItem) {} // no "New Window"
        }
    }
}
