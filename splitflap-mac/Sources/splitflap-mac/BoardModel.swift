// BoardModel — the animated split-flap state, independent of pixels.
//
// Mirrors the Zig/Rust/Python siblings: a rows×cols grid of cells, each rolling
// FORWARD through the FLAPS alphabet one mechanical flip at a time toward its
// target character. Text is fetched from a URL on an interval. The grid size is
// fixed by cols/rows; pixel layout lives entirely in the view/renderer.

import Foundation
import Observation

/// The flap alphabet. Order matters — the flip rolls forward through it, like
/// the physical drum. Matches the other builds (including `°` and `~`).
let FLAPS: [Character] = Array(" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:\"`'!?-/|\\_^@$&()#%+*=°~")

/// Frames spent on a single flip. At 60 FPS, 18 frames ≈ 300 ms per character.
let FRAMES_PER_STEP = 18

/// Fast lookup from character to flap index (built once).
private let FLAP_INDEX: [Character: Int] = {
    var m = [Character: Int]()
    for (i, ch) in FLAPS.enumerated() where m[ch] == nil { m[ch] = i }
    return m
}()

struct Cell {
    var cur = 0
    var target = 0
    var frame = 0

    var isAnimating: Bool { cur != target || frame != 0 }
}

@Observable
@MainActor
final class BoardModel {
    let cols: Int
    let rows: Int
    let url: String
    let interval: TimeInterval

    var cells: [Cell]
    /// Bumped whenever something visibly changed, so the Canvas redraws.
    var tick: Int = 0

    @ObservationIgnored private var frameTimer: Timer?
    @ObservationIgnored private var fetchTimer: Timer?
    @ObservationIgnored private let audio: ClatterAudio

    init(url: String, cols: Int, rows: Int, interval: TimeInterval,
         volume: Float = 0.6, sound: Bool = true) {
        self.url = url
        self.cols = cols
        self.rows = rows
        self.interval = interval
        self.cells = Array(repeating: Cell(), count: rows * cols)
        self.audio = ClatterAudio(volume: volume, enabled: sound)
    }

    /// Map an arbitrary character onto a flap index (uppercased ASCII; unknown
    /// characters fall back to space at index 0).
    private func flapIndex(_ ch: Character) -> Int {
        if let i = FLAP_INDEX[ch] { return i }
        if let up = ch.uppercased().first, let i = FLAP_INDEX[up] { return i }
        return 0
    }

    /// Aim each cell at the fetched text. Lines/columns beyond the grid are
    /// ignored; short lines are padded with spaces so the board mirrors layout.
    func setText(_ lines: [String]) {
        for r in 0..<rows {
            let line = r < lines.count ? Array(lines[r]) : []
            for col in 0..<cols {
                let ch: Character = col < line.count ? line[col] : " "
                cells[r * cols + col].target = flapIndex(ch)
            }
        }
        tick &+= 1
    }

    /// Advance every animating cell one frame. Called at 60 Hz. Each card that
    /// lands this frame plays a "clack".
    private func step() {
        var moved = false
        var landed = 0
        for i in cells.indices where cells[i].isAnimating {
            if cells[i].cur == cells[i].target {
                cells[i].frame = 0
                continue
            }
            cells[i].frame += 1
            if cells[i].frame >= FRAMES_PER_STEP {
                cells[i].cur = (cells[i].cur + 1) % FLAPS.count
                cells[i].frame = 0
                landed += 1
            }
            moved = true
        }
        if moved { tick &+= 1 }
        if landed > 0 { audio.clack(landed) }
    }

    /// Kick off the 60 Hz animation timer and the fetch loop. Timers are added
    /// to the common run-loop mode so they keep firing during a live resize.
    func start() {
        audio.start()
        let ft = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.step() }
        }
        RunLoop.main.add(ft, forMode: .common)
        frameTimer = ft

        Task { await refresh() } // first fetch immediately

        let qt = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        RunLoop.main.add(qt, forMode: .common)
        fetchTimer = qt
    }

    private func refresh() async {
        setText(await fetchLines())
    }

    /// Fetch the text URL (with a cache-busting query). On any failure returns a
    /// short error board instead of throwing, so the display keeps running.
    private func fetchLines() async -> [String] {
        guard var comps = URLComponents(string: url) else { return ["BAD URL"] }
        var items = comps.queryItems ?? []
        items.append(URLQueryItem(name: "t", value: String(Date().timeIntervalSince1970)))
        comps.queryItems = items
        guard let u = comps.url else { return ["BAD URL"] }

        var req = URLRequest(url: u)
        req.setValue("splitflap-board/1.0", forHTTPHeaderField: "User-Agent")
        req.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode >= 400 {
                return ["FETCH ERROR", "HTTP \(http.statusCode)"]
            }
            let body = String(decoding: data, as: UTF8.self)
            var lines = body
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map { $0.hasSuffix("\r") ? String($0.dropLast()) : String($0) }
            // Drop the trailing empty segment a final newline produces.
            if body.hasSuffix("\n"), !lines.isEmpty { lines.removeLast() }
            return lines
        } catch {
            return ["FETCH ERROR", String(String(describing: error).prefix(80))]
        }
    }
}
