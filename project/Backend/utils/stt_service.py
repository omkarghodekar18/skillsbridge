"""
STT Service using Faster-Whisper (local, no Google/network dependency).

Quality defaults are tuned for interview-style speech.
Model size is controlled by WHISPER_MODEL (default: base.en).
    tiny.en   ~75 MB  — fastest, lowest accuracy
    base.en   ~145 MB — balanced CPU default
    small.en  ~461 MB — better accuracy, slower
    medium.en ~1.5 GB — high accuracy, much slower on CPU
"""
import os
import shutil
import subprocess
import tempfile
import threading

from faster_whisper import WhisperModel

_model: WhisperModel | None = None
_lock = threading.Lock()


def _prepare_audio_for_stt(input_path: str) -> str:
    """Convert input audio to mono 16kHz WAV and normalize levels for better STT."""
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        return input_path

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out_tmp:
        output_path = out_tmp.name

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        input_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        "highpass=f=80,lowpass=f=7600,dynaudnorm",
        output_path,
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return output_path
    except Exception as e:
        print(f"[STT] ffmpeg preprocess failed, using raw audio: {e}")
        try:
            os.remove(output_path)
        except OSError:
            pass
        return input_path


def _get_model() -> WhisperModel:
    """Lazy-load and cache the Whisper model (thread-safe)."""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                model_size = os.getenv("WHISPER_MODEL", "base.en")
                device = os.getenv("WHISPER_DEVICE", "cpu")
                compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
                # Use CPU with int8 quantisation for low memory usage.
                # Change to "cuda" if a GPU is available.
                print(
                    f"[STT] Loading Whisper model='{model_size}', device='{device}', compute_type='{compute_type}'"
                )
                _model = WhisperModel(
                    model_size,
                    device=device,
                    compute_type=compute_type,
                )
    return _model


def transcribe_audio(audio_bytes: bytes, suffix: str = ".webm") -> str:
    """
    Transcribe raw audio bytes using Faster-Whisper.

    Parameters
    ----------
    audio_bytes : bytes
        Raw audio data (WebM, OGG, WAV, MP4 — anything ffmpeg can decode).
    suffix : str
        File extension hint used when writing the temp file.

    Returns
    -------
    str
        Transcribed text, stripped of leading/trailing whitespace.
        Returns an empty string if no speech was detected.
    """
    model = _get_model()

    # Faster-Whisper requires a file path, not a buffer.
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    prepared_path = tmp_path

    try:
        prepared_path = _prepare_audio_for_stt(tmp_path)

        beam_size = int(os.getenv("WHISPER_BEAM_SIZE", "8"))
        best_of = int(os.getenv("WHISPER_BEST_OF", "5"))
        vad_filter = os.getenv("WHISPER_VAD_FILTER", "true").lower() == "true"
        vad_min_silence_ms = int(os.getenv("WHISPER_VAD_MIN_SILENCE_MS", "300"))
        no_speech_threshold = float(os.getenv("WHISPER_NO_SPEECH_THRESHOLD", "0.8"))
        log_prob_threshold = float(os.getenv("WHISPER_LOGPROB_THRESHOLD", "-2.0"))
        condition_on_previous_text = (
            os.getenv("WHISPER_CONDITION_ON_PREV_TEXT", "false").lower() == "true"
        )
        language = os.getenv("WHISPER_LANGUAGE", "en").strip() or None

        # Pass 1: quality-first decode with VAD.
        segments, info = model.transcribe(
            prepared_path,
            beam_size=beam_size,
            best_of=best_of,
            language=language,
            vad_filter=vad_filter,
            vad_parameters={"min_silence_duration_ms": vad_min_silence_ms},
            no_speech_threshold=no_speech_threshold,
            log_prob_threshold=log_prob_threshold,
            condition_on_previous_text=condition_on_previous_text,
            temperature=0,
        )

        seg_list = list(segments)
        text = " ".join(seg.text for seg in seg_list).strip()

        # Pass 2: recovery decode when pass 1 returns empty text.
        if not text:
            print("[STT] Empty transcript on pass 1; retrying without VAD and stricter filtering")
            retry_segments, retry_info = model.transcribe(
                prepared_path,
                beam_size=3,
                best_of=3,
                language=language,
                vad_filter=False,
                no_speech_threshold=1.0,
                log_prob_threshold=-3.0,
                condition_on_previous_text=False,
                temperature=[0.0, 0.2, 0.4],
            )
            retry_seg_list = list(retry_segments)
            retry_text = " ".join(seg.text for seg in retry_seg_list).strip()
            if retry_text:
                seg_list = retry_seg_list
                info = retry_info
                text = retry_text

        print(
            f"[STT] language={info.language}, prob={round(info.language_probability, 3)}, segments={len(seg_list)}"
        )
        print("Transcribed text : ", text)
        return text
    finally:
        if prepared_path != tmp_path:
            try:
                os.remove(prepared_path)
            except OSError:
                pass
        try:
            os.remove(tmp_path)
        except OSError:
            pass
