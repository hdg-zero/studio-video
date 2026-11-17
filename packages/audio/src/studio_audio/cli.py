"""Command line of the audio package (called by `studio music` / `studio voicecheck`).

python -m studio_audio mix --timeline T --voice-dir V --out-dir O [--root 50] [--major] ...
python -m studio_audio voicecheck clip1.pcm clip2.pcm ...
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

from . import mix as mx
from .moods import compose
from .pitch import check
from .synth import SR, Synth
from .timeline import load_timeline


def run_mix(a: argparse.Namespace) -> int:
    started = time.perf_counter()
    timeline = load_timeline(a.timeline)
    synth = Synth(timeline.duration, root=a.root, major=a.major, seed=a.seed)
    for line in compose(synth, timeline.segments):
        print(line)
    music = mx.reverb(synth.buffer, synth.rng)

    n_out = int(timeline.duration * SR)
    out: Path = a.out_dir
    mx.write_wav(out / "music.wav", mx.fade_out(music[:, :n_out]) * 0.9)

    voice = np.zeros(synth.n) if a.no_voice else mx.voice_track(timeline, a.voice_dir, synth.n)
    gain = mx.duck_gain(voice, a.duck)
    mixed = np.stack([voice * 0.9 + music[c] * a.music_gain * gain for c in range(2)])
    mixed = mx.fade_out(mixed[:, :n_out])
    mixed /= np.abs(mixed).max() / 0.95 + 1e-12
    mx.write_wav(out / "mix.wav", mixed)
    mx.loudnorm(out / "mix.wav", out / "mix_norm.wav")

    if not a.no_voice:
        final, rate = mx.read_wav(out / "mix_norm.wav")
        for lv in mx.levels(final, rate, timeline):
            print(f"{lv.segment:16s} voix {lv.voice_db:6.1f} dB | musique seule {lv.music_db:6.1f} dB")
        print("cible : musique seule entre -25 et -35 dB quand la voix est vers -19 dB (régler music.gain)")
    print(f"écrit {out / 'mix_norm.wav'} en {time.perf_counter() - started:.1f} s")
    return 0


def run_voicecheck(a: argparse.Namespace) -> int:
    f0, ref, suspicious = check(a.clips, a.tolerance)
    for p, v in f0.items():
        flag = "  <-- autre voix ?" if p in suspicious else ""
        print(f"{p.name:24s} f0 médiane {v:6.1f} Hz{flag}")
    status = (
        "OK" if not suspicious else f"{len(suspicious)} clip(s) suspect(s) : studio tts <projet> --only <id>"
    )
    print(f"référence {ref:.1f} Hz — {status}")
    return 1 if suspicious else 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="studio_audio")
    sub = p.add_subparsers(dest="command", required=True)

    m = sub.add_parser("mix", help="synthesise the soundtrack and mix it under the voice")
    m.add_argument("--timeline", type=Path, required=True)
    m.add_argument("--voice-dir", type=Path, required=True)
    m.add_argument("--out-dir", type=Path, required=True)
    m.add_argument("--root", type=int, default=50, help="MIDI root of the key (50 = D3)")
    m.add_argument("--major", action="store_true")
    m.add_argument("--music-gain", type=float, default=0.55)
    m.add_argument("--duck", type=float, default=0.55, help="music dip under the voice (0-1)")
    m.add_argument("--seed", type=int, default=7)
    m.add_argument("--no-voice", action="store_true")
    m.set_defaults(func=run_mix)

    v = sub.add_parser("voicecheck", help="flag clips spoken by a different voice")
    v.add_argument("clips", type=Path, nargs="+")
    v.add_argument("--tolerance", type=float, default=0.3)
    v.set_defaults(func=run_voicecheck)
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    code: int = args.func(args)
    return code


if __name__ == "__main__":
    sys.exit(main())
