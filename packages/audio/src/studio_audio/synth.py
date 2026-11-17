"""Additive / subtractive instruments rendered into a stereo float buffer.

Everything is vectorised numpy. Two rules keep it fast on multi-minute tracks:
- never convolve long kernels in the time domain: filters and reverb use FFTs;
- short, repeated sounds (plucks, bells) are synthesised once per pitch and cached.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
from numpy.typing import NDArray

SR = 44_100
Signal = NDArray[np.float64]

# Diatonic chords as semitone offsets from the root.
MINOR_PROGRESSION = ((0, 7, 12, 15, 19), (-4, 3, 8, 12, 15), (-9, 3, 7, 10, 15), (-2, 5, 10, 14, 17))
MAJOR_PROGRESSION = ((0, 7, 12, 16, 19), (-3, 4, 9, 12, 16), (-7, 5, 9, 12, 17), (-5, 2, 7, 11, 14))
#: Major colour borrowed for "bright" segments, in both modes.
BRIGHT_PROGRESSION = ((0, 7, 12, 16, 19, 26), (5, 12, 16, 19, 24, 28))


def midi_to_hz(m: float) -> float:
    return float(440.0 * 2.0 ** ((m - 69) / 12))


def envelope(n: int, attack: float, release: float) -> Signal:
    """Quadratic attack/release envelope over `n` samples."""
    e = np.ones(n)
    at = min(int(attack * SR), n // 2)
    rt = min(int(release * SR), n - at)
    if at:
        e[:at] = np.linspace(0.0, 1.0, at) ** 2
    if rt:
        e[n - rt :] *= np.linspace(1.0, 0.0, rt) ** 2
    return e


def lowpass(x: Signal, cutoff: float) -> Signal:
    """Gentle 2nd-order-like low-pass applied in the frequency domain."""
    spectrum = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(spectrum / np.sqrt(1 + (f / cutoff) ** 4), len(x))


@lru_cache(maxsize=256)
def _pluck(freq: float, decay: float) -> Signal:
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    s = (
        np.sin(2 * np.pi * freq * t)
        + 0.35 * np.sin(4 * np.pi * freq * t)
        + 0.12 * np.sin(6 * np.pi * freq * t)
    )
    out = s * np.exp(-t / decay) * envelope(n, 0.003, 0.05)
    out.setflags(write=False)
    return out


@lru_cache(maxsize=128)
def _bell(freq: float) -> Signal:
    n = int(3 * SR)
    t = np.arange(n) / SR
    partials = ((1.0, 1.0, 1.2), (2.76, 0.5, 0.5), (5.4, 0.25, 0.25), (8.9, 0.1, 0.12))
    s = sum(g * np.sin(2 * np.pi * freq * h * t) * np.exp(-t / d) for h, g, d in partials)
    out = np.asarray(s) * envelope(n, 0.002, 0.1)
    out.setflags(write=False)
    return out


class Synth:
    """A stereo buffer plus the instruments that write into it."""

    def __init__(self, duration: float, *, root: int = 50, major: bool = False, seed: int = 7) -> None:
        self.duration = duration
        self.n = int(duration * SR) + SR
        self.buffer: NDArray[np.float64] = np.zeros((2, self.n))
        self.rng = np.random.default_rng(seed)
        self.root = root
        self.major = major
        self.progression = MAJOR_PROGRESSION if major else MINOR_PROGRESSION
        m = int(major)
        self.arpeggios = ((12, 15 + m, 19, 22 + 2 * m), (8, 12, 15, 19), (10, 15, 19, 22), (10, 14, 17, 21))

    def freq(self, semitones: float) -> float:
        return midi_to_hz(self.root + semitones)

    def add(self, t0: float, sig: Signal, pan: float = 0.0, gain: float = 1.0) -> None:
        """Mixes `sig` at time `t0` with constant-power panning (-1 left … 1 right)."""
        i = int(t0 * SR)
        n = min(len(sig), self.n - i)
        if n <= 0 or i < 0:
            return
        left = np.cos((pan + 1) * np.pi / 4) * gain * np.sqrt(2)
        right = np.sin((pan + 1) * np.pi / 4) * gain * np.sqrt(2)
        self.buffer[0, i : i + n] += sig[:n] * left
        self.buffer[1, i : i + n] += sig[:n] * right

    # ---- instruments -------------------------------------------------------------------------

    def pad(
        self,
        t0: float,
        t1: float,
        notes: tuple[int, ...],
        amp: float = 0.045,
        cutoff: float = 1500,
        attack: float = 2.5,
        release: float = 2.5,
    ) -> None:
        """Detuned saw chord, low-passed, spread across the stereo field."""
        n = int((t1 - t0) * SR)
        if n <= SR // 10:
            return
        t = np.arange(n) / SR
        env = envelope(n, attack, release)
        for k, m in enumerate(notes):
            f = self.freq(m)
            phase = self.rng.random()
            saw = sum(2 * ((f * (1 + d) * (t + phase)) % 1) - 1 for d in (-0.006, 0.0, 0.007)) / 3
            pan = (k / max(1, len(notes) - 1) - 0.5) * 1.2
            self.add(t0, lowpass(np.asarray(saw), cutoff) * env, pan=pan, gain=amp)

    def pluck(self, t0: float, m: float, amp: float = 0.06, decay: float = 0.35, pan: float = 0.0) -> None:
        self.add(t0, _pluck(round(self.freq(m), 4), decay), pan, amp)

    def bell(self, t0: float, m: float, amp: float = 0.03, pan: float = 0.0) -> None:
        self.add(t0, _bell(round(self.freq(m), 4)), pan, amp)

    def sub(self, t0: float, t1: float, m: float = -24, amp: float = 0.09) -> None:
        n = int((t1 - t0) * SR)
        if n <= 0:
            return
        t = np.arange(n) / SR
        self.add(t0, np.sin(2 * np.pi * self.freq(m) * t) * envelope(n, 2, 2), 0, amp)

    def riser(self, t0: float, t1: float, amp: float = 0.1) -> None:
        """Noise sweep opening from dark to bright."""
        n = int((t1 - t0) * SR)
        if n <= 0:
            return
        x = self.rng.standard_normal(n)
        k = np.linspace(0, 1, n)
        sig = (lowpass(x, 400) * (1 - k) + lowpass(x, 6000) * k) * k**2.5 * envelope(n, 0.1, 0.05)
        self.add(t0, sig, 0, amp)

    def boom(self, t0: float, amp: float = 0.6) -> None:
        """Cinematic impact: falling sine + filtered noise burst."""
        n = int(3 * SR)
        t = np.arange(n) / SR
        phase = 2 * np.pi * np.cumsum(30 + 70 * np.exp(-t * 6)) / SR
        noise = lowpass(self.rng.standard_normal(n), 900) * np.exp(-t * 5) * 0.5
        self.add(t0, np.sin(phase) * np.exp(-t * 1.4) + noise, 0, amp)

    def kick(self, t0: float, amp: float = 0.2) -> None:
        n = int(0.25 * SR)
        t = np.arange(n) / SR
        self.add(t0, np.sin(2 * np.pi * (45 + 40 * np.exp(-t * 30)) * t) * np.exp(-t * 14), 0, amp)

    def tick(self, t0: float, freq: float, amp: float = 0.05, pan: float = 0.0) -> None:
        n = int(0.4 * SR)
        t = np.arange(n) / SR
        self.add(t0, np.sin(2 * np.pi * freq * t) * np.exp(-t * 18) * 0.4, pan, amp)

    def arpeggio(
        self,
        t0: float,
        t1: float,
        bpm: float = 96,
        amp: float = 0.05,
        density: float = 1.0,
        growth: float = 0.0,
    ) -> None:
        """16th-note arpeggio over the chord progression; `density + growth*k` = probability of each note."""
        step = 60 / bpm / 4
        times = np.arange(t0, t1, step)
        span = max(1e-6, t1 - t0)
        for i, t in enumerate(times):
            k = (t - t0) / span
            chord = self.arpeggios[int(k * len(self.arpeggios)) % len(self.arpeggios)]
            if self.rng.random() < density + growth * k:
                fade = min(1.0, (t - t0) / 1.5, (t1 - t) / 1.5)
                octave = 12 if (i // len(chord)) % 2 else 0
                self.pluck(
                    float(t),
                    chord[i % len(chord)] + octave,
                    amp * max(0.0, fade),
                    0.3,
                    pan=float(np.sin(i * 1.3) * 0.5),
                )

    def progression_pads(
        self,
        t0: float,
        t1: float,
        bar: float = 7.0,
        chords: tuple[tuple[int, ...], ...] | None = None,
        *,
        amp: float = 0.045,
        cutoff: float = 1500,
        attack: float = 2.5,
        release: float = 2.5,
    ) -> None:
        """One pad per bar, cycling through the chord progression, overlapping by 2 s."""
        chords = chords or self.progression
        t, i = t0, 0
        while t < t1 - 0.5:
            end = min(t1, t + bar)
            self.pad(t, end + 2.0, chords[i % len(chords)], amp, cutoff, attack, release)
            t, i = end, i + 1
