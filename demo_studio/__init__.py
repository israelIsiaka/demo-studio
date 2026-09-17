"""Demo Studio: narrate product demo videos in your own voice, on your own computer."""
import os
from pathlib import Path

HOME = Path(os.environ.get("DEMO_STUDIO_HOME", Path.home() / "Demo Studio"))
SAMPLE = HOME / "voice" / "sample.wav"
DEMOS = HOME / "demos"
VIDEOS = HOME / "videos"
