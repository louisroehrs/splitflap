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

### Notes on the Zig port
- **HTTP**: uses the Zig stdlib `std.http.Client` instead of `ureq` — no
  third-party dependency at all.
- **SDL** is pulled in via `@cImport` of the C headers (`SDL.h`, `SDL_ttf.h`);
  textures/surfaces/renderer map directly onto the Rust `sdl2` crate calls.
- **Timing & font lookup** use SDL itself (`SDL_GetTicks64`,
  `SDL_GetPerformanceCounter`, and `TTF_OpenFont` probing) rather than
  `std.time`/`std.fs`, which in Zig 0.16 now require the new `Io` interface.
- **Fonts**: the candidate list includes macOS paths (Andale Mono / SFNSMono)
  alongside the Linux/Pi DejaVu paths.
- Targets **Zig 0.16**: `main` takes a `std.process.Init` parameter, `ArrayList`
  is initialized with `.empty` and takes the allocator on `append`, and the
  default allocator is `std.heap.DebugAllocator`.

### Running the Zig build on a Raspberry Pi
`build.zig` works on the Pi as-is: the `/usr/local` include/lib paths are
harmless extras, and the SDL headers/libs in the standard system paths
(`/usr/include/SDL2`, `/usr/lib/...`) are found automatically. Disabling
pkg-config just becomes a plain `-lSDL2 -lSDL2_ttf` on Linux.

1. **Install the SDL2 deps + a font:**
   ```bash
   sudo apt update
   sudo apt install -y libsdl2-dev libsdl2-ttf-dev fonts-dejavu-core
   ```

2. **Install Zig 0.16** (apt's Zig is too old). Check your arch with `uname -m`
   (`aarch64` → 64-bit, `armv7l` → 32-bit), then grab the official build:
   ```bash
   # 64-bit Raspberry Pi OS (Pi 4/5): ARCH=aarch64
   # 32-bit Raspberry Pi OS:          ARCH=armv7a
   ARCH=aarch64
   cd /tmp
   curl -LO "https://ziglang.org/download/0.16.0/zig-${ARCH}-linux-0.16.0.tar.xz"
   tar xf "zig-${ARCH}-linux-0.16.0.tar.xz"
   sudo mv "zig-${ARCH}-linux-0.16.0" /opt/zig
   sudo ln -sf /opt/zig/zig /usr/local/bin/zig
   zig version    # should print 0.16.0
   ```
   If the exact filename 404s, see the index at https://ziglang.org/download/.

3. **Build and run:**
   ```bash
   cd splitflap-rs
   zig build -Doptimize=ReleaseFast

   # windowed (needs a desktop session):
   ./zig-out/bin/splitflap_board https://example.com/board.txt --windowed

   # fullscreen kiosk:
   ./zig-out/bin/splitflap_board https://example.com/board.txt --cols 32 --rows 6 --interval 60
   ```

Needs an X/Wayland session (SDL2 opens a window), same as the Rust version. For
an always-on display, launch it from the desktop autostart or a systemd user
service. Building natively on the Pi is simplest; cross-compiling from another
machine with `-Dtarget=aarch64-linux-gnu` is possible but needs the Pi's SDL2
libraries/headers available as a sysroot.

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

## Run (Rust)
```bash
./target/release/splitflap_board https://example.com/board.txt
# options
./target/release/splitflap_board URL --cols 32 --rows 6 --interval 60 --windowed
```

## Run (Zig)
The Zig port (`src/main.zig`) takes the same arguments. See the
[Zig port](#zig-port-srcmainzig) section above for installing Zig and the SDL2
deps; once built it runs from `zig-out/bin/`:

```bash
# build first (debug, or -Doptimize=ReleaseFast for release)
zig build -Doptimize=ReleaseFast

# fullscreen
./zig-out/bin/splitflap_board https://example.com/board.txt
# options
./zig-out/bin/splitflap_board URL --cols 32 --rows 6 --interval 60 --windowed

# build and run in one step (args after --)
zig build run -- https://example.com/board.txt --windowed
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
