// BoardView — draws the whole board each frame with a SwiftUI Canvas.
//
// The board state (BoardModel) is size-independent; here we derive cell pixels
// from the current window size, (re)build the glyph bank at that size, and paint
// every cell. The two-phase fold matches the Zig/Python siblings: the current
// card's top folds down to the seam, then the next card's bottom drops from it.

import SwiftUI
import AppKit

struct BoardView: View {
    let model: BoardModel
    @State private var renderer = FlapRenderer()

    var body: some View {
        Canvas { ctx, size in
            _ = model.tick // establish the redraw dependency
            draw(&ctx, size: size)
        }
        .background(Color.black)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress { press in
            if press.key == .escape { NSApp.terminate(nil); return .handled }
            switch press.characters {
            case "q", "Q": NSApp.terminate(nil); return .handled
            case "f", "F": NSApp.keyWindow?.toggleFullScreen(nil); return .handled
            default: return .ignored
            }
        }
    }

    private func draw(_ ctx: inout GraphicsContext, size: CGSize) {
        let scale = NSScreen.main?.backingScaleFactor ?? 2
        let margin = max(Int(size.width) / 40, 10)
        let cellW = max((Int(size.width) - 2 * margin) / model.cols, 1)
        let cellH = max((Int(size.height) - 2 * margin) / model.rows, 1)
        renderer.ensure(cellW: cellW, cellH: cellH, scale: scale)

        let half = cellH / 2
        let gx = (Int(size.width) - cellW * model.cols) / 2
        let gy = (Int(size.height) - cellH * model.rows) / 2

        for r in 0..<model.rows {
            for col in 0..<model.cols {
                let cell = model.cells[r * model.cols + col]
                let x = gx + col * cellW
                let y = gy + r * cellH
                drawCell(&ctx, cell, x: x, y: y, w: cellW, h: cellH, half: half)
            }
        }

        drawGridLines(&ctx, gx: gx, gy: gy, cellW: cellW, cellH: cellH)
    }

    /// Thin separator hairlines between the rows and columns, like the frames
    /// between the units on a real split-flap board.
    private func drawGridLines(_ ctx: inout GraphicsContext,
                               gx: Int, gy: Int, cellW: Int, cellH: Int) {
        let shading = GraphicsContext.Shading.color(.black)
        let t: CGFloat = 1
        let gridW = cellW * model.cols
        let gridH = cellH * model.rows

        for col in 1..<max(model.cols, 1) {
            let lx = CGFloat(gx + col * cellW) - t / 2
            ctx.fill(Path(CGRect(x: lx, y: CGFloat(gy), width: t, height: CGFloat(gridH))), with: shading)
        }
        for r in 1..<max(model.rows, 1) {
            let ly = CGFloat(gy + r * cellH) - t / 2
            ctx.fill(Path(CGRect(x: CGFloat(gx), y: ly, width: CGFloat(gridW), height: t)), with: shading)
        }
    }

    private func drawCell(_ ctx: inout GraphicsContext, _ cell: Cell,
                          x: Int, y: Int, w: Int, h: Int, half: Int) {
        let seamY = y + half

        // Settled: paint the two static halves.
        if cell.cur == cell.target, cell.frame == 0 {
            image(&ctx, renderer.tops[cell.cur], R(x, y, w, half))
            image(&ctx, renderer.bots[cell.cur], R(x, seamY, w, h - half))
            return
        }

        let next = (cell.cur + 1) % FLAPS.count
        let t = Double(cell.frame) / Double(FRAMES_PER_STEP)

        if t < 0.5 {
            // PHASE 1 — current's top card folds down toward the seam. Behind it
            // next's top is already revealed; the bottom is still current.
            image(&ctx, renderer.tops[next], R(x, y, w, half))
            image(&ctx, renderer.bots[cell.cur], R(x, seamY, w, h - half))
            let sh = max(Int(Double(half) * cos(t / 0.5 * .pi / 2)), 1)
            image(&ctx, renderer.tops[cell.cur], R(x, seamY - sh, w, sh))
            shade(&ctx, R(x, seamY - sh, w, sh), amount: t / 0.5)
        } else {
            // PHASE 2 — next's bottom card drops from the seam downward. Top is
            // settled to next; behind the falling card is next's bottom.
            image(&ctx, renderer.tops[next], R(x, y, w, half))
            image(&ctx, renderer.bots[next], R(x, seamY, w, h - half))
            let sh = max(Int(Double(half) * sin((t - 0.5) / 0.5 * .pi / 2)), 1)
            image(&ctx, renderer.bots[next], R(x, seamY, w, sh))
            shade(&ctx, R(x, seamY, w, sh), amount: 1.0 - (t - 0.5) / 0.5)
        }
    }

    /// Draw a cached glyph image scaled into `rect` (vertical squash = the fold).
    private func image(_ ctx: inout GraphicsContext, _ cg: CGImage, _ rect: CGRect) {
        let ri = ctx.resolve(Image(decorative: cg, scale: renderer.scale))
        ctx.draw(ri, in: rect)
    }

    /// Darken the moving card so the fold reads as catching shadow (0…1).
    private func shade(_ ctx: inout GraphicsContext, _ rect: CGRect, amount: Double) {
        let a = min(max(amount, 0), 1) * (150.0 / 255.0)
        if a > 0 { ctx.fill(Path(rect), with: .color(.black.opacity(a))) }
    }

    private func R(_ x: Int, _ y: Int, _ w: Int, _ h: Int) -> CGRect {
        CGRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(w), height: CGFloat(h))
    }
}
