import numpy as np

from studio_audio.moods import MOODS, blocks, compose
from studio_audio.synth import SR, Synth, envelope, lowpass, midi_to_hz
from studio_audio.timeline import Segment


def seg(id_: str, mood: str, t0: float, t1: float) -> Segment:
    return Segment(id=id_, mood=mood, t0=t0, t1=t1, voice=t0 + 0.5, dur=t1 - t0 - 1)


def test_midi_to_hz() -> None:
    assert midi_to_hz(69) == 440
    assert abs(midi_to_hz(81) - 880) < 1e-9


def test_envelope_bounds() -> None:
    e = envelope(SR, 0.1, 0.1)
    assert e[0] == 0 and e[-1] == 0 and e[SR // 2] == 1


def test_lowpass_attenuates_high_frequencies() -> None:
    t = np.arange(SR) / SR
    low, high = np.sin(2 * np.pi * 100 * t), np.sin(2 * np.pi * 8000 * t)
    assert np.std(lowpass(low, 1000)) > 0.6
    assert np.std(lowpass(high, 1000)) < 0.05


def test_same_seed_same_music() -> None:
    segments = (seg("a", "pulse", 0, 4), seg("b", "bright", 4, 8))
    a, b = Synth(8, seed=3), Synth(8, seed=3)
    compose(a, segments)
    compose(b, segments)
    np.testing.assert_array_equal(a.buffer, b.buffer)


def test_every_mood_produces_bounded_sound() -> None:
    for mood in MOODS:
        s = Synth(8)
        compose(s, (seg("x", mood, 0, 8),))
        assert np.abs(s.buffer).max() > 0, mood
        assert np.isfinite(s.buffer).all(), mood


def test_blocks_merge_same_moods_except_climaxes() -> None:
    segments = (
        seg("a", "calm", 0, 1),
        seg("b", "calm", 1, 2),
        seg("c", "intro", 2, 3),
        seg("d", "intro", 3, 4),
    )
    assert [(f.id, last.id) for f, last in blocks(segments)] == [("a", "b"), ("c", "c"), ("d", "d")]
