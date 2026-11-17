"""Timeline as written by `studio timeline` (audio side only needs ids, moods and times)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Segment:
    id: str
    mood: str
    t0: float
    t1: float
    voice: float | None
    dur: float


@dataclass(frozen=True, slots=True)
class Timeline:
    segments: tuple[Segment, ...]
    duration: float


def load_timeline(path: Path) -> Timeline:
    data = json.loads(path.read_text(encoding="utf-8"))
    segments = tuple(
        Segment(
            id=s["id"],
            mood=s.get("mood") or "calm",
            t0=float(s["t0"]),
            t1=float(s["t1"]),
            voice=None if s.get("voice") is None else float(s["voice"]),
            dur=float(s.get("dur", 0.0)),
        )
        for s in data["segments"]
    )
    return Timeline(segments=segments, duration=float(data["duration"]))
