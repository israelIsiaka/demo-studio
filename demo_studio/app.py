"""The Demo Studio app: a page served only to this computer for recording a voice and creating videos."""
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import DEMOS, SAMPLE, VIDEOS, VOICE, render, voice

TOKEN = secrets.token_urlsafe(24)  # other websites open in the browser can't reach the app without it
PAGE = (Path(__file__).parent / "index.html").read_text(encoding="utf-8")
MAX_UPLOAD = 1024**3
PREVIEW = "Here's a quick preview of how your demo will sound. Every line is spoken in this voice."
job = {"state": "idle"}


def demos():
    found = []
    for manifest in sorted(DEMOS.glob("*/demo.json")):
        try:
            demo = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        found.append({"id": manifest.parent.name, "title": demo.get("title", manifest.parent.name),
                      "duration": demo.get("duration", 0), "lines": list(demo.get("lines", {}).values())})
    return found


def reveal(path):
    if sys.platform == "win32":
        os.startfile(path)
    else:
        subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", str(path)])


def save_recording(audio, tone):
    import soundfile

    with tempfile.TemporaryDirectory() as tmp:
        recording, converted = Path(tmp) / "recording", Path(tmp) / "take.wav"
        recording.write_bytes(audio)
        try:
            render.ffmpeg("-i", str(recording), "-vn", "-ac", "1", "-ar", "44100", str(converted))
        except RuntimeError:
            return "That file doesn't look like an audio recording."
        if soundfile.info(converted).duration < 8:
            return "That recording is too short. Speak for 10 to 20 seconds."
        VOICE.mkdir(parents=True, exist_ok=True)
        shutil.move(converted, voice.take(tone))


def import_demo(data, name):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return "Choose a demo package saved as a .zip file."
    with archive, tempfile.TemporaryDirectory(dir=DEMOS) as tmp:
        if sum(info.file_size for info in archive.infolist()) > 4 * MAX_UPLOAD:
            return "That demo package is too large."
        unpacked = Path(tmp) / "package"
        archive.extractall(unpacked)  # zipfile drops absolute paths and ".." parts
        manifest = min(unpacked.rglob("demo.json"), key=lambda p: len(p.parts), default=None)
        if manifest is None:
            return "That zip isn't a demo package: it has no demo.json inside."
        base = re.sub(r'[<>:"/\\|?*.]', "", name).strip() or "Demo"
        target, n = DEMOS / base, 2
        while target.exists():
            target, n = DEMOS / f"{base} {n}", n + 1
        shutil.move(manifest.parent, target)


def run_job(kind, work):
    """One job at a time (a video or a preview); the page polls /api/state for its steps."""
    job.clear()
    job.update(state="working", kind=kind, step="Starting")

    def step(text):
        job["step"] = text

    def target():
        try:
            job["result"] = str(work(step))
            job["state"] = "done"
        except Exception as error:  # shown to the person in the page
            job.update(state="error", error=str(error))

    threading.Thread(target=target, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def route(self):
        url = urlparse(self.path)
        local = self.headers.get("Host", "").rsplit(":", 1)[0] in ("127.0.0.1", "localhost")
        return (url.path if local and parse_qs(url.query).get("t") == [TOKEN] else None), parse_qs(url.query)

    def reply(self, code, body=None, kind="application/json"):
        data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body or {})).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path, query = self.route()
        tone = query.get("tone", ["main"])[0]
        if path == "/":
            self.reply(200, PAGE.replace("__TOKEN__", TOKEN), "text/html; charset=utf-8")
        elif path == "/api/state":
            tones = [{"id": t, **info, "recorded": voice.take(t).exists()} for t, info in voice.TONES.items()]
            self.reply(200, {"voice": SAMPLE.exists(), "tone": voice.saved_tone(), "tones": tones, "demos": demos(), "job": job})
        elif path == "/api/voice" and tone in voice.TONES and voice.take(tone).exists():
            self.reply(200, voice.take(tone).read_bytes(), "audio/wav")
        elif path == "/api/preview" and job.get("kind") == "preview" and job.get("state") == "done":
            self.reply(200, Path(job["result"]).read_bytes(), "audio/wav")
        else:
            self.reply(403 if path is None else 404, "Open Demo Studio from the link it printed when it started.", "text/plain")

    def do_POST(self):
        path, query = self.route()
        size = int(self.headers.get("Content-Length") or 0)
        if path is None or size > MAX_UPLOAD:
            return self.reply(403 if path is None else 413)
        body = self.rfile.read(size)
        tone = query.get("tone", ["main"])[0]
        error = None
        if tone not in voice.TONES:
            error = "Unknown tone."
        elif path == "/api/voice":
            error = save_recording(body, tone)
        elif path == "/api/voice/delete":
            voice.forget(tone if query.get("tone") else None)
        elif path == "/api/tone":
            voice.save_tone(tone)
        elif path == "/api/demos":
            error = import_demo(body, query.get("name", ["Demo"])[0])
        elif path in ("/api/preview", "/api/create"):
            demo_id = json.loads(body or b"{}").get("demo", "")
            chosen = voice.saved_tone()
            if job.get("state") == "working":
                error = "Demo Studio is still busy with the last request."
            elif not SAMPLE.exists():
                error = "Record your voice first."
            elif path == "/api/preview":
                run_job("preview", lambda step: voice.speak({"preview": PREVIEW}, chosen, step)["preview"]["file"])
            elif demo_id not in {d["id"] for d in demos()}:
                error = "Choose a demo first."
            else:
                run_job("video", lambda step: render.render(DEMOS / demo_id, tone=chosen, on_step=step))
        elif path == "/api/open" and job.get("kind") == "video" and job.get("state") == "done":
            video = Path(job["result"])
            reveal(video if query.get("what") == ["video"] else video.parent)
        else:
            return self.reply(404)
        self.reply(400 if error else 200, {"error": error} if error else {})


def serve():
    for folder in (DEMOS, VIDEOS, VOICE):
        folder.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    url = f"http://127.0.0.1:{server.server_port}/?t={TOKEN}"
    print(f"Demo Studio is open in your browser.\nIf it didn't open, visit: {url}\nKeep this window open while you use it. Press Ctrl+C to quit.", flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
