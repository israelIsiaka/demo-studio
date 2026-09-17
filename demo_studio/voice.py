"""Speaks script lines in a cloned voice with Chatterbox. Runs on this computer only: the voice sample is
read from disk, and after the one-time model download nothing touches the network."""
import hashlib
import os
import tempfile
from pathlib import Path

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"  # before anything imports huggingface_hub

from . import HOME

CLIPS = HOME / ".clips"
# Tuning knobs: exaggeration 0.25-0.7 (flat to animated), cfg 0.3-0.5 (lower = slower, more deliberate pacing).
EXAGGERATION = float(os.environ.get("DEMO_STUDIO_EXAGGERATION", 0.5))
CFG = float(os.environ.get("DEMO_STUDIO_CFG", 0.5))
SPEECH_LUFS = -20.0

_model = None
_builtin = None


def load(on_step=print):
    """Loads the model once per process; the first run downloads it (about 3 GB)."""
    global _model, _builtin
    if _model is None:
        import torch
        from chatterbox.tts import REPO_ID, ChatterboxTTS
        from huggingface_hub import snapshot_download

        # ponytail: Windows gets the CPU unless a CUDA build of torch is installed; slow but works.
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        try:
            _model = ChatterboxTTS.from_local(snapshot_download(REPO_ID, local_files_only=True), device)
        except Exception:
            on_step("Downloading the voice model (first time only, about 3 GB)")
            _model = ChatterboxTTS.from_pretrained(device)
        _builtin = _model.conds
    return _model


def speak(lines, sample=None, on_step=print):
    """Voices {key: text}. Returns {key: {"file", "seconds"}}. Clips are cached by line, sample and settings,
    so re-running only voices lines that changed. With no sample, Chatterbox's built-in voice is used."""
    import soundfile

    identity = Path(sample).read_bytes() if sample else b"built-in voice"
    salt = hashlib.sha256(identity + f"{EXAGGERATION}/{CFG}".encode()).hexdigest()
    clips = {key: CLIPS / f"{hashlib.sha256((salt + text).encode()).hexdigest()[:20]}.wav" for key, text in lines.items()}
    todo = [key for key, file in clips.items() if not file.exists()]
    if todo:
        import librosa
        import pyloudnorm

        model = load(on_step)
        on_step("Learning the voice")
        if sample:
            # Chatterbox listens to only the first 10 s, so cut silence off both ends first.
            speech, rate = librosa.load(sample, sr=None)
            with tempfile.TemporaryDirectory() as tmp:
                trimmed = Path(tmp) / "sample.wav"
                soundfile.write(trimmed, librosa.effects.trim(speech, top_db=35)[0], rate)
                model.prepare_conditionals(str(trimmed), exaggeration=EXAGGERATION)
        else:
            model.conds = _builtin
        CLIPS.mkdir(parents=True, exist_ok=True)
        meter = pyloudnorm.Meter(model.sr)
        for n, key in enumerate(todo, 1):
            on_step(f"Narrating line {n} of {len(todo)}")
            wav = model.generate(lines[key], exaggeration=EXAGGERATION, cfg_weight=CFG).squeeze(0).numpy()
            loudness = meter.integrated_loudness(wav)
            if loudness > -70:  # -inf for near-silent or very short clips
                wav = pyloudnorm.normalize.loudness(wav, loudness, SPEECH_LUFS)
            wav = wav.clip(-0.99, 0.99)
            partial = clips[key].with_suffix(".part.wav")
            soundfile.write(partial, wav, model.sr)
            partial.replace(clips[key])
    return {key: {"file": str(file), "seconds": soundfile.info(file).duration} for key, file in clips.items()}


def forget():
    """Deletes every clip voiced so far (the sample itself is deleted by the caller)."""
    for clip in CLIPS.glob("*.wav"):
        clip.unlink()
