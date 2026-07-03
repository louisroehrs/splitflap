#!/usr/bin/env python3
"""
splitflap_board.py — Full-screen split-flap (airport-style) text board for
macOS. Fetches a few lines of text from a URL and animates them onto a
mechanical split-flap display with a true two-halves rotating flip: the top
card folds down over the bottom with vertical foreshortening, like a real
Solari board. No browser required.

This is the macOS sibling of the Raspberry Pi build in ../python. It differs
only in the bits that matter on a Mac: Retina (HiDPI) rendering via the SCALED
display flag, a macOS-friendly monospace font lookup, and Cmd-Q / Cmd-W quit
handling in addition to Esc/q.

Tested target: Python 3.13 on macOS (Apple Silicon & Intel).

Setup:
    python3 -m venv .venvsplitflapmac
    .venvsplitflapmac/bin/python -m pip install pygame

Run:
    .venvsplitflapmac/bin/python splitflap_board.py https://example.com/board.txt

    # options
    .venvsplitflapmac/bin/python splitflap_board.py URL \
        --cols 32 --rows 6 --interval 60 --windowed

The URL should return plain text. Each line becomes one row on the board.
Press Esc, q, Cmd-Q, or Cmd-W to quit.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from urllib.request import urlopen, Request
from urllib.error import URLError
from datetime import datetime
import pygame

# The alphabet the flaps cycle through. Order matters: the flip animation rolls
# forward through this sequence, just like the physical drum does.
FLAPS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:\"`'!?-/|\\_^@$&()#%+*=°~"
FLAP_INDEX = {ch: i for i, ch in enumerate(FLAPS)}

# Colours tuned to look like a Solari board.
BG = (0, 0, 0)
TILE_TOP = (31, 31, 31)     # upper-half card, a touch lighter
TILE_BOT = (22, 22, 22)     # lower-half card
TEXT = (242, 242, 242)
SEAM = (0, 0, 0)

# Animation tuning. Frames spent on a single character step (one flap). Lower =
# faster clatter. At 60 FPS, 6 frames ≈ 100 ms per character.
FRAMES_PER_STEP = 6
FPS = 60

# macOS monospace fonts, in order of preference. SysFont falls back to the
# default face if none resolve, so the board still runs on a bare install.
MAC_MONO_FONTS = "sfmono,menlo,monaco,couriernew,dejavusansmono"


def fetch_lines(url: str, timeout: float = 10.0) -> list[str]:
    """Return the lines of text fetched from *url*. Falls back to an error
    message line (rather than crashing) so the board keeps running."""
    try:
        req = Request(url + "?" + str(datetime.now().time()), headers={"User-Agent": "splitflap-board/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except (URLError, OSError, ValueError) as exc:
        return ["FETCH ERROR", str(exc)[:80]]
    # Keep blank lines so the board mirrors the file's layout.
    return [ln.rstrip("\n\r") for ln in raw.splitlines()]


def normalize(ch: str) -> str:
    """Map an arbitrary character onto something the flaps can show."""
    up = ch.upper()
    return up if up in FLAP_INDEX else " "


class GlyphCache:
    """Pre-renders every flap character to a full tile surface at a given cell
    size, then slices each into top and bottom halves. Shared by all cells of
    the same size so glyphs are only rasterized once."""

    def __init__(self, w: int, h: int):
        self.w = w
        self.h = h
        self.half = h // 2
        pad = max(1, w // 16)
        seam_w = max(1, h // 28)
        fsize = max(8, int(h * 0.80))
        font = pygame.font.SysFont(MAC_MONO_FONTS, fsize, bold=True)

        self.tops: dict[str, pygame.Surface] = {}
        self.bottoms: dict[str, pygame.Surface] = {}
        for ch in FLAPS:
            tile = pygame.Surface((w, h)).convert()
            tile.fill(BG)
            pygame.draw.rect(tile, TILE_TOP, (pad, pad, w - 2 * pad, self.half - pad))
            pygame.draw.rect(tile, TILE_BOT, (pad, self.half, w - 2 * pad, self.half - pad))
            glyph = font.render(ch, True, TEXT)
            tile.blit(glyph, glyph.get_rect(center=(w // 2, self.half)))
            pygame.draw.line(tile, SEAM, (pad, self.half), (w - pad, self.half), seam_w)

            # Slice into the two cards. .copy() so each half owns its pixels.
            top = tile.subsurface((0, 0, w, self.half)).copy()
            bot = tile.subsurface((0, self.half, w, h - self.half)).copy()
            self.tops[ch] = top
            self.bottoms[ch] = bot

    def char_at(self, idx: int) -> str:
        return FLAPS[idx % len(FLAPS)]


class Flap:
    """A single character cell. Animates from its current glyph toward a target
    by rolling forward through FLAPS, one mechanical flip per intermediate."""

    __slots__ = ("cache", "x", "y", "cur", "target", "frame")

    def __init__(self, cache: GlyphCache, x: int, y: int, start: str = " "):
        self.cache = cache
        self.x = x
        self.y = y
        self.cur = FLAP_INDEX[normalize(start)]
        self.target = self.cur
        self.frame = 0          # frame within the current single-step flip

    @property
    def is_animating(self) -> bool:
        return self.cur != self.target or self.frame != 0

    def set_target(self, ch: str) -> None:
        self.target = FLAP_INDEX[normalize(ch)]

    def advance(self) -> None:
        """Move the animation forward one frame. Call only while animating."""
        if self.cur == self.target:
            self.frame = 0
            return
        self.frame += 1
        if self.frame >= FRAMES_PER_STEP:
            # Land this card; the next frame starts folding toward the next one.
            self.cur = (self.cur + 1) % len(FLAPS)
            self.frame = 0

    def rect(self) -> pygame.Rect:
        return pygame.Rect(self.x, self.y, self.cache.w, self.cache.h)

    def draw(self, screen: pygame.Surface) -> None:
        c = self.cache
        cur_ch = c.char_at(self.cur)

        # Settled: just paint the two static halves.
        if self.cur == self.target and self.frame == 0:
            screen.blit(c.tops[cur_ch], (self.x, self.y))
            screen.blit(c.bottoms[cur_ch], (self.x, self.y + c.half))
            return

        next_ch = c.char_at(self.cur + 1)
        # Two phases over FRAMES_PER_STEP frames: fold the top card down (0→90°)
        # then drop the next card onto the bottom (90→180°).
        t = self.frame / FRAMES_PER_STEP        # 0..1 across the whole flip
        seam_y = self.y + c.half

        if t < 0.5:
            # PHASE 1 — top card (top of current) folds down toward the seam.
            # Behind it the next char's top is already revealed; bottom is current.
            screen.blit(c.tops[next_ch], (self.x, self.y))
            screen.blit(c.bottoms[cur_ch], (self.x, seam_y))
            angle = (t / 0.5) * (math.pi / 2)          # 0 → 90°
            scaled_h = max(1, int(c.half * math.cos(angle)))
            card = pygame.transform.scale(c.tops[cur_ch], (c.w, scaled_h))
            self._shade(card, t / 0.5)
            # Bottom edge stays pinned to the seam; top edge drops toward it.
            screen.blit(card, (self.x, seam_y - scaled_h))
        else:
            # PHASE 2 — next char's bottom card falls from the seam downward.
            # Top is settled to next; behind the falling card is next's bottom.
            screen.blit(c.tops[next_ch], (self.x, self.y))
            screen.blit(c.bottoms[next_ch], (self.x, seam_y))
            angle = ((t - 0.5) / 0.5) * (math.pi / 2)  # 0 → 90° (i.e. 90→180 fold)
            scaled_h = max(1, int(c.half * math.sin(angle)))
            card = pygame.transform.scale(c.bottoms[next_ch], (c.w, scaled_h))
            self._shade(card, 1.0 - (t - 0.5) / 0.5)
            # Top edge pinned to the seam; card grows downward as it lands.
            screen.blit(card, (self.x, seam_y))

    @staticmethod
    def _shade(card: pygame.Surface, amount: float) -> None:
        """Darken the moving card so the fold reads as catching shadow."""
        alpha = int(150 * max(0.0, min(1.0, amount)))
        if alpha <= 0:
            return
        shade = pygame.Surface(card.get_size()).convert_alpha()
        shade.fill((0, 0, 0, alpha))
        card.blit(shade, (0, 0))


class Board:
    def __init__(self, screen: pygame.Surface, cols: int, rows: int):
        self.screen = screen
        self.cols = cols
        self.rows = rows
        sw, sh = screen.get_size()
        margin = max(10, sw // 40)
        cell_w = (sw - 2 * margin) // cols
        cell_h = (sh - 2 * margin) // rows
        self.cache = GlyphCache(cell_w, cell_h)

        gx = (sw - cell_w * cols) // 2
        gy = (sh - cell_h * rows) // 2
        self.flaps: list[list[Flap]] = [
            [Flap(self.cache, gx + c * cell_w, gy + r * cell_h)
             for c in range(cols)]
            for r in range(rows)
        ]

        screen.fill(BG)
        for row in self.flaps:
            for flap in row:
                flap.draw(screen)
        pygame.display.flip()

    def set_text(self, lines: list[str]) -> None:
        for r in range(self.rows):
            line = lines[r] if r < len(lines) else ""
            line = line[: self.cols].ljust(self.cols)
            for c in range(self.cols):
                self.flaps[r][c].set_target(line[c])

    def step(self) -> list[pygame.Rect]:
        """Advance and redraw only animating cells. Returns dirty rects."""
        dirty: list[pygame.Rect] = []
        for row in self.flaps:
            for flap in row:
                if flap.is_animating:
                    flap.advance()
                    flap.draw(self.screen)
                    dirty.append(flap.rect())
        return dirty


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Full-screen split-flap text board (macOS).")
    p.add_argument("url", help="URL returning plain text (one line per row).")
    p.add_argument("--cols", type=int, default=32, help="Characters per row.")
    p.add_argument("--rows", type=int, default=6, help="Number of rows.")
    p.add_argument("--interval", type=int, default=60,
                   help="Seconds between refetches.")
    p.add_argument("--windowed", action="store_true",
                   help="Run in a window instead of full screen (for testing).")
    args = p.parse_args(argv)

    pygame.init()
    if args.windowed:
        # SCALED lets pygame render at the backing (Retina) resolution while we
        # reason in logical pixels, so text stays crisp on HiDPI Macs.
        screen = pygame.display.set_mode((960, 540), pygame.SCALED)
    else:
        # SCALED can't take a (0,0) "current desktop" size, so query the real
        # display resolution and pass it explicitly. This keeps HiDPI crispness
        # while filling the screen.
        sizes = pygame.display.get_desktop_sizes()
        desktop = sizes[0] if sizes else (1920, 1080)
        screen = pygame.display.set_mode(
            desktop, pygame.FULLSCREEN | pygame.SCALED)
        pygame.mouse.set_visible(False)
    pygame.display.set_caption("Split-Flap Board")

    board = Board(screen, args.cols, args.rows)
    clock = pygame.time.Clock()

    # First fetch immediately, then on the interval.
    board.set_text(fetch_lines(args.url))
    last_fetch = time.monotonic()

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                cmd = event.mod & pygame.KMOD_META  # Cmd key on macOS
                if event.key in (pygame.K_ESCAPE, pygame.K_q):
                    running = False
                elif cmd and event.key in (pygame.K_q, pygame.K_w):
                    running = False

        now = time.monotonic()
        if now - last_fetch >= args.interval:
            board.set_text(fetch_lines(args.url))
            last_fetch = now

        dirty = board.step()
        if dirty:
            pygame.display.update(dirty)
        clock.tick(FPS)

    pygame.quit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
