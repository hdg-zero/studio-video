"""One generator per segment mood. Add a mood by writing a function and registering it in MOODS.

A generator receives the synth, the block bounds (t0, t1), the first voice start and the last
segment of the block (consecutive segments sharing a mood are generated as one block).
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np

from .synth import BRIGHT_PROGRESSION, Synth
from .timeline import Segment

MoodFn = Callable[[Synth, float, float, float | None, Segment], None]


def intro(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    hit = max(t0 + 0.5, (v if v is not None else t0 + 1) - 0.2)
    s.sub(t0, t1 + 2, -24, 0.14)
    s.riser(t0, hit, 0.07)
    s.pad(t0 + 1, t1 + 2, s.progression[0], 0.035, 900, 3, 3)
    s.boom(hit, 0.35)


def calm(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.progression_pads(t0, t1, 7.0, amp=0.045, cutoff=1500)
    s.sub(t0, t1 + 1, -12, 0.08)


def pulse(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.progression_pads(t0, t1, 8.0, amp=0.04, cutoff=1800)
    s.arpeggio(t0 + 0.8, t1, 92, 0.045, density=0.55, growth=0.3)
    s.sub(t0, t1 + 1, -12, 0.08)


def build(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.progression_pads(t0, t1, 4.0, amp=0.045, cutoff=2500, attack=1, release=1.5)
    s.arpeggio(t0, t1, 104, 0.06, density=0.7, growth=0.3)
    for bt in np.arange(t0, t1, 60 / 104 / 2):
        s.kick(float(bt), 0.18)


def explosion(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    span = (t1 - t0) - 1.5
    impact = t0 + span
    s.pad(t0, t1 + 1, (0, 7, 12, 14, 19), 0.045, 3000, 1, 1)
    bt = t0
    while bt < impact:  # accelerating kicks
        s.kick(bt, 0.25)
        bt += max(0.07, 0.6 * (1 - (bt - t0) / span) ** 1.5)
    s.riser(impact - 5, impact, 0.12)
    s.arpeggio(t0, impact, 120, 0.05, density=0.6, growth=0.4)
    s.boom(impact, 0.7)
    s.pad(impact, t1 + 3, (-12, 0, 7, 12, 15, 19, 24), 0.05, 2200, 0.05, 3)


def suspense(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.pad(t0, t1 + 1, (-7, 0, 5, 10, 12), 0.04, 1200, 2, 2)
    for k, tt in enumerate(np.arange(t0 + 1, t1 - 1, 1.9)):
        s.bell(float(tt), (29, 24, 31, 26)[k % 4], 0.025, -0.5 + k % 3 * 0.5)


def bright(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.progression_pads(t0, t1 + 1, 5.0, BRIGHT_PROGRESSION, amp=0.045, cutoff=3200)
    for k, tt in enumerate(np.arange(t0 + 0.3, t1 - 0.5, 0.45)):
        s.bell(float(tt), (24, 28, 31, 35, 36, 38)[k % 6], 0.022, float(np.sin(k * 0.7) * 0.7))


def dark(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.pad(t0, t1 + 1, (-24, -12, -11, -5), 0.06, 500, 1.5, 2)
    s.sub(t0, t1 + 1, -24, 0.14)
    for _ in range(int((t1 - t0) * 5)):  # scattered metallic ticks
        tt = t0 + s.rng.random() * (t1 - t0)
        s.tick(tt, 1800 + s.rng.random() * 2500, 0.05, s.rng.random() * 2 - 1)


def minimal(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.pad(t0, t1 + 1, (0, 7, 10, 15), 0.035, 1100, 2, 2)
    for k, tt in enumerate(np.arange(t0 + 0.8, t1 - 1, 1.2)):
        s.pluck(float(tt), (12, 19, 15, 22, 10, 17)[k % 6], 0.045, 0.5, float(np.sin(k) * 0.5))


def finale(s: Synth, t0: float, t1: float, v: float | None, seg: Segment) -> None:
    s.pad(t0, t1 + 4, (-12, 0, 7, 12, 14, 15, 19), 0.05, 1800, 3, 5)
    s.sub(t0, t1 + 4, -24, 0.1)
    start = (v + seg.dur) if v is not None else t0 + 1
    for k, tt in enumerate(np.arange(start, t1 - 2, 1.1)):
        s.bell(float(tt), (36, 31, 27, 24, 19)[k % 5], 0.025, float(np.sin(k) * 0.5))


MOODS: dict[str, MoodFn] = {
    "intro": intro,
    "calm": calm,
    "pulse": pulse,
    "build": build,
    "explosion": explosion,
    "suspense": suspense,
    "bright": bright,
    "dark": dark,
    "minimal": minimal,
    "finale": finale,
}

#: Moods that are never merged with a neighbour of the same mood (they have a single climax).
UNMERGEABLE = frozenset({"intro", "explosion"})


def blocks(segments: tuple[Segment, ...]) -> list[tuple[Segment, Segment]]:
    """Groups consecutive segments sharing a mood: one smooth musical block instead of restarts."""
    out: list[tuple[Segment, Segment]] = []
    i = 0
    while i < len(segments):
        first = segments[i]
        j = i
        while j + 1 < len(segments) and segments[j + 1].mood == first.mood and first.mood not in UNMERGEABLE:
            j += 1
        out.append((first, segments[j]))
        i = j + 1
    return out


def compose(synth: Synth, segments: tuple[Segment, ...]) -> list[str]:
    """Writes the soundtrack for every block; returns one human-readable line per block."""
    report = []
    for first, last in blocks(segments):
        fn = MOODS.get(first.mood, calm)
        fn(synth, first.t0, last.t1, first.voice, last)
        report.append(f"{first.mood:10s} {first.t0:7.2f} → {last.t1:7.2f}")
    return report
