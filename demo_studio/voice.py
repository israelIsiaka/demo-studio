"""Speaks script lines in the owner's cloned voice with VoxCPM 1.5 (OpenBMB, Apache-2.0). Runs on this computer
only: recordings are read from disk, and after the one-time model downloads nothing touches the network."""
import hashlib
import json
import os
import re
from pathlib import Path

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"  # before anything imports huggingface_hub
os.environ.setdefault("PYTORCH_JIT", "0")  # VoxCPM's scripted audio decoder can't be fused on Apple GPUs

from . import HOME, SAMPLE, SETTINGS, VOICE

CLIPS = HOME / ".clips"
MODEL = "openbmb/VoxCPM1.5"
WHISPER = "small.en"
ENGINE = f"{MODEL}/cfg2.0/check-v1"  # part of every clip's cache key: change it to re-voice everything
CFG = 2.0
SPEECH_LUFS = -20.0
PROMPT_SECONDS = 15
DEVICE = os.environ.get("DEMO_STUDIO_DEVICE") or None  # None picks the GPU when there is one; CI's macOS runners need "cpu"
# ponytail: retake a line whose heard words differ this much from the script; accents make speech-to-text imperfect,
# so this only catches real failures (missing or invented phrases), not every misheard word.
MAX_WORD_ERROR, TAKES = 0.25, 3
NARRATOR = "Hi, let me show you how this works. Everything you need is right here, on one screen."

# VoxCPM copies how the recording sounds: accent, pace and mood. Measured on an African-English voice (2026-09-17),
# cfg 2.0 scored 0.83 accent similarity against the recording's own 0.84 (Chatterbox's best was 0.75), and the
# owner preferred it blind. So a tone is simply a take recorded in that tone.
TONES = {
    "main": {"label": "My recording", "hint": "The way you read in step 1."},
    "calm": {"label": "Calm", "hint": "Read slowly and reassuringly, like guiding a friend through it."},
    "friendly": {"label": "Friendly", "hint": "Read relaxed and warm, like showing a colleague."},
    "energetic": {"label": "Energetic", "hint": "Read upbeat and lively, like presenting on stage."},
}
DEFAULT_TONE = "main"

_model = None
_asr = None


def saved_tone():
    try:
        tone = json.loads(SETTINGS.read_text(encoding="utf-8"))["tone"]
    except (OSError, ValueError, KeyError, TypeError):
        return DEFAULT_TONE
    return tone if tone in TONES else DEFAULT_TONE


def save_tone(tone):
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps({"tone": tone}), encoding="utf-8")


def take(tone):
    """Where a tone's recording lives (it may not exist)."""
    return SAMPLE if tone == "main" else VOICE / f"{tone}.wav"


def sample_for(tone):
    """The recording a tone speaks from: its own take, else the main recording, else None (built-in narrator)."""
    return next((path for path in (take(tone), SAMPLE) if path.exists()), None)


def load(on_step=print):
    """Loads VoxCPM and the speech-to-text model once per process; the first run downloads both (about 2.5 GB)."""
    global _model, _asr
    if _model is None:
        from faster_whisper import WhisperModel
        from huggingface_hub.errors import LocalEntryNotFoundError
        from voxcpm import VoxCPM
        from voxcpm.model import voxcpm as voxcpm_model

        # VoxCPM keeps the checkpoint's bfloat16 on the CPU. Many PCs lack the instructions for it, and Python then
        # dies with "Illegal instruction" and no message (seen on a GitHub Windows runner, 2026-10-01). float32 runs
        # on every CPU; Apple GPUs already get it from VoxCPM.
        pick = voxcpm_model.pick_runtime_dtype
        voxcpm_model.pick_runtime_dtype = lambda device, dtype: "float32" if device == "cpu" else pick(device, dtype)

        def cached_first(make):
            try:
                return make(True)
            except LocalEntryNotFoundError:
                on_step("Downloading the voice models (first time only, about 2.5 GB)")
                return make(False)

        _asr = cached_first(lambda local: WhisperModel(WHISPER, device="cpu", compute_type="int8", local_files_only=local))
        on_step("Loading the voice model")
        _model = cached_first(lambda local: VoxCPM.from_pretrained(MODEL, load_denoiser=False, optimize=False, local_files_only=local, device=DEVICE))
    return _model


def _words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def _word_error(ref, heard):
    d = list(range(len(heard) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[:], i
        for j, h in enumerate(heard, 1):
            d[j] = min(prev[j] + 1, d[j - 1] + 1, prev[j - 1] + (r != h))
    return d[-1] / max(len(ref), 1)


def _listen(wav, rate):
    """Speech-to-text with word timings: [(word, start, end)]."""
    import librosa

    audio = librosa.resample(wav, orig_sr=rate, target_sr=16000) if rate != 16000 else wav
    segments, _ = _asr.transcribe(audio, language="en", beam_size=5, word_timestamps=True)
    return [(word, w.start, w.end) for s in segments for w in s.words for word in _words(w.word)]


def _prompt(sample, on_step):
    """The recording as VoxCPM's prompt: whole sentences from the first ~15 s of speech, and their transcript."""
    import librosa
    import soundfile

    digest = hashlib.sha256(sample.read_bytes()).hexdigest()[:20]
    audio_file, text_file = CLIPS / f"prompt-{digest}.wav", CLIPS / f"prompt-{digest}.txt"
    if not text_file.exists():
        on_step("Learning the voice")
        speech, rate = librosa.load(sample, sr=None)
        speech = librosa.effects.trim(speech, top_db=35)[0]
        segments, _ = _asr.transcribe(librosa.resample(speech, orig_sr=rate, target_sr=16000), language="en", beam_size=5, word_timestamps=True)
        words = [w for s in segments for w in s.words]
        if not words:
            raise RuntimeError("No speech was found in the voice recording. Record it again.")
        # End on a sentence that finishes within the limit, so VoxCPM doesn't continue a half-finished thought.
        fits = [i for i, w in enumerate(words) if w.end <= PROMPT_SECONDS] or [0]
        last = max((i for i in fits if re.search(r"[.!?]\s*$", words[i].word)), default=fits[-1])
        CLIPS.mkdir(parents=True, exist_ok=True)
        soundfile.write(audio_file, speech[: int((words[last].end + 0.15) * rate)], rate)
        text_file.write_text("".join(w.word for w in words[: last + 1]).strip(), encoding="utf-8")
    return str(audio_file), text_file.read_text(encoding="utf-8")


def _narrator(model, on_step):
    """With no recording, one generated narrator voice, made once, so every line sounds like the same person."""
    import soundfile
    import torch

    file = CLIPS / "narrator.wav"
    if not file.exists():
        on_step("Creating the built-in narrator voice")
        torch.manual_seed(7)
        CLIPS.mkdir(parents=True, exist_ok=True)
        soundfile.write(file, model.generate(text=NARRATOR, cfg_value=CFG, inference_timesteps=10), model.tts_model.sample_rate)
    return file


def _voice_line(model, text, prompt):
    """Best of up to TAKES: retakes lines with missing or invented words, and trims words added before or after."""
    import numpy as np

    rate = model.tts_model.sample_rate
    ref, best = _words(text), None
    for _ in range(TAKES):
        wav = np.asarray(model.generate(text=text, prompt_wav_path=prompt[0], prompt_text=prompt[1], cfg_value=CFG, inference_timesteps=10), dtype=np.float32)
        heard = _listen(wav, rate)
        if heard and ref:
            # VoxCPM continues the recording and sometimes adds a lead-in ("and then...") or a tail: cut them off.
            first = next((i for i, (w, _, _) in enumerate(heard[:3]) if w == ref[0]), 0)
            last = next((i for i in range(len(heard) - 1, max(len(heard) - 4, first) - 1, -1) if heard[i][0] == ref[-1]), len(heard) - 1)
            start = int(max(heard[first][1] - 0.08, 0) * rate) if first else 0
            end = int((heard[last][2] + 0.25) * rate) if last < len(heard) - 1 else len(wav)
            wav, heard = wav[start:end], heard[first : last + 1]
        error = _word_error(ref, [w for w, _, _ in heard])
        if best is None or error < best[0]:
            best = (error, wav)
        if error <= MAX_WORD_ERROR:
            break
    return best[1]


def speak(lines, tone=DEFAULT_TONE, on_step=print):
    """Voices {key: text} in a tone. Returns {key: {"file", "seconds"}}. Clips are cached by line, recording and
    engine, so re-running only voices what changed. With no recording, a built-in narrator voice is used."""
    import soundfile

    sample = sample_for(tone)
    identity = sample.read_bytes() if sample else b"built-in narrator"
    salt = hashlib.sha256(identity + ENGINE.encode()).hexdigest()
    clips = {key: CLIPS / f"{hashlib.sha256((salt + text).encode()).hexdigest()[:20]}.wav" for key, text in lines.items()}
    todo = [key for key, file in clips.items() if not file.exists()]
    if todo:
        import pyloudnorm

        model = load(on_step)
        prompt = _prompt(sample or _narrator(model, on_step), on_step)
        meter = pyloudnorm.Meter(model.tts_model.sample_rate)
        for n, key in enumerate(todo, 1):
            on_step(f"Narrating line {n} of {len(todo)}")
            wav = _voice_line(model, lines[key], prompt)
            loudness = meter.integrated_loudness(wav) if len(wav) > model.tts_model.sample_rate // 2 else float("-inf")
            if loudness > -70:  # -inf for near-silent or very short clips
                wav = pyloudnorm.normalize.loudness(wav, loudness, SPEECH_LUFS)
            partial = clips[key].with_suffix(".part.wav")
            soundfile.write(partial, wav.clip(-0.99, 0.99), model.tts_model.sample_rate)
            partial.replace(clips[key])
    return {key: {"file": str(file), "seconds": soundfile.info(file).duration} for key, file in clips.items()}


def forget(tone=None):
    """Deletes one tone's take, or every recording plus everything voiced or learned from them."""
    if tone and tone != "main":
        take(tone).unlink(missing_ok=True)
        return
    for file in [*VOICE.glob("*.wav"), *CLIPS.glob("*")]:
        file.unlink()
