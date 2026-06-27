# splitflap_board (Rust)

Full-screen split-flap (airport-style) text board — a Rust port of
`../python/splitflap_board.py`, intended for a Raspberry Pi running Ubuntu. It fetches a
few lines of text from a URL and animates them onto a mechanical split-flap
display with a true two-halves rotating flip (the top card folds down over the
bottom with vertical foreshortening, like a real Solari board). No browser.

## Zig port (`src/main.zig`)
There is also a Zig 0.16 port that mirrors the Rust version exactly (same
`FLAPS` alphabet, colours, two-phase fold, options, and behaviour). It links
SDL2 + SDL2_ttf and uses the Zig standard library's HTTP client (no `ureq`
equivalent needed).

```bash
# deps: SDL2, SDL2_ttf, and a monospace font (see candidates in src/main.zig)
#   Debian/Pi: sudo apt install libsdl2-dev libsdl2-ttf-dev fonts-dejavu-core
#   macOS:     brew install sdl2 sdl2_ttf
zig build -Doptimize=ReleaseFast
./zig-out/bin/splitflap_board URL --cols 32 --rows 6 --interval 60 --windowed
# or: zig build run -- URL --windowed
```

`build.zig` points include/lib at `/usr/local` (Homebrew); on Debian/Pi the
system paths are picked up automatically. pkg-config is disabled there on
purpose — the SDL2 and SDL2_ttf `.pc` files each emit `-lSDL2`, and the
duplicate makes dyld refuse to load the binary on macOS.

## Behaviour parity with the Python version
- Same `FLAPS` alphabet, colours, two-phase fold, and per-card shading.
- Fullscreen by default; `Esc` or `q` quits; cursor hidden in fullscreen.
- Blank lines are preserved so the board mirrors the file's layout.
- Lines are padded/truncated to `--cols`; rows beyond `--rows` are ignored.
- A cache-busting `?t=<nanos>` query is appended on each fetch.

## Rust toolchain (1.86.0+ required)
The dependencies require **rustc ≥ 1.86.0**. Distro-packaged Rust is too old —
Debian Trixie freezes `rustc`/`cargo` at 1.85 via apt, so `apt` will never give
you 1.86. Use [rustup](https://rustup.rs) for an up-to-date upstream toolchain
instead.

```bash
# remove any apt-packaged Rust so it doesn't shadow rustup
sudo apt remove -y rustc cargo

# install rustup and pull current stable (well past 1.86)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable

# verify: must be >= 1.86, and from ~/.cargo/bin (not /usr/bin)
rustc --version
which rustc
```

If `which rustc` still shows `/usr/bin/rustc`, `/usr/bin` is ahead of
`~/.cargo/bin` on your `PATH` — open a new shell or re-run
`source "$HOME/.cargo/env"`. To pin exactly 1.86.0 rather than latest stable:
`rustup toolchain install 1.86.0 && rustup default 1.86.0`.

## Build (Debian / Ubuntu / Raspberry Pi OS)
```bash
sudo apt update
sudo apt install -y build-essential libsdl2-dev libsdl2-ttf-dev fonts-dejavu-core
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
