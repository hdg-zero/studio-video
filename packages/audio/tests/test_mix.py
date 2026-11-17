from pathlib import Path

import numpy as np

from studio_audio.mix import duck_gain, fade_out, levels, moving_average, read_wav, voice_track, write_wav
from studio_audio.pitch import check, median_f0
from studio_audio.synth import SR
from studio_audio.timeline import Segment, Timeline


def test_moving_average_matches_convolution() -> None:
    x = np.random.default_rng(0).random(1000)
    expected = np.convolve(x, np.ones(9) / 9, mode="same")
    np.testing.assert_allclose(moving_average(x, 9)[10:-10], expected[10:-10])


def test_duck_gain_dips_under_voice_only() -> None:
    voice = np.zeros(4 * SR)
    voice[SR : 2 * SR] = np.sin(np.arange(SR) * 0.05)
    g = duck_gain(voice, 0.5)
    assert g[int(1.5 * SR)] < 0.6
    assert g[int(3.5 * SR)] == 1
    assert duck_gain(np.zeros(100), 0.5).tolist() == [1.0] * 100


def test_wav_roundtrip_and_fade(tmp_path: Path) -> None:
    x = np.stack([np.linspace(-0.5, 0.5, SR)] * 2)
    write_wav(tmp_path / "a.wav", fade_out(x, 0.1))
    y, rate = read_wav(tmp_path / "a.wav")
    assert rate == SR and y.shape == x.shape
    assert abs(y[0, -1]) < 1e-3
    np.testing.assert_allclose(y[:, : SR // 2], x[:, : SR // 2], atol=1e-4)


def pcm(path: Path, freq: float, seconds: float = 1.0) -> Path:
    t = np.arange(int(seconds * SR)) / SR
    path.write_bytes((np.sin(2 * np.pi * freq * t) * 0.5 * 32767).astype("<i2").tobytes())
    return path


def test_voice_track_places_clips(tmp_path: Path) -> None:
    pcm(tmp_path / "a.pcm", 200, 0.5)
    tl = Timeline((Segment("a", "calm", 0, 2, 1.0, 0.5), Segment("credits", "finale", 2, 3, None, 0)), 3)
    track = voice_track(tl, tmp_path, 3 * SR)
    assert np.abs(track[: SR - 10]).max() == 0
    assert np.abs(track[SR : SR + SR // 2]).max() > 0.9


def test_levels_report_voice_and_music() -> None:
    tl = Timeline((Segment("a", "calm", 0, 4, 1.0, 2.0),), 4)
    mix = np.zeros((2, 4 * SR))
    mix[:, SR : 3 * SR] = 0.3
    (lv,) = levels(mix, SR, tl)
    assert lv.voice_db > -12 and lv.music_db < -100


def test_pitch_detects_a_different_voice(tmp_path: Path) -> None:
    assert abs(median_f0(np.sin(2 * np.pi * 150 * np.arange(SR) / SR) * 0.5) - 150) < 3
    clips = [pcm(tmp_path / f"{i}.pcm", f) for i, f in enumerate([120, 125, 118, 240])]
    _, ref, suspicious = check(clips)
    assert 115 < ref < 130
    assert suspicious == [clips[3]]
