// splitflap_board — Full-screen split-flap (airport-style) text board for a
// Raspberry Pi running Ubuntu. Fetches a few lines of text from a URL and
// animates them onto a mechanical split-flap display with a true two-halves
// rotating flip: the top card folds down over the bottom with vertical
// foreshortening, like a real Solari board. No browser required.
//
// This is a Rust port of splitflap_board.py and mirrors its behaviour:
// stdlib-only-ish fetch, the same FLAPS alphabet, fullscreen, Esc/q to quit,
// blank lines preserved, and --cols/--rows/--interval/--windowed options.
//
// Build (on Ubuntu / Raspberry Pi OS):
//     sudo apt install libsdl2-dev libsdl2-ttf-dev
//     cargo build --release
//
// Run:
//     ./target/release/splitflap_board https://example.com/board.txt
//     ./target/release/splitflap_board URL --cols 32 --rows 6 --interval 60 --windowed
//
// Press Esc or q to quit.

use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use clap::Parser;
use sdl2::event::Event;
use sdl2::keyboard::Keycode;
use sdl2::pixels::{Color, PixelFormatEnum};
use sdl2::rect::Rect;
use sdl2::render::{Texture, TextureCreator, WindowCanvas};
use sdl2::surface::Surface;
use sdl2::video::WindowContext;

// The alphabet the flaps cycle through. Order matters: the flip animation rolls
// forward through this sequence, just like the physical drum does.
const FLAPS: &str = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:'!?-/@$&()#%+*=°";

// Colours tuned to look like a Solari board.
const BG: Color = Color::RGB(0, 0, 0);
const TILE_TOP: Color = Color::RGB(31, 31, 31); // upper-half card, a touch lighter
const TILE_BOT: Color = Color::RGB(22, 22, 22); // lower-half card
const TEXT: Color = Color::RGB(242, 242, 242);
const SEAM: Color = Color::RGB(0, 0, 0);

// Animation tuning. Frames spent on a single character step (one flap). Lower =
// faster clatter. At 60 FPS, 6 frames ≈ 100 ms per character.
const FRAMES_PER_STEP: u32 = 6;
const FPS: u32 = 60;

// Candidate paths for a bold monospace font on Ubuntu / Raspberry Pi OS.
const FONT_CANDIDATES: &[&str] = &[
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
];

#[derive(Parser, Debug)]
#[command(about = "Full-screen split-flap text board.")]
struct Args {
    /// URL returning plain text (one line per row).
    url: String,
    /// Characters per row.
    #[arg(long, default_value_t = 32)]
    cols: usize,
    /// Number of rows.
    #[arg(long, default_value_t = 6)]
    rows: usize,
    /// Seconds between refetches.
    #[arg(long, default_value_t = 60)]
    interval: u64,
    /// Run in a window instead of full screen (for testing).
    #[arg(long, default_value_t = false)]
    windowed: bool,
}

/// The ordered flap alphabet as a Vec<char> plus a char -> index lookup.
struct Alphabet {
    chars: Vec<char>,
    index: HashMap<char, usize>,
}

impl Alphabet {
    fn new() -> Self {
        let chars: Vec<char> = FLAPS.chars().collect();
        let index = chars.iter().enumerate().map(|(i, &c)| (c, i)).collect();
        Alphabet { chars, index }
    }

    fn len(&self) -> usize {
        self.chars.len()
    }

    fn char_at(&self, idx: usize) -> char {
        self.chars[idx % self.chars.len()]
    }

    /// Map an arbitrary character onto something the flaps can show.
    fn normalize_index(&self, ch: char) -> usize {
        let up = ch.to_ascii_uppercase();
        *self.index.get(&up).unwrap_or(&0) // 0 == space
    }
}

/// Return the lines of text fetched from `url`. Falls back to an error message
/// (rather than crashing) so the board keeps running. Blank lines are kept so
/// the board mirrors the file's layout. A cache-busting timestamp is appended.
fn fetch_lines(url: &str) -> Vec<Vec<char>> {
    let sep = if url.contains('?') { '&' } else { '?' };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let full = format!("{url}{sep}t={now}");
    let raw = match ureq::get(&full)
        .set("User-Agent", "splitflap-board/1.0")
        .timeout(Duration::from_secs(10))
        .call()
    {
        Ok(resp) => resp.into_string().unwrap_or_default(),
        Err(e) => {
            return vec![
                "FETCH ERROR".chars().collect(),
                truncate(&e.to_string(), 80).chars().collect(),
            ];
        }
    };
    // Keep blank lines so the board mirrors the file's layout.
    raw.lines().map(|ln| ln.chars().collect()).collect()
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Pre-renders every flap character into one full tile texture (dark tile +
/// seam + bold glyph). Top and bottom halves are drawn from the same texture
/// via source rects at render time, so we only rasterize each glyph once.
struct GlyphCache<'a> {
    w: u32,
    h: u32,
    half: u32,
    tiles: HashMap<char, Texture<'a>>,
}

impl<'a> GlyphCache<'a> {
    fn new(
        tc: &'a TextureCreator<WindowContext>,
        ttf: &sdl2::ttf::Sdl2TtfContext,
        font_path: &str,
        alpha: &Alphabet,
        w: u32,
        h: u32,
    ) -> Result<Self, String> {
        let half = h / 2;
        let pad = (w / 16).max(1) as i32;
        let seam_w = (h / 28).max(1);
        let fsize = ((h as f32 * 0.62) as u16).max(8);
        let mut font = ttf.load_font(font_path, fsize)?;
        font.set_style(sdl2::ttf::FontStyle::BOLD);

        let mut tiles = HashMap::new();
        for &ch in &alpha.chars {
            // Build the tile on a CPU surface, then upload to a texture.
            let mut surf = Surface::new(w, h, PixelFormatEnum::RGBA8888)?;
            surf.fill_rect(None, BG)?;
            surf.fill_rect(
                Rect::new(pad, pad, (w as i32 - 2 * pad) as u32, half - pad as u32),
                TILE_TOP,
            )?;
            surf.fill_rect(
                Rect::new(pad, half as i32, (w as i32 - 2 * pad) as u32, half - pad as u32),
                TILE_BOT,
            )?;

            // Render the glyph and blit it centred on the seam.
            let glyph = font
                .render(&ch.to_string())
                .blended(TEXT)
                .map_err(|e| e.to_string())?;
            let gw = glyph.width();
            let gh = glyph.height();
            let dst = Rect::new(
                (w as i32 - gw as i32) / 2,
                half as i32 - gh as i32 / 2,
                gw,
                gh,
            );
            glyph.blit(None, &mut surf, dst)?;

            // The split-flap seam line.
            surf.fill_rect(
                Rect::new(pad, half as i32, (w as i32 - 2 * pad) as u32, seam_w),
                SEAM,
            )?;

            let tex = tc
                .create_texture_from_surface(&surf)
                .map_err(|e| e.to_string())?;
            tiles.insert(ch, tex);
        }

        Ok(GlyphCache { w, h, half, tiles })
    }

    fn top_src(&self) -> Rect {
        Rect::new(0, 0, self.w, self.half)
    }

    fn bot_src(&self) -> Rect {
        Rect::new(0, self.half as i32, self.w, self.h - self.half)
    }
}

/// A single character cell. Animates from its current glyph toward a target by
/// rolling forward through the alphabet, one mechanical flip per intermediate.
struct Flap {
    x: i32,
    y: i32,
    cur: usize,
    target: usize,
    frame: u32, // frame within the current single-step flip
}

impl Flap {
    fn new(x: i32, y: i32) -> Self {
        Flap { x, y, cur: 0, target: 0, frame: 0 }
    }

    fn is_animating(&self) -> bool {
        self.cur != self.target || self.frame != 0
    }

    fn set_target(&mut self, idx: usize) {
        self.target = idx;
    }

    fn advance(&mut self, n_flaps: usize) {
        if self.cur == self.target {
            self.frame = 0;
            return;
        }
        self.frame += 1;
        if self.frame >= FRAMES_PER_STEP {
            self.cur = (self.cur + 1) % n_flaps;
            self.frame = 0;
        }
    }

    /// Draw this cell. `set_color_mod` darkens the moving card so the fold reads
    /// as catching shadow; it is reset to white afterwards.
    fn draw(&self, canvas: &mut WindowCanvas, cache: &mut GlyphCache, alpha: &Alphabet) {
        let cur_ch = alpha.char_at(self.cur);
        let half = cache.half;
        let w = cache.w;
        let seam_y = self.y + half as i32;
        let top_src = cache.top_src();
        let bot_src = cache.bot_src();

        // Settled: just paint the two static halves.
        if self.cur == self.target && self.frame == 0 {
            let tex = cache.tiles.get(&cur_ch).unwrap();
            let _ = canvas.copy(tex, top_src, Rect::new(self.x, self.y, w, half));
            let _ = canvas.copy(
                tex,
                bot_src,
                Rect::new(self.x, seam_y, w, cache.h - half),
            );
            return;
        }

        let next_ch = alpha.char_at(self.cur + 1);
        let t = self.frame as f32 / FRAMES_PER_STEP as f32; // 0..1 across the flip

        if t < 0.5 {
            // PHASE 1 — top card (top of current) folds down toward the seam.
            // Behind it next's top is already revealed; bottom is current.
            {
                let tn = cache.tiles.get(&next_ch).unwrap();
                let _ = canvas.copy(tn, top_src, Rect::new(self.x, self.y, w, half));
            }
            {
                let tc = cache.tiles.get(&cur_ch).unwrap();
                let _ = canvas.copy(tc, bot_src, Rect::new(self.x, seam_y, w, cache.h - half));
            }
            let angle = (t / 0.5) * std::f32::consts::FRAC_PI_2; // 0 → 90°
            let scaled_h = ((half as f32 * angle.cos()) as u32).max(1);
            let card = cache.tiles.get_mut(&cur_ch).unwrap();
            shade(card, t / 0.5);
            // Bottom edge pinned to the seam; top edge drops toward it.
            let _ = canvas.copy(
                card,
                top_src,
                Rect::new(self.x, seam_y - scaled_h as i32, w, scaled_h),
            );
            card.set_color_mod(255, 255, 255);
        } else {
            // PHASE 2 — next's bottom card falls from the seam downward.
            // Top settled to next; behind the falling card is next's bottom.
            {
                let tn = cache.tiles.get(&next_ch).unwrap();
                let _ = canvas.copy(tn, top_src, Rect::new(self.x, self.y, w, half));
                let _ = canvas.copy(tn, bot_src, Rect::new(self.x, seam_y, w, cache.h - half));
            }
            let angle = ((t - 0.5) / 0.5) * std::f32::consts::FRAC_PI_2; // 0 → 90°
            let scaled_h = ((half as f32 * angle.sin()) as u32).max(1);
            let card = cache.tiles.get_mut(&next_ch).unwrap();
            shade(card, 1.0 - (t - 0.5) / 0.5);
            // Top edge pinned to the seam; card grows downward as it lands.
            let _ = canvas.copy(card, bot_src, Rect::new(self.x, seam_y, w, scaled_h));
            card.set_color_mod(255, 255, 255);
        }
    }
}

/// Darken a card texture so the fold reads as catching shadow (amount 0..1).
fn shade(tex: &mut Texture, amount: f32) {
    let a = amount.clamp(0.0, 1.0);
    // python used alpha up to 150/255 of black; mirror with a colour-mod.
    let v = (255.0 - 150.0 * a) as u8;
    tex.set_color_mod(v, v, v);
}

struct Board {
    cols: usize,
    rows: usize,
    flaps: Vec<Vec<Flap>>,
}

impl Board {
    fn new(cache: &GlyphCache, screen_w: u32, screen_h: u32, cols: usize, rows: usize) -> Self {
        let cell_w = cache.w as i32;
        let cell_h = cache.h as i32;
        let gx = (screen_w as i32 - cell_w * cols as i32) / 2;
        let gy = (screen_h as i32 - cell_h * rows as i32) / 2;
        let flaps = (0..rows)
            .map(|r| {
                (0..cols)
                    .map(|c| Flap::new(gx + c as i32 * cell_w, gy + r as i32 * cell_h))
                    .collect()
            })
            .collect();
        Board { cols, rows, flaps }
    }

    /// Pad/truncate each line to `cols` and rows to `rows`, then aim each cell.
    fn set_text(&mut self, lines: &[Vec<char>], alpha: &Alphabet) {
        for r in 0..self.rows {
            let empty = Vec::new();
            let line = lines.get(r).unwrap_or(&empty);
            for c in 0..self.cols {
                let ch = line.get(c).copied().unwrap_or(' ');
                self.flaps[r][c].set_target(alpha.normalize_index(ch));
            }
        }
    }

    fn any_animating(&self) -> bool {
        self.flaps.iter().flatten().any(|f| f.is_animating())
    }
}

/// Cell-size derivation shared by GlyphCache and Board layout.
fn cell_size(screen_w: u32, screen_h: u32, cols: usize, rows: usize) -> (u32, u32) {
    let margin = (screen_w / 40).max(10) as i32;
    let cell_w = (screen_w as i32 - 2 * margin) / cols as i32;
    let cell_h = (screen_h as i32 - 2 * margin) / rows as i32;
    (cell_w.max(1) as u32, cell_h.max(1) as u32)
}

fn find_font() -> Result<&'static str, String> {
    FONT_CANDIDATES
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .copied()
        .ok_or_else(|| {
            "No DejaVu Sans Mono font found. Install with: sudo apt install fonts-dejavu-core"
                .to_string()
        })
}

fn main() -> Result<(), String> {
    let args = Args::parse();
    let alpha = Alphabet::new();
    let font_path = find_font()?;

    let sdl = sdl2::init()?;
    let video = sdl.video()?;
    let ttf = sdl2::ttf::init().map_err(|e| e.to_string())?;

    let mut builder = if args.windowed {
        video.window("Split-Flap Board", 960, 540)
    } else {
        let mut b = video.window("Split-Flap Board", 0, 0);
        b.fullscreen_desktop();
        b
    };
    let window = builder.position_centered().build().map_err(|e| e.to_string())?;
    if !args.windowed {
        sdl.mouse().show_cursor(false);
    }

    let mut canvas = window.into_canvas().accelerated().build().map_err(|e| e.to_string())?;
    let (screen_w, screen_h) = canvas.output_size()?;
    let tc = canvas.texture_creator();

    let (cw, ch) = cell_size(screen_w, screen_h, args.cols, args.rows);
    let mut cache = GlyphCache::new(&tc, &ttf, font_path, &alpha, cw, ch)?;
    let mut board = Board::new(&cache, screen_w, screen_h, args.cols, args.rows);

    // Initial paint of the settled (all-blank) board.
    canvas.set_draw_color(BG);
    canvas.clear();
    for row in &board.flaps {
        for flap in row {
            flap.draw(&mut canvas, &mut cache, &alpha);
        }
    }
    canvas.present();

    // First fetch immediately, then on the interval.
    board.set_text(&fetch_lines(&args.url), &alpha);
    let mut last_fetch = Instant::now();
    let interval = Duration::from_secs(args.interval);
    let frame_budget = Duration::from_secs_f64(1.0 / FPS as f64);

    let mut events = sdl.event_pump()?;
    'running: loop {
        let frame_start = Instant::now();

        for event in events.poll_iter() {
            match event {
                Event::Quit { .. }
                | Event::KeyDown { keycode: Some(Keycode::Escape), .. }
                | Event::KeyDown { keycode: Some(Keycode::Q), .. } => break 'running,
                _ => {}
            }
        }

        if last_fetch.elapsed() >= interval {
            board.set_text(&fetch_lines(&args.url), &alpha);
            last_fetch = Instant::now();
        }

        // Advance and, if anything moved, redraw. SDL's accelerated canvas has a
        // back buffer we must repaint fully each present, so we redraw the whole
        // board only when at least one cell is animating; an idle board sleeps.
        if board.any_animating() {
            for row in &mut board.flaps {
                for flap in row {
                    flap.advance(alpha.len());
                }
            }
            canvas.set_draw_color(BG);
            canvas.clear();
            for r in 0..board.rows {
                for c in 0..board.cols {
                    board.flaps[r][c].draw(&mut canvas, &mut cache, &alpha);
                }
            }
            canvas.present();
        }

        if let Some(rem) = frame_budget.checked_sub(frame_start.elapsed()) {
            std::thread::sleep(rem);
        }
    }

    Ok(())
}
