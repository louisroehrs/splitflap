// splitflap_board — Full-screen split-flap (airport-style) text board.
//
// A Zig port of src/main.rs (itself a port of splitflap_board.py). Fetches a
// few lines of text from a URL and animates them onto a mechanical split-flap
// display with a true two-halves rotating flip: the top card folds down over
// the bottom with vertical foreshortening, like a real Solari board.
//
//     zig build -Doptimize=ReleaseFast
//     ./zig-out/bin/splitflap_board https://example.com/board.txt
//     ./zig-out/bin/splitflap_board URL --cols 32 --rows 6 --interval 60 --windowed
//
// Press Esc or q to quit.

const std = @import("std");

const c = @cImport({
    // Stop SDL from pulling <arm_neon.h> into Zig's C-header translator. We link
    // the prebuilt SDL library, so we never need the NEON intrinsics, and
    // translate-c can't parse that header (it fails on ARM/Raspberry Pi builds).
    @cDefine("SDL_DISABLE_ARM_NEON_H", "1");
    @cInclude("SDL2/SDL.h");
    @cInclude("SDL2/SDL_ttf.h");
});

// The alphabet the flaps cycle through. Order matters: the flip animation rolls
// forward through this sequence, just like the physical drum does.
const FLAPS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:\"`'!?-/|\\_^@$&()#%+*=°";

// Colours tuned to look like a Solari board (r, g, b).
const BG = [3]u8{ 0, 0, 0 };
const TILE_TOP = [3]u8{ 31, 31, 31 }; // upper-half card, a touch lighter
const TILE_BOT = [3]u8{ 22, 22, 22 }; // lower-half card
const TEXT = [3]u8{ 242, 242, 242 };
const SEAM = [3]u8{ 0, 0, 0 };

// Animation tuning. Frames spent on a single character step (one flap). Lower =
// faster clatter. At 60 FPS, 6 frames ≈ 100 ms per character.
const FRAMES_PER_STEP: u32 = 18;
const FPS: u32 = 60;

// Candidate paths for a bold monospace font (Linux/Pi first, then macOS).
const FONT_CANDIDATES = [_][:0]const u8{
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/System/Library/Fonts/SFNSMono.ttf",
};

const Args = struct {
    url: []const u8,
    cols: usize = 32,
    rows: usize = 6,
    interval: u64 = 60,
    windowed: bool = false,
};

fn fail(comptime fmt: []const u8, args: anytype) noreturn {
    std.debug.print(fmt ++ "\n", args);
    std.process.exit(1);
}

fn parseArgs(alloc: std.mem.Allocator, raw: std.process.Args) !Args {
    var it = try std.process.Args.Iterator.initAllocator(raw, alloc);
    defer it.deinit();
    _ = it.next(); // program name

    var url: ?[]const u8 = null;
    var args = Args{ .url = "" };
    while (it.next()) |a| {
        if (std.mem.eql(u8, a, "--cols")) {
            args.cols = try std.fmt.parseInt(usize, it.next() orelse fail("--cols needs a value", .{}), 10);
        } else if (std.mem.eql(u8, a, "--rows")) {
            args.rows = try std.fmt.parseInt(usize, it.next() orelse fail("--rows needs a value", .{}), 10);
        } else if (std.mem.eql(u8, a, "--interval")) {
            args.interval = try std.fmt.parseInt(u64, it.next() orelse fail("--interval needs a value", .{}), 10);
        } else if (std.mem.eql(u8, a, "--windowed")) {
            args.windowed = true;
        } else if (std.mem.startsWith(u8, a, "--")) {
            fail("unknown option: {s}", .{a});
        } else {
            url = try alloc.dupe(u8, a);
        }
    }
    args.url = url orelse fail("usage: splitflap_board URL [--cols N] [--rows N] [--interval S] [--windowed]", .{});
    return args;
}

/// The ordered flap alphabet as a list of Unicode codepoints. `cur`/`target`
/// are indices into this list, so the glyph cache is just an array.
const Alphabet = struct {
    chars: []u21,
    alloc: std.mem.Allocator,

    fn init(alloc: std.mem.Allocator) !Alphabet {
        var list = std.ArrayList(u21).empty;
        var view = try std.unicode.Utf8View.init(FLAPS);
        var it = view.iterator();
        while (it.nextCodepoint()) |cp| try list.append(alloc, cp);
        return .{ .chars = try list.toOwnedSlice(alloc), .alloc = alloc };
    }

    fn deinit(self: *Alphabet) void {
        self.alloc.free(self.chars);
    }

    fn len(self: Alphabet) usize {
        return self.chars.len;
    }

    fn charAt(self: Alphabet, idx: usize) u21 {
        return self.chars[idx % self.chars.len];
    }

    /// Map an arbitrary codepoint onto something the flaps can show.
    fn normalizeIndex(self: Alphabet, cp: u21) usize {
        const up: u21 = if (cp < 128) std.ascii.toUpper(@intCast(cp)) else cp;
        for (self.chars, 0..) |fc, i| {
            if (fc == up) return i;
        }
        return 0; // 0 == space
    }
};

/// Decode a UTF-8 line into a freshly allocated list of codepoints. Invalid
/// bytes are replaced with U+FFFD so a bad fetch never crashes the board.
fn decodeLine(alloc: std.mem.Allocator, bytes: []const u8) ![]u21 {
    var list = std.ArrayList(u21).empty;
    var i: usize = 0;
    while (i < bytes.len) {
        const n = std.unicode.utf8ByteSequenceLength(bytes[i]) catch {
            try list.append(alloc, 0xFFFD);
            i += 1;
            continue;
        };
        if (i + n > bytes.len) {
            try list.append(alloc, 0xFFFD);
            break;
        }
        const cp = std.unicode.utf8Decode(bytes[i .. i + n]) catch 0xFFFD;
        try list.append(alloc, cp);
        i += n;
    }
    return list.toOwnedSlice(alloc);
}

/// Fetched board text: a list of lines, each a list of codepoints. Blank lines
/// are kept so the board mirrors the file's layout.
const Lines = struct {
    rows: [][]u21,
    arena: std.heap.ArenaAllocator,

    fn deinit(self: *Lines) void {
        self.arena.deinit();
    }
};

/// Fetch the board text from `url`, appending a cache-busting timestamp. On any
/// error it returns a two-line error board rather than crashing.
fn fetchLines(gpa: std.mem.Allocator, io: std.Io, url: []const u8) Lines {
    var arena = std.heap.ArenaAllocator.init(gpa);
    const a = arena.allocator();

    const sep: u8 = if (std.mem.indexOfScalar(u8, url, '?') != null) '&' else '?';
    const now = c.SDL_GetPerformanceCounter();
    const full = std.fmt.allocPrint(a, "{s}{c}t={d}", .{ url, sep, now }) catch
        return errorBoard(arena, "ALLOC ERROR", "");

    const body = httpGet(a, io, full) catch |err| {
        return errorBoard(arena, "FETCH ERROR", @errorName(err));
    };

    var rows = std.ArrayList([]u21).empty;
    var it = std.mem.splitScalar(u8, body, '\n');
    while (it.next()) |raw| {
        // Trim a trailing CR so CRLF files line up like the Rust .lines() port.
        const line = if (raw.len > 0 and raw[raw.len - 1] == '\r') raw[0 .. raw.len - 1] else raw;
        rows.append(a, decodeLine(a, line) catch &[_]u21{}) catch break;
    }
    // splitScalar yields a trailing empty segment after a final newline; drop it
    // so we match Rust's str::lines() (which does not).
    if (rows.items.len > 0 and body.len > 0 and body[body.len - 1] == '\n') {
        _ = rows.pop();
    }
    return .{ .rows = rows.toOwnedSlice(a) catch &[_][]u21{}, .arena = arena };
}

fn errorBoard(arena: std.heap.ArenaAllocator, line0: []const u8, line1: []const u8) Lines {
    var ar = arena;
    const a = ar.allocator();
    var rows = std.ArrayList([]u21).empty;
    rows.append(a, decodeLine(a, line0) catch &[_]u21{}) catch {};
    if (line1.len > 0) {
        const trimmed = if (line1.len > 80) line1[0..80] else line1;
        rows.append(a, decodeLine(a, trimmed) catch &[_]u21{}) catch {};
    }
    return .{ .rows = rows.toOwnedSlice(a) catch &[_][]u21{}, .arena = ar };
}

fn httpGet(a: std.mem.Allocator, io: std.Io, url: []const u8) ![]u8 {
    var client = std.http.Client{ .allocator = a, .io = io };
    defer client.deinit();

    var aw = std.Io.Writer.Allocating.init(a);
    defer aw.deinit();

    const res = try client.fetch(.{
        .location = .{ .url = url },
        .method = .GET,
        .response_writer = &aw.writer,
        .extra_headers = &.{.{ .name = "User-Agent", .value = "splitflap-board/1.0" }},
    });
    if (@intFromEnum(res.status) >= 400) return error.HttpStatus;
    return aw.toOwnedSlice();
}

/// Pre-renders every flap character into one full tile texture (dark tile +
/// seam + bold glyph). Top and bottom halves are drawn from the same texture
/// via source rects at render time, so each glyph is rasterized only once.
const GlyphCache = struct {
    w: u32,
    h: u32,
    half: u32,
    tiles: []*c.SDL_Texture,
    alloc: std.mem.Allocator,

    fn init(
        alloc: std.mem.Allocator,
        renderer: *c.SDL_Renderer,
        font: *c.TTF_Font,
        alpha: Alphabet,
        w: u32,
        h: u32,
    ) !GlyphCache {
        const half = h / 2;
        const pad: c_int = @intCast(@max(w / 16, 1));
        const seam_w: u32 = @max(h / 28, 1);
        const iw: c_int = @intCast(w);
        const ih: c_int = @intCast(h);

        const tiles = try alloc.alloc(*c.SDL_Texture, alpha.len());
        const text_col = c.SDL_Color{ .r = TEXT[0], .g = TEXT[1], .b = TEXT[2], .a = 255 };

        for (alpha.chars, 0..) |cp, i| {
            const surf = c.SDL_CreateRGBSurfaceWithFormat(0, iw, ih, 32, c.SDL_PIXELFORMAT_RGBA8888) orelse
                return error.SurfaceCreate;
            defer c.SDL_FreeSurface(surf);

            fillRect(surf, null, BG);
            fillRect(surf, &rect(pad, pad, iw - 2 * pad, @as(c_int, @intCast(half)) - pad), TILE_TOP);
            fillRect(surf, &rect(pad, @intCast(half), iw - 2 * pad, @as(c_int, @intCast(half)) - pad), TILE_BOT);

            // Render the glyph (UTF-8) and blit it centred on the seam.
            var buf: [8]u8 = undefined;
            const n = std.unicode.utf8Encode(cp, &buf) catch 1;
            buf[n] = 0;
            const glyph = c.TTF_RenderUTF8_Blended(font, &buf, text_col) orelse return error.GlyphRender;
            defer c.SDL_FreeSurface(glyph);
            const gw = glyph.*.w;
            const gh = glyph.*.h;
            var dst = rect(@divTrunc(iw - gw, 2), @as(c_int, @intCast(half)) - @divTrunc(gh, 2), gw, gh);
            _ = c.SDL_BlitSurface(glyph, null, surf, &dst);

            // The split-flap seam line.
            fillRect(surf, &rect(pad, @intCast(half), iw - 2 * pad, @intCast(seam_w)), SEAM);

            tiles[i] = c.SDL_CreateTextureFromSurface(renderer, surf) orelse return error.TextureCreate;
        }

        return .{ .w = w, .h = h, .half = half, .tiles = tiles, .alloc = alloc };
    }

    fn deinit(self: *GlyphCache) void {
        for (self.tiles) |t| c.SDL_DestroyTexture(t);
        self.alloc.free(self.tiles);
    }

    fn topSrc(self: GlyphCache) c.SDL_Rect {
        return rect(0, 0, @intCast(self.w), @intCast(self.half));
    }

    fn botSrc(self: GlyphCache) c.SDL_Rect {
        return rect(0, @intCast(self.half), @intCast(self.w), @intCast(self.h - self.half));
    }
};

fn rect(x: c_int, y: c_int, w: c_int, h: c_int) c.SDL_Rect {
    return .{ .x = x, .y = y, .w = w, .h = h };
}

fn fillRect(surf: *c.SDL_Surface, r: ?*const c.SDL_Rect, col: [3]u8) void {
    const mapped = c.SDL_MapRGB(surf.*.format, col[0], col[1], col[2]);
    _ = c.SDL_FillRect(surf, r, mapped);
}

/// Darken a card texture so the fold reads as catching shadow (amount 0..1).
/// Python used alpha up to 150/255 of black; mirror with a colour-mod.
fn shade(tex: *c.SDL_Texture, amount: f32) void {
    const a = std.math.clamp(amount, 0.0, 1.0);
    const v: u8 = @intFromFloat(255.0 - 150.0 * a);
    _ = c.SDL_SetTextureColorMod(tex, v, v, v);
}

fn resetMod(tex: *c.SDL_Texture) void {
    _ = c.SDL_SetTextureColorMod(tex, 255, 255, 255);
}

/// A single character cell. Animates from its current glyph toward a target by
/// rolling forward through the alphabet, one mechanical flip per intermediate.
const Flap = struct {
    x: c_int,
    y: c_int,
    cur: usize = 0,
    target: usize = 0,
    frame: u32 = 0,

    fn isAnimating(self: Flap) bool {
        return self.cur != self.target or self.frame != 0;
    }

    fn advance(self: *Flap, n_flaps: usize) void {
        if (self.cur == self.target) {
            self.frame = 0;
            return;
        }
        self.frame += 1;
        if (self.frame >= FRAMES_PER_STEP) {
            self.cur = (self.cur + 1) % n_flaps;
            self.frame = 0;
        }
    }

    fn draw(self: Flap, renderer: *c.SDL_Renderer, cache: *GlyphCache, alpha: Alphabet) void {
        const half: c_int = @intCast(cache.half);
        const w: c_int = @intCast(cache.w);
        const full_h: c_int = @intCast(cache.h);
        const seam_y = self.y + half;
        const top_src = cache.topSrc();
        const bot_src = cache.botSrc();

        // Settled: just paint the two static halves.
        if (self.cur == self.target and self.frame == 0) {
            const tex = cache.tiles[self.cur % alpha.len()];
            var st = top_src;
            var dt = rect(self.x, self.y, w, half);
            _ = c.SDL_RenderCopy(renderer, tex, &st, &dt);
            var sb = bot_src;
            var db = rect(self.x, seam_y, w, full_h - half);
            _ = c.SDL_RenderCopy(renderer, tex, &sb, &db);
            return;
        }

        const cur_tex = cache.tiles[self.cur % alpha.len()];
        const next_tex = cache.tiles[(self.cur + 1) % alpha.len()];
        const t = @as(f32, @floatFromInt(self.frame)) / @as(f32, @floatFromInt(FRAMES_PER_STEP));

        if (t < 0.5) {
            // PHASE 1 — top card (top of current) folds down toward the seam.
            // Behind it next's top is already revealed; bottom is current.
            copyRect(renderer, next_tex, top_src, rect(self.x, self.y, w, half));
            copyRect(renderer, cur_tex, bot_src, rect(self.x, seam_y, w, full_h - half));
            const angle = (t / 0.5) * (std.math.pi / 2.0);
            const scaled_h: c_int = @max(@as(c_int, @intFromFloat(@as(f32, @floatFromInt(half)) * @cos(angle))), 1);
            shade(cur_tex, t / 0.5);
            copyRect(renderer, cur_tex, top_src, rect(self.x, seam_y - scaled_h, w, scaled_h));
            resetMod(cur_tex);
        } else {
            // PHASE 2 — next's bottom card falls from the seam downward.
            copyRect(renderer, next_tex, top_src, rect(self.x, self.y, w, half));
            copyRect(renderer, next_tex, bot_src, rect(self.x, seam_y, w, full_h - half));
            const angle = ((t - 0.5) / 0.5) * (std.math.pi / 2.0);
            const scaled_h: c_int = @max(@as(c_int, @intFromFloat(@as(f32, @floatFromInt(half)) * @sin(angle))), 1);
            shade(next_tex, 1.0 - (t - 0.5) / 0.5);
            copyRect(renderer, next_tex, bot_src, rect(self.x, seam_y, w, scaled_h));
            resetMod(next_tex);
        }
    }
};

fn copyRect(renderer: *c.SDL_Renderer, tex: *c.SDL_Texture, src: c.SDL_Rect, dst: c.SDL_Rect) void {
    var s = src;
    var d = dst;
    _ = c.SDL_RenderCopy(renderer, tex, &s, &d);
}

const Board = struct {
    cols: usize,
    rows: usize,
    flaps: []Flap, // row-major, rows*cols
    alloc: std.mem.Allocator,

    fn init(alloc: std.mem.Allocator, cache: GlyphCache, screen_w: u32, screen_h: u32, cols: usize, rows: usize) !Board {
        const cell_w: c_int = @intCast(cache.w);
        const cell_h: c_int = @intCast(cache.h);
        const gx = @divTrunc(@as(c_int, @intCast(screen_w)) - cell_w * @as(c_int, @intCast(cols)), 2);
        const gy = @divTrunc(@as(c_int, @intCast(screen_h)) - cell_h * @as(c_int, @intCast(rows)), 2);
        const flaps = try alloc.alloc(Flap, rows * cols);
        for (0..rows) |r| {
            for (0..cols) |col| {
                flaps[r * cols + col] = .{
                    .x = gx + @as(c_int, @intCast(col)) * cell_w,
                    .y = gy + @as(c_int, @intCast(r)) * cell_h,
                };
            }
        }
        return .{ .cols = cols, .rows = rows, .flaps = flaps, .alloc = alloc };
    }

    fn deinit(self: *Board) void {
        self.alloc.free(self.flaps);
    }

    fn at(self: Board, r: usize, col: usize) *Flap {
        return &self.flaps[r * self.cols + col];
    }

    /// Pad/truncate each line to `cols` and rows to `rows`, then aim each cell.
    fn setText(self: *Board, lines: Lines, alpha: Alphabet) void {
        for (0..self.rows) |r| {
            const line: []const u21 = if (r < lines.rows.len) lines.rows[r] else &[_]u21{};
            for (0..self.cols) |col| {
                const cp: u21 = if (col < line.len) line[col] else ' ';
                self.at(r, col).target = alpha.normalizeIndex(cp);
            }
        }
    }

    fn anyAnimating(self: Board) bool {
        for (self.flaps) |f| {
            if (f.isAnimating()) return true;
        }
        return false;
    }
};

/// Cell-size derivation shared by GlyphCache and Board layout.
fn cellSize(screen_w: u32, screen_h: u32, cols: usize, rows: usize) [2]u32 {
    const margin: c_int = @max(@as(c_int, @intCast(screen_w / 40)), 10);
    const cw = @divTrunc(@as(c_int, @intCast(screen_w)) - 2 * margin, @as(c_int, @intCast(cols)));
    const ch = @divTrunc(@as(c_int, @intCast(screen_h)) - 2 * margin, @as(c_int, @intCast(rows)));
    return .{ @intCast(@max(cw, 1)), @intCast(@max(ch, 1)) };
}

/// Open the first available bold monospace font at the given pixel size. Tries
/// each candidate via SDL_ttf directly so we don't need filesystem probing.
fn openFont(fsize: c_int) *c.TTF_Font {
    for (FONT_CANDIDATES) |p| {
        if (c.TTF_OpenFont(p, fsize)) |font| return font;
    }
    fail("No monospace font found. Install one (e.g. sudo apt install fonts-dejavu-core).", .{});
}

pub fn main(init: std.process.Init) !void {
    var gpa_state = std.heap.DebugAllocator(.{}){};
    defer _ = gpa_state.deinit();
    const gpa = gpa_state.allocator();
    const io = init.io;

    const args = try parseArgs(gpa, init.minimal.args);
    defer gpa.free(args.url);

    var alpha = try Alphabet.init(gpa);
    defer alpha.deinit();

    if (c.SDL_Init(c.SDL_INIT_VIDEO) != 0) fail("SDL_Init: {s}", .{c.SDL_GetError()});
    defer c.SDL_Quit();
    if (c.TTF_Init() != 0) fail("TTF_Init: {s}", .{c.TTF_GetError()});
    defer c.TTF_Quit();

    const flags: u32 = if (args.windowed) 0 else c.SDL_WINDOW_FULLSCREEN_DESKTOP;
    const win_w: c_int = if (args.windowed) 960 else 0;
    const win_h: c_int = if (args.windowed) 540 else 0;
    const window = c.SDL_CreateWindow(
        "Split-Flap Board",
        c.SDL_WINDOWPOS_CENTERED,
        c.SDL_WINDOWPOS_CENTERED,
        win_w,
        win_h,
        flags,
    ) orelse fail("SDL_CreateWindow: {s}", .{c.SDL_GetError()});
    defer c.SDL_DestroyWindow(window);

    if (!args.windowed) _ = c.SDL_ShowCursor(c.SDL_DISABLE);

    const renderer = c.SDL_CreateRenderer(window, -1, c.SDL_RENDERER_ACCELERATED) orelse
        fail("SDL_CreateRenderer: {s}", .{c.SDL_GetError()});
    defer c.SDL_DestroyRenderer(renderer);

    var sw: c_int = 0;
    var sh: c_int = 0;
    _ = c.SDL_GetRendererOutputSize(renderer, &sw, &sh);
    const screen_w: u32 = @intCast(sw);
    const screen_h: u32 = @intCast(sh);

    const cell = cellSize(screen_w, screen_h, args.cols, args.rows);
    const fsize: c_int = @max(@as(c_int, @intFromFloat(@as(f32, @floatFromInt(cell[1])) * 0.90)), 8);
    const font = openFont(fsize);
    defer c.TTF_CloseFont(font);
    c.TTF_SetFontStyle(font, c.TTF_STYLE_BOLD);

    var cache = try GlyphCache.init(gpa, renderer, font, alpha, cell[0], cell[1]);
    defer cache.deinit();

    var board = try Board.init(gpa, cache, screen_w, screen_h, args.cols, args.rows);
    defer board.deinit();

    // Initial paint of the settled (all-blank) board.
    _ = c.SDL_SetRenderDrawColor(renderer, BG[0], BG[1], BG[2], 255);
    _ = c.SDL_RenderClear(renderer);
    for (board.flaps) |f| f.draw(renderer, &cache, alpha);
    c.SDL_RenderPresent(renderer);

    // First fetch immediately, then on the interval.
    {
        var lines = fetchLines(gpa, io, args.url);
        defer lines.deinit();
        board.setText(lines, alpha);
    }
    var last_fetch = c.SDL_GetTicks64();
    const interval_ms: u64 = args.interval * 1000;
    const frame_budget_ms: u32 = 1000 / FPS;

    var event: c.SDL_Event = undefined;
    running: while (true) {
        const frame_start = c.SDL_GetTicks();

        while (c.SDL_PollEvent(&event) != 0) {
            switch (event.type) {
                c.SDL_QUIT => break :running,
                c.SDL_KEYDOWN => {
                    const k = event.key.keysym.sym;
                    if (k == c.SDLK_ESCAPE or k == c.SDLK_q) break :running;
                },
                else => {},
            }
        }

        if (c.SDL_GetTicks64() - last_fetch >= interval_ms) {
            var lines = fetchLines(gpa, io, args.url);
            defer lines.deinit();
            board.setText(lines, alpha);
            last_fetch = c.SDL_GetTicks64();
        }

        // Advance and, if anything moved, redraw the whole board. An idle board
        // does no drawing.
        if (board.anyAnimating()) {
            for (board.flaps) |*f| f.advance(alpha.len());
            _ = c.SDL_SetRenderDrawColor(renderer, BG[0], BG[1], BG[2], 255);
            _ = c.SDL_RenderClear(renderer);
            for (board.flaps) |f| f.draw(renderer, &cache, alpha);
            c.SDL_RenderPresent(renderer);
        }

        const elapsed = c.SDL_GetTicks() - frame_start;
        if (elapsed < frame_budget_ms) c.SDL_Delay(frame_budget_ms - elapsed);
    }
}
