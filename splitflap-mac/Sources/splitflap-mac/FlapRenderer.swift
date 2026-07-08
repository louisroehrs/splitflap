// FlapRenderer — the pixel side of the board.
//
// Pre-renders every flap character to a full tile image (dark card + seam +
// bold monospaced glyph centred on the seam) via SwiftUI's ImageRenderer, then
// slices each into a top and bottom half. Cells draw those halves — and, mid-
// flip, a vertically-squashed copy — so each glyph is rasterized only once per
// cell size. Rebuilt only when the window (hence cell) size changes.

import SwiftUI
import AppKit

/// One tile: the two dark card halves, the glyph centred on the seam, a seam
/// line. Rendered offscreen by ImageRenderer, never shown directly.
private struct TileView: View {
    let ch: Character
    let w: CGFloat
    let h: CGFloat

    var body: some View {
        let half = (h / 2).rounded()
        ZStack(alignment: .topLeading) {
            Color.black
            VStack(spacing: 0) {
                Rectangle().fill(Color(white: 31.0 / 255.0)).frame(width: w, height: half)
                Rectangle().fill(Color(white: 22.0 / 255.0)).frame(width: w, height: h - half)
            }
            Text(String(ch))
                .font(.system(size: h * 0.80, weight: .bold, design: .monospaced))
                .foregroundStyle(Color(white: 242.0 / 255.0))
                .frame(width: w, height: h)
                .position(x: w / 2, y: half) // centre the glyph on the seam
            Rectangle()
                .fill(Color.black)
                .frame(width: w, height: max(h / 28, 1))
                .position(x: w / 2, y: half)
        }
        .frame(width: w, height: h)
    }
}

@MainActor
final class FlapRenderer {
    private(set) var cellW = 0
    private(set) var cellH = 0
    private(set) var scale: CGFloat = 2
    private(set) var half = 0

    private(set) var tops: [CGImage] = []
    private(set) var bots: [CGImage] = []

    /// (Re)build the glyph bank if the cell size or backing scale changed.
    func ensure(cellW: Int, cellH: Int, scale: CGFloat) {
        if cellW == self.cellW, cellH == self.cellH, scale == self.scale, !tops.isEmpty {
            return
        }
        self.cellW = cellW
        self.cellH = cellH
        self.scale = scale
        self.half = cellH / 2
        build()
    }

    private func build() {
        tops.removeAll(keepingCapacity: true)
        tops.reserveCapacity(FLAPS.count)
        bots.removeAll(keepingCapacity: true)
        bots.reserveCapacity(FLAPS.count)

        let pw = Int((CGFloat(cellW) * scale).rounded())
        let phalf = Int((CGFloat(half) * scale).rounded())
        let ph = Int((CGFloat(cellH) * scale).rounded())

        for ch in FLAPS {
            let renderer = ImageRenderer(
                content: TileView(ch: ch, w: CGFloat(cellW), h: CGFloat(cellH))
            )
            renderer.scale = scale
            guard let tile = renderer.cgImage,
                  let top = tile.cropping(to: CGRect(x: 0, y: 0, width: pw, height: phalf)),
                  let bot = tile.cropping(to: CGRect(x: 0, y: phalf, width: pw, height: ph - phalf))
            else {
                // Should not happen; keep indices aligned with FLAPS with blanks.
                tops.append(blank(pw, phalf))
                bots.append(blank(pw, ph - phalf))
                continue
            }
            tops.append(top)
            bots.append(bot)
        }
    }

    private func blank(_ w: Int, _ h: Int) -> CGImage {
        let cs = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(
            data: nil, width: max(w, 1), height: max(h, 1), bitsPerComponent: 8,
            bytesPerRow: 0, space: cs,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        return ctx.makeImage()!
    }
}
