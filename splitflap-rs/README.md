# splitflap_board (Rust)

Full-screen split-flap (airport-style) text board — a Rust port of
`../splitflap_board.py`, intended for a Raspberry Pi running Ubuntu. It fetches a
few lines of text from a URL and animates them onto a mechanical split-flap
display with a true two-halves rotating flip (the top card folds down over the
bottom with vertical foreshortening, like a real Solari board). No browser.

## Behaviour parity with the Python version
- Same `FLAPS` alphabet, colours, two-phase fold, and per-card shading.
- Fullscreen by default; `Esc` or `q` quits; cursor hidden in fullscreen.
- Blank lines are preserved so the board mirrors the file's layout.
- Lines are padded/truncated to `--cols`; rows beyond `--rows` are ignored.
- A cache-busting `?t=<nanos>` query is appended on each fetch.

## Build (Ubuntu / Raspberry Pi OS)
```bash
sudo apt update
sudo apt install -y build-essential libsdl2-dev libsdl2-ttf-dev fonts-dejavu-core
# install Rust if needed: https://rustup.rs
cargo build --release
```

## Run
```bash
./target/release/splitflap_board https://example.com/board.txt
# options
./target/release/splitflap_board URL --cols 32 --rows 6 --interval 60 --windowed
```

## Notes
- Needs an X/Wayland session (SDL2 opens a window). For a kiosk, launch it from
  the desktop autostart or a systemd user service.
- The font is auto-detected from common DejaVu Sans Mono paths; install
  `fonts-dejavu-core` if startup reports no font found.
- The fetch runs on the main loop with a 10 s timeout; a slow URL briefly pauses
  the animation. Move it to a thread if that matters for your URL.
- Performance: each glyph tile is rasterized once into a GPU texture; folds use
  hardware texture scaling. An idle board does no drawing. Tune `FRAMES_PER_STEP`
  and `FPS` at the top of `src/main.rs`.
