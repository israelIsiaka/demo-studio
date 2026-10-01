# Demo Studio

Narrated product demo videos in the owner's own cloned voice, generated entirely on their computer. Two ways in:

- **The app** (`demo_studio/`, Python): a local web page to record a voice, pick a demo package and create the MP4. For anyone, no Claude needed. Mac and Windows.
- **The Claude Code plugin** (`.claude-plugin/`, `skills/demo-video/`, `kit/`, Node): Claude explores a web app, records scenes with Playwright paced to the narration, saves a demo package and renders it.

Both meet at the **demo package** (format documented at the top of `demo_studio/render.py`): silent `video.mp4`, `music.wav`, effect WAVs, and `demo.json` with the script lines and each cue's time and slot length. Re-voicing never re-records: lines longer than their slot are sped up (at most 1.25x).

## Privacy rules (the point of the product)

- Voice cloning runs only locally (VoxCPM). Never add a cloud voice service, telemetry, or any upload of the recordings or voiced clips.
- The app binds to 127.0.0.1 only, and every request needs the per-run token plus a local Host header (blocks other websites and DNS rebinding).
- Never run narration as a remote or cloud agent. The owner's recordings live in `~/Demo Studio/voice/` (`sample.wav` plus a take per tone); never copy them into this repo.

## Layout

```
demo_studio/__init__.py   paths: ~/Demo Studio/{voice,demos,videos,.clips,settings.json} (override with DEMO_STUDIO_HOME)
demo_studio/voice.py      VoxCPM + Whisper: tones (takes), prompt from the recording, voice lines with word check/retakes, clip cache
demo_studio/render.py     package -> MP4: fit clips to slots, duck music under speech, effects, limiter
demo_studio/app.py        local HTTP server + API (voice/tone takes, tone choice, preview and video jobs, zip import)
demo_studio/index.html    the whole UI: monochrome black and white, follows system light/dark, no external assets
demo_studio/cli.py        `demo-studio` (app), `demo-studio speak`, `demo-studio render <package>` (both take `--tone`)
kit/studio.mjs            recording kit used by demo scripts (calls the Python CLI via `uv run --project`)
kit/sound.mjs             synthesised music bed and effects
tools/build-ffmpeg.sh     the LGPL-only FFmpeg the app ships (.github/workflows/ffmpeg.yml builds it for mac + windows)
kit/examples/             minimal.mjs (one scene; also CI) and tinc.mjs (full demo of the owner's TInC Virtual Quiz app)
skills/demo-video/        what Claude follows when a user asks the plugin for a demo
tests/check.py            the end-to-end check (access control, voice and tone takes, preview, zip import, real render)
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

- **VoxCPM 1.5 (OpenBMB, Apache-2.0)**, after Chatterbox 0.1.7 lost the owner's African-English accent. Sweep on their voice (scored with the CommonAccent ECAPA embedding; the recording's own halves score 0.844): Chatterbox default (exaggeration 0.5) 0.51 to 0.61, its best (cfg 0.3, exaggeration 0.25) 0.75; VoxCPM cfg 2.0 0.83. The owner picked VoxCPM in a blind A/B, twice. F5-TTS and XTTS were rejected earlier for non-commercial licences.
- **VoxCPM continues the recording**: the prompt is whole sentences from its first 15 s plus a Whisper transcript. It sometimes adds a lead-in word ("and then"); each line is transcribed (Whisper small.en, word timings), extra words at either end are trimmed, and lines with word error over 0.25 are retaken (best of 3).
- **Tones are takes, not settings**: VoxCPM copies pace, mood and accent from the recording, and Chatterbox's exaggeration knob was what destroyed the accent. So Calm/Friendly/Energetic are separate recordings (`voice/<tone>.wav`), falling back to the main one.
- **`torch==2.8.*`**: torchaudio 2.9+ loads audio through torchcodec, which needs system FFmpeg. **`PYTORCH_JIT=0`**: VoxCPM's scripted AudioVAE fails with "Unknown device for graph fuser" on MPS.
- **Built-in narrator**: without a recording, VoxCPM picks a random voice per line, so one narrator clip is generated once (seed 7) and used as the prompt.
- **Python app + uv**: users install one tool (uv) and run one `uvx` line; uv fetches Python 3.11 and torch. No Electron, no bundled installers.
- **Model load is cache-first** (`local_files_only`, falling back to a download only on `LocalEntryNotFoundError`): no network once downloaded.
- **Mix levels** (`VOICE_GAIN 2.3`): clips are normalised to -20 LUFS, tuned so a render matches the original TInC video (about -14 LUFS overall, speech about 10 dB over the music gaps).

- **We build our own FFmpeg** (`tools/build-ffmpeg.sh`). imageio-ffmpeg ships `--enable-gpl --enable-libx264`, and the kit's npm `ffmpeg-static` adds `--enable-nonfree`, which FFmpeg says may not be redistributed at all - fine to run locally, impossible to put in an installer. The app never re-encodes video (`-c:v copy`) and only encodes AAC, so it needs nothing GPL: the build is `--disable-gpl --disable-nonfree` with just the filters in `render.py`, 14 MB, and the script refuses to finish if any of those flags reappear. Decoders stay broad because the voice page accepts uploaded recordings. `render.py` takes `$DEMO_STUDIO_FFMPEG` if set, then `~/Demo Studio/bin/ffmpeg`, then imageio-ffmpeg.

## Known state (2026-09-17)

- The Chatterbox version was verified end to end on the owner's M1 (16 GB). VoxCPM: about 21 to 36 s per line on the M1 before the word check.
- Windows (2026-10-01): not yet confirmed on a real PC, but `installer.yml` installs DemoStudio-Setup.exe on a runner with long paths off and a bare PATH, then records, previews and renders with the shipped ffmpeg (an 8 s video in about 80 to 110 s on CPU). It publishes only if that passes. On the CPU, voices run in float32: VoxCPM's bfloat16 crashed one runner with "Illegal instruction". The launcher logs to `demo-studio.log` and the install to `setup.log` in `%LOCALAPPDATA%\Programs\Demo Studio`.

## Open work

- Windows: VoxCPM on CPU speed is unknown; CUDA torch wheels would need the PyTorch index.
- The owner's current recording has conversation after the passage; a clean re-recording should improve the clone further.
- Decide public or private before sharing; the README's install line needs a public repo.
- `kit/examples/tinc.mjs` contains the TInC seed accounts (such as `admin@tinc.test`). Remove or replace it before going public if those are used anywhere real.
- The plugin flow (`skills/demo-video`) has not been run end to end by a fresh Claude session yet.
