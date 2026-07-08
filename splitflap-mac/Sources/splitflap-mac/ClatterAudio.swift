// ClatterAudio — synthesized Solari clatter for the macOS build.
//
// Mirrors the Zig build's approach with AVFoundation: at startup we synthesize a
// few short "clack" samples (a noise transient plus a little tonal body under a
// fast exponential decay), then mix overlapping copies in an AVAudioSourceNode
// render callback so a whole-board update sounds like a wash of clatter. A flap
// card landing triggers one click. No audio files.

import Foundation
import AVFoundation
import os

private let AUDIO_RATE: Double = 44100
private let N_VARIANTS = 6
private let MAX_VOICES = 24
private let CLICK_PEAK = 0.22 // per-click peak as a fraction of full scale

/// One playing click: a cursor into a variant buffer, a start delay (so clicks
/// fired on the same frame de-phase a little), and a gain.
private struct Voice {
    var buf = -1
    var pos = 0
    var delay = 0
    var gain: Float = 0
    var active = false
}

final class ClatterAudio: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private var variants: [[Float]] = []
    private var voices = [Voice](repeating: Voice(), count: MAX_VOICES)
    private let lock = OSAllocatedUnfairLock()
    private var rng = SystemRandomNumberGenerator()
    private let master: Float
    private let wantAudio: Bool
    private var enabled = false

    init(volume: Float, enabled: Bool) {
        self.master = min(max(volume, 0), 1)
        self.wantAudio = enabled
    }

    /// Build the click bank and start the engine. Failure is non-fatal — the
    /// board just runs silent.
    func start() {
        guard wantAudio else { return }
        buildVariants()

        guard let fmt = AVAudioFormat(standardFormatWithSampleRate: AUDIO_RATE, channels: 1) else { return }
        let node = AVAudioSourceNode(format: fmt) { [weak self] _, _, frameCount, ablPtr in
            guard let self else { return noErr }
            let abl = UnsafeMutableAudioBufferListPointer(ablPtr)
            guard let raw = abl[0].mData else { return noErr }
            let out = raw.assumingMemoryBound(to: Float.self)
            self.render(out, Int(frameCount))
            return noErr
        }
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: fmt)
        source = node
        do {
            try engine.start()
            enabled = true
        } catch {
            print("audio disabled (\(error))")
        }
    }

    /// Trigger up to `count` overlapping clicks — one per card that just landed.
    /// Capped so a full-board refresh is a rich wash, not a clipped blast.
    func clack(_ count: Int) {
        guard enabled else { return }
        let want = min(count, 10)
        lock.lock()
        defer { lock.unlock() }
        var placed = 0
        for i in voices.indices {
            if placed >= want { break }
            if voices[i].active { continue }
            voices[i].buf = Int.random(in: 0..<variants.count, using: &rng)
            voices[i].pos = 0
            voices[i].gain = Float.random(in: 0.5...1.0, using: &rng)
            voices[i].delay = Int.random(in: 0..<Int(AUDIO_RATE / 120), using: &rng) // 0..~8 ms
            voices[i].active = true
            placed += 1
        }
    }

    // Audio thread: sum active voices into the output buffer.
    private func render(_ out: UnsafeMutablePointer<Float>, _ n: Int) {
        for i in 0..<n { out[i] = 0 }

        lock.lock()
        for vi in voices.indices where voices[vi].active {
            let buf = variants[voices[vi].buf]
            var k = 0
            while k < n {
                if voices[vi].delay > 0 {
                    voices[vi].delay -= 1
                    k += 1
                    continue
                }
                if voices[vi].pos >= buf.count {
                    voices[vi].active = false
                    break
                }
                out[k] += buf[voices[vi].pos] * voices[vi].gain
                voices[vi].pos += 1
                k += 1
            }
        }
        lock.unlock()

        let m = master
        for i in 0..<n { out[i] = min(max(out[i] * m, -1), 1) }
    }

    private func buildVariants() {
        let len = Int(AUDIO_RATE / 22) // ~45 ms
        for _ in 0..<N_VARIANTS {
            var buf = [Float](repeating: 0, count: len)
            let tau = Double.random(in: 0.006...0.016, using: &rng) // decay 6..16 ms
            let freq = Double.random(in: 200...700, using: &rng)    // body 200..700 Hz
            let noiseAmt = Double.random(in: 0.55...0.85, using: &rng)
            for i in 0..<len {
                let time = Double(i) / AUDIO_RATE
                let env = exp(-time / tau)
                let noise = Double.random(in: -1...1, using: &rng)
                let body = sin(2 * Double.pi * freq * time)
                buf[i] = Float(env * (noiseAmt * noise + (1 - noiseAmt) * body) * CLICK_PEAK)
            }
            variants.append(buf)
        }
    }
}
