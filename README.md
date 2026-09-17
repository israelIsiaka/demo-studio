# Demo Studio

Put your own voice on product demo videos. Everything, including your voice, stays on your computer.

- **The app** (Mac or Windows): record your voice once, pick a demo, click **Create video**.
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

1. **Your voice:** press **Record** and read the passage aloud for 10 to 20 seconds, or choose a recording you already have.
2. **Choose a demo:** pick one, or add a demo package (.zip) someone sent you.
3. **Create video.** When it's ready, press **Play video** or **Show in folder**.

The first time takes longer: Demo Studio downloads about 1 GB of software and, on the first video, its voice model (about 3 GB). After that it works offline.

Everything is kept in a **Demo Studio** folder in your home folder: `voice`, `demos` and `videos`.

## Make demos of your own app (Claude Code)

In Claude Code, run:

```
/plugin marketplace add israelIsiaka/demo-studio
/plugin install demo-studio@demo-studio
```

Then open your project and ask: *"Make a demo video of this app in my voice."* Claude plans the scenes with you, records the real app, and saves both the video and a demo package others can put their own voice on.

The plugin also needs [Node.js](https://nodejs.org) 20 or newer.

## Share a demo

Demo packages are folders in `Demo Studio/demos`. To share one, compress the folder to a .zip (Mac: right-click, **Compress**; Windows: right-click, **Send to > Compressed (zipped) folder**) and send it. The other person adds it in the app with **Add a demo (.zip)** and creates the video in their own voice.

## Privacy

- The app only answers to your own computer, through a private link it opens for you.
- Your recording is saved as `Demo Studio/voice/sample.wav` and is never uploaded. **Delete my voice** removes it and every line voiced with it.
- The voice model is [Chatterbox](https://github.com/resemble-ai/chatterbox) by Resemble AI (MIT license). It is downloaded once from Hugging Face; nothing is sent back.
- Speech made by Chatterbox carries an inaudible watermark that marks it as AI-generated.
- Only clone voices you have permission to use.

## Requirements

- A Mac with Apple Silicon (M1 or newer), or a Windows 10 or 11 PC
- 8 GB of memory (16 GB recommended) and 6 GB of free space
- On Windows, voices are made on the processor, which is slower than on a Mac.
