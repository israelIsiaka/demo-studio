# Demo Studio

Narrated product demo videos in the owner's own cloned voice, generated entirely on their computer. Two ways in:

- **The app** (`demo_studio/`, Python): a local web page to record a voice, pick a demo package and create the MP4. For anyone, no Claude needed. Mac and Windows.
- **The Claude Code plugin** (`.claude-plugin/`, `skills/demo-video/`, `kit/`, Node): Claude explores a web app, records scenes with Playwright paced to the narration, saves a demo package and renders it.

Both meet at the **demo package** (format documented at the top of `demo_studio/render.py`): silent `video.mp4`, `music.wav`, effect WAVs, and `demo.json` with the script lines and each cue's time and slot length. Re-voicing never re-records: lines longer than their slot are sped up (at most 1.25x).

## Privacy rules (the point of the product)

- Voice cloning runs only locally (Chatterbox). Never add a cloud voice service, telemetry, or any upload of the sample or voiced clips.
- The app binds to 127.0.0.1 only, and every request needs the per-run token plus a local Host header (blocks other websites and DNS rebinding).
- Never run narration as a remote or cloud agent. The owner's sample lives at `~/Demo Studio/voice/sample.wav`; never copy it into this repo.

## Layout

```
demo_studio/__init__.py   paths: ~/Demo Studio/{voice,demos,videos,.clips} (override with DEMO_STUDIO_HOME)
demo_studio/voice.py      Chatterbox: load model (cuda > mps > cpu), clone from sample, voice lines, cache clips by hash
demo_studio/render.py     package -> MP4: fit clips to slots, duck music under speech, effects, limiter
demo_studio/app.py        local HTTP server + API; demo_studio/index.html is the whole UI
demo_studio/cli.py        `demo-studio` (app), `demo-studio speak`, `demo-studio render <package>`
kit/studio.mjs            recording kit used by demo scripts (calls the Python CLI via `uv run --project`)
kit/sound.mjs             synthesised music bed and effects
kit/examples/             minimal.mjs (one scene; also CI) and tinc.mjs (full demo of the owner's TInC Virtual Quiz app)
skills/demo-video/        what Claude follows when a user asks the plugin for a demo
tests/check.py            the end-to-end check (access control, voice upload, zip import, real render)
```

## Commands

```sh
uv run demo-studio                       # open the app (Ctrl+C to quit)
uv run python tests/check.py             # end-to-end check, temporary home folder, ~5 min on an M1
node kit/examples/minimal.mjs            # kit end to end (needs npm install --prefix kit and a Chromium for playwright-core)
uv run demo-studio render "<package>"    # re-mix a package; cached clips make this seconds
```

`demo-studio` is also installed as a command (`uv tool install --editable .`), so edits here apply immediately.

## Decisions and why

- **Chatterbox 0.1.7 (Resemble AI, MIT)**: commercial use is fine. F5-TTS and XTTS were rejected for non-commercial licences. It listens to only the first 10 s of the sample, so the app asks for 10 to 20 s and trims silence.
- **Python app + uv**: users install one tool (uv) and run one `uvx` line; uv fetches Python 3.11 and torch. No Electron, no bundled installers.
- **`setuptools<81` pin**: resemble-perth (Chatterbox's watermarker) imports `pkg_resources`; without it the model fails with `'NoneType' object is not callable`.
- **Model load is cache-first** (`try_to_load_from_cache`): no network once downloaded.
- **Mix levels** (`VOICE_GAIN 2.3`): clips are normalised to -20 LUFS, tuned so a render matches the original TInC video (about -14 LUFS overall, speech about 10 dB over the music gaps).

## Known state (2026-09-17)

- Verified on the owner's M1 (16 GB): the TInC package re-voiced in their voice. Model load 20 s, learning the voice 45 s, the first two lines 1.5 to 3 min (warm-up), then 18 to 46 s per line.
- Windows is untested: CI (`.github/workflows/check.yml`, run manually) covers macos-14 and windows-latest. Windows uses CPU torch; CUDA wheels would need the PyTorch index.

## Open work

- Benchmark CPU against MPS on the M1; Chatterbox may be faster on CPU there. Consider Chatterbox Turbo for speed.
- Decide public or private before sharing; the README's install line needs a public repo.
- `kit/examples/tinc.mjs` contains the TInC seed accounts (such as `admin@tinc.test`). Remove or replace it before going public if those are used anywhere real.
- The plugin flow (`skills/demo-video`) has not been run end to end by a fresh Claude session yet.
