"""Reverb, voice track, side-chain ducking, normalisation and level report."""

from __future__ import annotations

import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from .synth import SR, Signal
from .timeline import Timeline

Stereo = NDArray[np.float64]


def reverb(buffer: Stereo, rng: np.random.Generator, seconds: float = 2.8, wet: float = 0.9) -> Stereo:
    """FFT convolution with decaying noise, a different impulse per channel for width."""
    n = buffer.shape[1]
    irn = int(seconds * SR)
    size = 1 << int(np.ceil(np.log2(n + irn)))
    out = buffer.copy()
    for c in range(2):
        ir = rng.standard_normal(irn) * np.exp(-np.arange(irn) / SR * 2.2)
        ir[: int(0.02 * SR)] = 0  # 20 ms pre-delay
        tail = np.fft.irfft(np.fft.rfft(buffer[c], size) * np.fft.rfft(ir, size), size)[:n]
        out[c] = buffer[c] + wet * tail / (np.abs(tail).max() + 1e-9) * np.abs(buffer[c]).max()
    normalised: Stereo = out / (np.abs(out).max() + 1e-9)
    return normalised


def read_pcm(path: Path) -> Signal:
    """Raw PCM s16le mono → float in [-1, 1]."""
    return np.frombuffer(path.read_bytes(), dtype=np.int16).astype(np.float64) / 32768


def voice_track(timeline: Timeline, voice_dir: Path, n: int) -> Signal:
    """Places every clip at its segment's voice time; silent where there is no clip."""
    track = np.zeros(n)
    for s in timeline.segments:
        clip = voice_dir / f"{s.id}.pcm"
        if s.voice is None or not clip.exists():
            continue
        x = read_pcm(clip)
        i = int(s.voice * SR)
        m = min(len(x), n - i)
        if m > 0:
            track[i : i + m] += x[:m]
    peak = np.abs(track).max()
    return track / peak if peak > 0 else track


def moving_average(x: Signal, width: int) -> Signal:
    """Centred moving average via cumulative sums: O(n) whatever the width."""
    c = np.concatenate([[0.0], np.cumsum(x)])
    avg = (c[width:] - c[:-width]) / width
    return np.concatenate([np.zeros(width // 2), avg, np.zeros(width - width // 2 - 1)])[: len(x)]


def duck_gain(voice: Signal, depth: float) -> Signal:
    """Gain curve that dips the music by up to `depth` where the voice is loud."""
    env = moving_average(np.abs(voice), int(0.25 * SR))
    active = env[env > 1e-4]
    if len(active) == 0:
        return np.ones_like(voice)
    env = np.clip(env / (np.percentile(active, 90) + 1e-9), 0, 1)
    return 1 - depth * env


def fade_out(x: Stereo, seconds: float = 2.5) -> Stereo:
    n = min(int(seconds * SR), x.shape[-1])
    y = x.copy()
    y[..., -n:] *= np.linspace(1, 0, n)
    return y


def write_wav(path: Path, x: Stereo, rate: int = SR) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(x, -1, 1).T * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def read_wav(path: Path) -> tuple[Stereo, int]:
    with wave.open(str(path)) as w:
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768
        return data.reshape(-1, w.getnchannels()).T, rate


def loudnorm(src: Path, dst: Path) -> None:
    """EBU R128 normalisation to -16 LUFS / -1.5 dBTP at 48 kHz (ffmpeg)."""
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", str(dst)],
        check=True,
    )  # fmt: skip


def rms_db(x: Stereo) -> float:
    return float(20 * np.log10(np.sqrt((x**2).mean()) + 1e-9)) if x.size else float("nan")


@dataclass(frozen=True, slots=True)
class Level:
    segment: str
    voice_db: float
    music_db: float


def levels(mix: Stereo, rate: int, timeline: Timeline) -> list[Level]:
    """Voice vs music-alone loudness per segment, to check the balance without listening."""
    out = []
    for s in timeline.segments:
        if s.voice is None:
            continue
        v = mix[:, int((s.voice + 0.5) * rate) : int((s.voice + max(0.6, s.dur - 0.5)) * rate)]
        m = mix[:, int((s.voice + s.dur + 0.3) * rate) : int(s.t1 * rate)]
        out.append(Level(s.id, rms_db(v), rms_db(m)))
    return out
