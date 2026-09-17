"""End-to-end check of the Demo Studio app: access control, voice upload, demo import, and a real render.
Run: uv run python tests/check.py   (uses a temporary Demo Studio folder; downloads the voice model if needed)"""
import io
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

home = Path(tempfile.mkdtemp(prefix="demo-studio-check-"))
os.environ["DEMO_STUDIO_HOME"] = str(home / "Demo Studio")

from demo_studio import DEMOS, SAMPLE, VIDEOS, app, render, voice  # noqa: E402

for folder in (DEMOS, VIDEOS):
    folder.mkdir(parents=True)
server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"


def call(path, body=None, token=app.TOKEN, host=None, **params):
    query = urlencode({"t": token, **params})
    request = urllib.request.Request(f"{base}{path}?{query}", data=body, method="POST" if body is not None else "GET")
    if host:
        request.add_header("Host", host)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


# Access: the private token and a local Host header are both required.
assert call("/api/state", token="wrong")[0] == 403
assert call("/api/state", host="evil.example")[0] == 403
assert call("/api/state")[0] == 200
print("ok  access control")

# A tiny demo package: 8 s of test video, a music bed, one sound effect, two lines.
package = home / "package" / "Check Demo"
package.mkdir(parents=True)
render.ffmpeg("-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=8", "-pix_fmt", "yuv420p", str(package / "video.mp4"))
render.ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=9", str(package / "music.wav"))
render.ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=0.3", str(package / "chime.wav"))
(package / "demo.json").write_text(json.dumps({
    "title": "Check Demo", "duration": 8,
    "lines": {"one": "Welcome to the check.", "two": "Everything works."},
    "cues": [{"voice": "one", "at": 0.5, "seconds": 2.5}, {"voice": "two", "at": 4.5, "seconds": 2.0}, {"sound": "chime.wav", "at": 7}],
}))

# Voice: too short is refused; a real 10+ s recording (made with the built-in voice) is kept.
short = home / "short.wav"
render.ffmpeg("-f", "lavfi", "-i", "sine=frequency=300:duration=3", str(short))
status, reply = call("/api/voice", short.read_bytes())
assert status == 400 and b"too short" in reply, reply
assert call("/api/voice", b"not audio")[0] == 400
speech = voice.speak({"sample": "Hi, let me show you how this works. Setting up takes about a minute, and once you're in, "
                                "everything you need is right here on one screen. Let's take a look together."}, None)["sample"]
print(f"ok  built-in voice ({speech['seconds']:.1f} s)")
recording = home / "recording.wav"  # played twice, so it clears the 8 s minimum whatever the take's length
render.ffmpeg("-stream_loop", "1", "-i", speech["file"], str(recording))
status, reply = call("/api/voice", recording.read_bytes())
assert status == 200 and SAMPLE.exists(), reply
print("ok  voice upload")

# Import: a zip whose entries try to escape the demos folder stays inside it.
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w") as archive:
    for file in package.iterdir():
        archive.write(file, f"Check Demo/{file.name}")
    archive.writestr("../../escaped.txt", "should not escape")
status, reply = call("/api/demos", buffer.getvalue(), name="Check Demo")
assert status == 200, reply
assert not list(home.rglob("escaped.txt")) or all(DEMOS in p.parents for p in home.rglob("escaped.txt"))
assert call("/api/demos", b"not a zip", name="x")[0] == 400
state = json.loads(call("/api/state")[1])
assert [d["id"] for d in state["demos"]] == ["Check Demo"], state
print("ok  demo import")

# Create: narrate in the uploaded voice, mix, and check the video has speech.
assert call("/api/create", json.dumps({"demo": "Check Demo"}).encode())[0] == 200
started = time.time()
while (job := json.loads(call("/api/state")[1])["job"])["state"] == "working":
    time.sleep(1)
assert job["state"] == "done", job
video = Path(job["video"])
probe = render.subprocess.run([render.FFMPEG, "-i", str(video), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
duration = re.search(r"Duration: 00:00:(\d+\.\d+)", probe)
volume = re.search(r"mean_volume: (-?[\d.]+) dB", probe)
assert duration and 7.5 < float(duration.group(1)) < 8.5, probe[-800:]
assert volume and float(volume.group(1)) > -40, probe[-800:]
print(f"ok  video created in {time.time() - started:.0f} s: {float(duration.group(1)):.1f} s, mean volume {volume.group(1)} dB")

# Forget: deleting the voice removes the sample and every voiced clip.
assert call("/api/voice/delete", b"")[0] == 200 and not SAMPLE.exists() and not list(voice.CLIPS.glob("*.wav"))
print("ok  delete voice")
server.shutdown()
sys.exit(0)
