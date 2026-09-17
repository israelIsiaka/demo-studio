---
name: demo-video
description: Make a narrated product demo video of the user's web app in their own voice, generated on their computer with Demo Studio. Use when the user asks for a product demo, demo video, walkthrough, explainer or promo video of their app, or for narration in their voice.
---

# Demo video in the user's voice

Demo Studio records the real app in headless browsers, paces every scene to its narration, and narrates it in the user's cloned voice. It saves a **demo package** (silent video, music, sound effects, script and timing) and renders the MP4 from it. Anyone can later put their own voice on the same package in the Demo Studio app.

Plugin folder: `${CLAUDE_PLUGIN_ROOT}`. Read `kit/studio.mjs` (the API) and both examples before writing a demo: `kit/examples/minimal.mjs` (one scene) and `kit/examples/tinc.mjs` (a full demo with seeded data, several pages at once and simulated users).

## Privacy rules (never break these)

- The voice sample is `~/Demo Studio/voice/sample.wav` (Windows: `%USERPROFILE%\Demo Studio\voice\sample.wav`). Never copy it, upload it, commit it, or send it or any voiced clip to a voice service (ElevenLabs, Higgsfield or similar), an artifact, a doc or a cloud drive.
- Voicing runs only on this computer. Never run the narration or render step in a remote or cloud agent.
- The finished MP4 and the demo package (which holds no voice) are the user's to share.

## 1. Setup (once per computer)

Check `uv --version` and `node --version` (Node 20+). If uv is missing, ask before installing it: Mac/Linux `curl -LsSf https://astral.sh/uv/install.sh | sh`, Windows `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`.

Then, unless `${CLAUDE_PLUGIN_ROOT}/kit/node_modules` already exists:

```sh
npm install --prefix "${CLAUDE_PLUGIN_ROOT}/kit"
npx --prefix "${CLAUDE_PLUGIN_ROOT}/kit" playwright-core install chromium
uv run --project "${CLAUDE_PLUGIN_ROOT}" demo-studio --help
```

The last command installs the voice engine (about 1 GB, first time only). The first narration also downloads the voice model (about 3 GB).

## 2. The user's voice

If the voice sample doesn't exist, ask whether they want to record it now or draft with the built-in voice and record later (re-rendering later only re-voices, it doesn't re-record).
To record: run `uv run --project "${CLAUDE_PLUGIN_ROOT}" demo-studio` in the background. It opens the app in their browser; they complete step 1 (**Your voice**) and tell you. Then stop it.

## 3. Plan with the user before recording

1. Learn the app: README, routes/pages, how to run it locally, seed data, test accounts.
2. Propose a title card, 4 to 7 scenes and an outro, each with its narration line: one idea per scene, under about 30 words, written the way it should be spoken (spell out symbols and awkward acronyms). Aim for 60 to 120 seconds in total.
3. Get the user's OK on the scenes and wording before writing code.

## 4. Build

- Work in a build folder outside the user's repo (the session scratchpad is right). Put `demo.mjs` there and `npm install` any app-specific packages it needs there too.
- Import the kit by file URL so it works on Windows too:
  ```js
  import { pathToFileURL } from 'node:url';
  const { createStudio, glide, pointTo, tap, type, sleep, log, run } = await import(pathToFileURL(String.raw`${CLAUDE_PLUGIN_ROOT}/kit/studio.mjs`).href);
  ```
- Run the app in isolation: a throwaway database, seeded demo data, a fixed free port. Never record against production or the user's real data.
- `createStudio({ title, brand })` takes the app's colours and logo SVG. `narrate(lines)` must run before any scene. Inside `record()`, `say(key)` returns when the line ends: pace clicks and scrolls with `until()` so the screen shows what the narrator is saying.
- Drive the real UI with Playwright locators (roles and labels). Simulate other users through the app's API or sockets.
- Layouts: `composeFramed` (desktop, track key `main`), `composePhone` (key `phone`), `composeSplit` (keys `top`, `bottom`, `phoneA`, `phoneB`), `composeCard` (title and outro).
- End with `studio.finish()` inside `try`, and `studio.close()` in `finally`.

Run with `node demo.mjs`. It takes several minutes. The package goes to `~/Demo Studio/demos/<title>/` and the video to `~/Demo Studio/videos/`.

## 5. Check before showing the user

Extract a frame from the middle of each scene with ffmpeg (`${CLAUDE_PLUGIN_ROOT}/kit/node_modules/ffmpeg-static`) and look at each one: nothing cut off, no loading spinners, no error states, text readable. Fix and re-run; unchanged lines are not re-voiced.

## 6. Hand over

Give the video's path. Explain that to let someone else put their voice on it, they zip the package folder and send it; the other person opens Demo Studio (see the plugin's README) and adds it with **Add a demo (.zip)**.

## Tuning

- A bad take of one line: change its wording slightly, or delete the matching clip in `~/Demo Studio/.clips` (clips are named by a hash; delete them all to re-voice everything).
- Delivery: `DEMO_STUDIO_EXAGGERATION` (0.25 flat to 0.7 animated, default 0.5) and `DEMO_STUDIO_CFG` (0.3 slower and more deliberate, default 0.5).
