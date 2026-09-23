"""Turns a demo package into a finished MP4 in a given voice.

A demo package is a folder with:
  demo.json   {"title", "duration", "lines": {key: text},
               "cues": [{"voice": key, "at": s, "seconds": slot}, {"sound": "chime.wav", "at": s}]}
  video.mp4   the silent recording
  music.wav   the music bed, at least as long as the video
  *.wav       the sound effects the cues name
"""
import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

from . import BIN, VIDEOS, voice


def _ffmpeg_exe():
    """The FFmpeg to run, most deliberate choice first.

    Ours if it is there (LGPL only - see BIN), otherwise imageio-ffmpeg's,
    which is a GPL build: perfectly fine on a developer's own machine, and the
    reason a stock install cannot simply be copied into an installer.
    """
    override = os.environ.get("DEMO_STUDIO_FFMPEG")
    if override:
        return override
    ours = BIN / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if ours.exists():
        return str(ours)
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


FFMPEG = _ffmpeg_exe()
# ponytail: a line longer than its slot is sped up, at most this much; past that it runs into the pause after it.
MAX_TEMPO = 1.25
VOICE_GAIN, MUSIC_GAIN, FX_GAIN = 2.3, 0.3, 0.55  # voices arrive at -20 LUFS


def ffmpeg(*args):
    result = subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-2000:]}")


def render(package, out=None, tone=voice.DEFAULT_TONE, on_step=print):
    package = Path(package)
    demo = json.loads((package / "demo.json").read_text(encoding="utf-8"))
    clips = voice.speak(demo["lines"], tone, on_step)
    on_step("Mixing the soundtrack")
    total = float(demo["duration"])
    if out is None:
        VIDEOS.mkdir(parents=True, exist_ok=True)
        name = re.sub(r'[<>:"/\\|?*]', "", demo["title"]).strip() or "Demo"
        out = VIDEOS / f"{name} {datetime.now():%Y-%m-%d %H%M}.mp4"

    voices = [c for c in demo["cues"] if "voice" in c]
    sounds = [c for c in demo["cues"] if "sound" in c]
    inputs = ["-i", str(package / "video.mp4"), "-i", str(package / "music.wav")]
    graph = []
    for n, cue in enumerate(voices + sounds, 2):
        if "voice" in cue:
            clip = clips[cue["voice"]]
            inputs += ["-i", clip["file"]]
            tempo = min(clip["seconds"] / cue["seconds"], MAX_TEMPO)
            fit = f"atempo={tempo:.4f}," if tempo > 1.01 else ""
        else:
            inputs += ["-i", str(package / cue["sound"])]
            fit = ""
        graph.append(f"[{n}:a]{fit}aformat=sample_rates=44100:channel_layouts=stereo,adelay={round(cue['at'] * 1000)}:all=1[a{n}]")
    speech = "".join(f"[a{n}]" for n in range(2, 2 + len(voices)))
    effects = "".join(f"[a{n}]" for n in range(2 + len(voices), 2 + len(voices) + len(sounds)))
    graph.append(f"{speech}amix=inputs={len(voices)}:normalize=0:duration=longest,volume={VOICE_GAIN},asplit=2[voice][key]")
    graph.append(f"[1:a]volume={MUSIC_GAIN}[music]")
    # Duck the music hard while someone is speaking, and let it swell back in the gaps.
    graph.append("[music][key]sidechaincompress=threshold=0.01:ratio=14:attack=15:release=550:makeup=1[bed]")
    if sounds:
        graph.append(f"{effects}amix=inputs={len(sounds)}:normalize=0:duration=longest,volume={FX_GAIN}[fx]")
        mix = "[bed][voice][fx]amix=inputs=3"
    else:
        mix = "[bed][voice]amix=inputs=2"
    # level=0: limit peaks only, never auto-raise the whole mix into the ceiling.
    graph.append(f"{mix}:normalize=0:duration=first,alimiter=limit=0.84:level=0,atrim=0:{total:.3f}[out]")
    ffmpeg(*inputs, "-filter_complex", ";".join(graph), "-map", "0:v", "-map", "[out]", "-c:v", "copy",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{total:.3f}", str(out))
    return Path(out)
