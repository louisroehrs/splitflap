# splitflap-mac

A native **macOS Tahoe (macOS 26)** split-flap (airport / Solari-style) text
board. It's the desktop-app sibling of `../splitflap-rs` (Rust/Zig + SDL2) and
`../pythonmac` (pygame) — same `FLAPS` alphabet, colours, and two-phase fold —
but built with **pure SwiftUI + AppKit**: no SDL2, no Homebrew, no dependencies
at all beyond the system frameworks.

It fetches plain text from a URL (one line per row, the same `../sign.txt`
format) and animates it onto a mechanical split-flap grid inside an ordinary
desktop **window you can resize and full-screen** with the standard green
title-bar button.

## Requirements

- macOS 26 (Tahoe) and the Swift 6 toolchain (Xcode 26 or the command-line
  tools). No third-party packages.

## Build & run

From the command line:

```bash
cd splitflap-mac
swift run splitflap-mac                     # uses the demo board, 32×6
swift run splitflap-mac https://example.com/sign.txt --cols 32 --rows 6 --interval 60
```

Or open `Package.swift` in **Xcode 26** and press Run.

A release build:

```bash
swift build -c release
./.build/release/splitflap-mac https://example.com/sign.txt
```

### Options

| Arg | Default | Meaning |
| --- | --- | --- |
| `URL` (positional) | shared demo gist | Plain-text board, one line per row |
| `--cols N` | 32 | Characters per row |
| `--rows N` | 6 | Number of rows |
| `--interval S` | 60 | Seconds between refetches |
| `--volume F` | 0.6 | Clatter loudness, 0.0–1.0 |
| `--mute` / `--no-sound` | — | Silence the clatter |

## Window & keys

- **Resize** the window freely — the grid re-lays-out and the glyphs re-render
  crisply at the new size (and the current backing scale, so it's sharp on
  Retina).
- **Full screen**: the green title-bar button, the View ▸ Enter Full Screen
  menu item, or press **`f`**.
- **Quit**: `⌘Q`, or press **`q`** / **Esc**.

## How it works

- `BoardModel` (`@Observable`, `@MainActor`) holds the rows×cols grid. Each cell
  rolls *forward* through `FLAPS` one flip at a time toward its target; a 60 Hz
  timer advances the animation and a fetch timer refreshes the text.
- `FlapRenderer` pre-renders each flap character to a tile (dark card + seam +
  bold `SF Mono` glyph centred on the seam) with SwiftUI's `ImageRenderer`, then
  slices it into top/bottom halves. It rebuilds only when the cell size changes.
- `BoardView` paints the whole board every frame with a `Canvas`. The fold is
  the same two phases as the other builds: the current card's top folds down to
  the seam (vertical squash + shadow), then the next card's bottom drops from
  it.

The grid size is fixed by `--cols`/`--rows`; only the pixel layout depends on
the window size, so resizing never reflows the text.

## Solari clatter sound

Each flap card that lands plays a short synthesized "clack"; a full-board update
overlaps them into the classic Solari clatter. The clicks are generated at
startup (no audio files) and mixed in an `AVAudioSourceNode` render callback,
played through the default output device. Tune with `--volume`, or silence with
`--mute`. If the audio engine can't start it's non-fatal — the board runs
silent. (This matches the Zig build in `../splitflap-rs`.)

## Notes

- Running via `swift run` produces a plain executable, not a `.app` bundle; it
  still gets a Dock icon, menu bar, and full-screen support because the app sets
  its activation policy at launch. To ship a real `.app`, build the Xcode
  target as an app.
