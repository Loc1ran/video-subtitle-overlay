import os
import sys
import torch
import torch.nn.functional as F
import whisper
import whisper.model

# Fix for Whisper tiny/base:
# RuntimeError: cannot reshape tensor of 0 elements into shape [1, 0, 6, -1] because the unspecified dimension size -1 can be any value and is ambiguous
def _safe_qkv_attention(self, q, k, v, mask=None):
    n_batch, n_ctx, n_state = q.shape
    d_head = n_state // self.n_head
    scale = d_head ** -0.25
    
    if n_ctx == 0:
        return torch.zeros(n_batch, 0, n_state, dtype=q.dtype, device=q.device), None

    q = q.view(*q.shape[:2], self.n_head, d_head).permute(0, 2, 1, 3)
    k = k.view(*k.shape[:2], self.n_head, d_head).permute(0, 2, 1, 3)
    v = v.view(*v.shape[:2], self.n_head, d_head).permute(0, 2, 1, 3)

    if whisper.model.SDPA_AVAILABLE and self.use_sdpa:
        a = whisper.model.scaled_dot_product_attention(
            q, k, v, is_causal=mask is not None and n_ctx > 1
        )
        out = a.permute(0, 2, 1, 3).flatten(start_dim=2)
        qk = None
    else:
        qk = (q * scale) @ (k * scale).transpose(-1, -2)
        if mask is not None:
            qk = qk + mask[:n_ctx, :n_ctx]
        qk = qk.float()
        w = F.softmax(qk, dim=-1).to(q.dtype)
        out = (w @ v).permute(0, 2, 1, 3).flatten(start_dim=2)
        qk = qk.detach()

    return out, qk

whisper.model.MultiHeadAttention.qkv_attention = _safe_qkv_attention


class SafeStream:
    def __init__(self, orig):
        self.orig = orig
    def write(self, text):
        try:
            if self.orig:
                self.orig.write(text)
        except Exception:
            pass
    def flush(self):
        try:
            if self.orig:
                self.orig.flush()
        except Exception:
            pass
    def isatty(self):
        return False
    def __getattr__(self, name):
        return getattr(self.orig, name)

if not isinstance(sys.stdout, SafeStream):
    sys.stdout = SafeStream(sys.stdout)
if not isinstance(sys.stderr, SafeStream):
    sys.stderr = SafeStream(sys.stderr)

_loaded_models = {}

def get_whisper_model(model_size="base"):
    global _loaded_models
    if model_size not in _loaded_models:
        print(f"Loading Whisper model '{model_size}'...")
        _loaded_models[model_size] = whisper.load_model(model_size, device="cpu")
    return _loaded_models[model_size]

def transcribe_video(video_path: str, model_size: str = "base", language: str = None, task: str = "transcribe") -> dict:
    clean_path = os.path.abspath(video_path)
    if not os.path.exists(clean_path):
        raise FileNotFoundError(f"Video file not found: {clean_path}")
    
    model = get_whisper_model(model_size)
    
    # Options to ensure 100% deterministic results, prevent hallucination loops, and filter silence
    options = {
        "task": task,
        "verbose": None,
        "fp16": False,
        "temperature": 0.0,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.6
    }
    if language and language.strip() and language.lower() != "auto":
        options["language"] = language.strip().lower()
        
    print(f"Starting Whisper transcription for {clean_path} with model '{model_size}'...")
    result = model.transcribe(clean_path, **options)
    
    raw_segments = result.get("segments", [])
    filtered_segments = []
    prev_text = None
    
    for seg in raw_segments:
        text = seg.get("text", "").strip()
        if not text:
            continue
            
        start = round(seg["start"], 2)
        end = round(seg["end"], 2)
        dur = end - start
        
        # Anti-hallucination loop filter:
        # If Whisper hallucinates repeating the exact same short token (< 6 chars)
        # during music/silence in consecutive micro-segments (dur <= 1.2s), merge or skip it
        if text == prev_text and len(text) <= 6 and dur <= 1.2:
            if filtered_segments:
                # Extend the existing segment's end time instead of creating duplicate line
                filtered_segments[-1]["end"] = max(filtered_segments[-1]["end"], end)
            continue
            
        prev_text = text
        filtered_segments.append({
            "id": len(filtered_segments) + 1,
            "start": start,
            "end": end,
            "text": text,
            "custom_text": text
        })
        
    detected_lang = result.get("language", "auto")
    
    return {
        "language": detected_lang,
        "segments": filtered_segments,
        "full_text": result.get("text", "").strip()
    }
