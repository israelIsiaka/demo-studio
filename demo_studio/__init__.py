"""Demo Studio: narrate product demo videos in your own voice, on your own computer."""
import os
from pathlib import Path

HOME = Path(os.environ.get("DEMO_STUDIO_HOME", Path.home() / "Demo Studio"))
VOICE = HOME / "voice"
SAMPLE = VOICE / "sample.wav"
DEMOS = HOME / "demos"
VIDEOS = HOME / "videos"
SETTINGS = HOME / "settings.json"
# Our own FFmpeg build. imageio-ffmpeg's binary is built --enable-gpl
# --enable-libx264, and the npm one the kit uses adds --enable-nonfree, which
# cannot be redistributed at all - fine to run here, impossible to put in an
# installer. The app only copies the video stream and encodes audio, so it
# needs none of that: tools/build-ffmpeg.sh produces an LGPL-only build.
BIN = HOME / "bin"
