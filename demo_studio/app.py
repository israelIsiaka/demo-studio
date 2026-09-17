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

from . import DEMOS, SAMPLE, VIDEOS, render, voice

TOKEN = secrets.token_urlsafe(24)  # other websites open in the browser can't reach the app without it
PAGE = (Path(__file__).parent / "index.html").read_text(encoding="utf-8")
MAX_UPLOAD = 1024**3
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


def save_voice(audio):
    import soundfile

    with tempfile.TemporaryDirectory() as tmp:
        recording, converted = Path(tmp) / "recording", Path(tmp) / "sample.wav"
        recording.write_bytes(audio)
        try:
            render.ffmpeg("-i", str(recording), "-vn", "-ac", "1", "-ar", "44100", str(converted))
        except RuntimeError:
            return "That file doesn't look like an audio recording."
        if soundfile.info(converted).duration < 8:
            return "That recording is too short. Speak for 10 to 20 seconds."
        SAMPLE.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(converted, SAMPLE)
    voice.forget()


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


def create(demo_id):
    def step(text):
        job["step"] = text

    try:
        job["video"] = str(render.render(DEMOS / demo_id, sample=SAMPLE, on_step=step))
        job["state"] = "done"
    except Exception as error:  # shown to the person in the page
        job.update(state="error", error=str(error))


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
        path, _ = self.route()
        if path == "/":
            self.reply(200, PAGE.replace("__TOKEN__", TOKEN), "text/html; charset=utf-8")
        elif path == "/api/state":
            self.reply(200, {"voice": SAMPLE.exists(), "demos": demos(), "job": job})
        elif path == "/api/voice" and SAMPLE.exists():
            self.reply(200, SAMPLE.read_bytes(), "audio/wav")
        else:
            self.reply(403 if path is None else 404, "Open Demo Studio from the link it printed when it started.", "text/plain")

    def do_POST(self):
        path, query = self.route()
        size = int(self.headers.get("Content-Length") or 0)
        if path is None or size > MAX_UPLOAD:
            return self.reply(403 if path is None else 413)
        body = self.rfile.read(size)
        error = None
        if path == "/api/voice":
            error = save_voice(body)
        elif path == "/api/voice/delete":
            SAMPLE.unlink(missing_ok=True)
            voice.forget()
        elif path == "/api/demos":
            error = import_demo(body, query.get("name", ["Demo"])[0])
        elif path == "/api/create":
            demo_id = json.loads(body or b"{}").get("demo", "")
            if job.get("state") == "working":
                error = "A video is already being made."
            elif not SAMPLE.exists():
                error = "Record your voice first."
            elif demo_id not in {d["id"] for d in demos()}:
                error = "Choose a demo first."
            else:
                job.clear()
                job.update(state="working", step="Starting", demo=demo_id)
                threading.Thread(target=create, args=(demo_id,), daemon=True).start()
        elif path == "/api/open" and job.get("video"):
            video = Path(job["video"])
            reveal(video if query.get("what") == ["video"] else video.parent)
        else:
            return self.reply(404)
        self.reply(400 if error else 200, {"error": error} if error else {})


def serve():
    for folder in (DEMOS, VIDEOS, SAMPLE.parent):
        folder.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    url = f"http://127.0.0.1:{server.server_port}/?t={TOKEN}"
    print(f"Demo Studio is open in your browser.\nIf it didn't open, visit: {url}\nKeep this window open while you use it. Press Ctrl+C to quit.", flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
