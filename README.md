# Demo Studio

Put your own voice on product demo videos. Everything, including your voice, stays on your computer.

- **The app** (Mac or Windows, runs in your browser): record your voice once, pick a tone and a demo, click **Create video**. Your accent comes through.
- **The Claude Code plugin**: ask Claude for a demo video of your web app. It explores the app, writes the script, records every scene from the real app and narrates it in your voice.

## Use the app

**1. Install uv** (one time). uv sets up everything else Demo Studio needs.

- Mac: open **Terminal** and paste:
  ```sh
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
- Windows: open **PowerShell** and paste:
  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```

Then close that window and open a new one.

**2. Open Demo Studio** (paste this whenever you want to use it):

```sh
uvx --from https://github.com/israelIsiaka/demo-studio/archive/refs/heads/main.zip demo-studio
```

It opens in your browser. Keep the Terminal or PowerShell window open while you use it.

**3. In the page:**

1. **Record your voice:** somewhere quiet with nobody else talking, press record and read the passage once, for 10 to 20 seconds. Or upload a recording you already have.
2. **Pick a tone:** your videos sound the way you read. For a calm, friendly or energetic version, read the passage again in that tone, then pick it. **Preview tone** plays a sample.
3. **Pick a demo:** choose one, or drop in a demo package (.zip) someone sent you.
4. **Create the video.** When it's ready, press **Play video** or **Show in folder**.

The first time takes longer: Demo Studio downloads about 1 GB of software and, on the first preview or video, its voice models (about 2.5 GB). After that it works offline.

Everything is kept in a **Demo Studio** folder in your home folder: `voice`, `demos` and `videos`.

Every narrated line is checked with speech-to-text. A line with missing or invented words is voiced again automatically.

## Make demos of your own app (Claude Code)

In Claude Code, run:

```
/plugin marketplace add israelIsiaka/demo-studio
/plugin install demo-studio@demo-studio
```

Then open your project and ask: *"Make a demo video of this app in my voice."* Claude plans the scenes with you, records the real app, and saves both the video and a demo package others can put their own voice on.

The plugin also needs [Node.js](https://nodejs.org) 20 or newer.

## Share a demo

Demo packages are folders in `Demo Studio/demos`. To share one, compress the folder to a .zip (Mac: right-click, **Compress**; Windows: right-click, **Send to > Compressed (zipped) folder**) and send it. The other person adds it in the app with **Add a demo package** and creates the video in their own voice.

## Privacy

- The app only answers to your own computer, through a private link it opens for you.
- Your recordings are saved in `Demo Studio/voice` and are never uploaded. **Delete voice** removes them and every line voiced with them.
- The voice model is [VoxCPM 1.5](https://github.com/OpenBMB/VoxCPM) by OpenBMB (Apache-2.0), and lines are checked with [Whisper](https://github.com/SYSTRAN/faster-whisper) (MIT). Both are downloaded once from Hugging Face; nothing is sent back.
- Only clone voices you have permission to use, and say when a video is narrated by a cloned voice where that matters.

## Requirements

- A Mac with Apple Silicon (M1 or newer), or a Windows 10 or 11 PC
- 8 GB of memory (16 GB recommended) and 6 GB of free space
- On Windows, voices are made on the processor, which is slower than on a Mac.

## Why VoxCPM

Demo Studio first used Chatterbox. On an African-English voice, Chatterbox drifted toward an American accent: its best settings scored 0.75 accent similarity to the real recording, while VoxCPM scored 0.83, against 0.84 for two halves of the same real recording. In a blind listening test the speaker picked VoxCPM both times.
