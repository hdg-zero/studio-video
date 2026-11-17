"""Voice consistency check: every clip should be spoken by the same voice.

A clip whose median pitch is more than ~30 % away from the others is almost certainly a
different speaker (what Fish Audio does when no fixed voice is given).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .mix import read_pcm
from .synth import SR, Signal


def median_f0(x: Signal, rate: int = SR, frame: int = 2048, hop: int = 1024) -> float:
    """Median fundamental frequency (Hz) by autocorrelation over voiced frames; NaN if none."""
    if len(x) < frame:
        return float("nan")
    starts = np.arange(0, len(x) - frame, hop)
    frames = np.stack([x[i : i + frame] for i in starts])
    voiced = np.sqrt((frames**2).mean(axis=1)) >= 0.02
    frames = frames[voiced]
    if len(frames) == 0:
        return float("nan")
    # batched autocorrelation through the FFT (Wiener-Khinchin), much faster than np.correlate per frame
    spec = np.fft.rfft(frames, 2 * frame, axis=1)
    ac = np.fft.irfft(np.abs(spec) ** 2, axis=1)[:, :frame]
    lo, hi = rate // 400, rate // 60
    lag = lo + np.argmax(ac[:, lo:hi], axis=1)
    strong = ac[np.arange(len(ac)), lag] > 0.3 * ac[:, 0]
    if not strong.any():
        return float("nan")
    return float(np.median(rate / lag[strong]))


def check(paths: list[Path], tolerance: float = 0.3) -> tuple[dict[Path, float], float, list[Path]]:
    """Returns each clip's median f0, the reference (median of medians) and the suspicious clips."""
    f0 = {p: median_f0(read_pcm(p)) for p in paths}
    ref = float(np.nanmedian(list(f0.values()))) if f0 else float("nan")
    suspicious = [p for p, v in f0.items() if not np.isnan(v) and abs(v - ref) / ref > tolerance]
    return f0, ref, suspicious
