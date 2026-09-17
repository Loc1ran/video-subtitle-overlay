import time
from typing import List, Dict
from deep_translator import GoogleTranslator, MyMemoryTranslator

SUPPORTED_LANGUAGES = {
    "vi": "Vietnamese",
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
    "ja": "Japanese",
    "ko": "Korean",
    "ru": "Russian",
    "it": "Italian",
    "pt": "Portuguese",
    "ar": "Arabic",
    "hi": "Hindi",
    "th": "Thai",
    "id": "Indonesian",
    "tr": "Turkish"
}

MYMEMORY_LANG_MAP = {
    "en": "en-US",
    "vi": "vi-VN",
    "es": "es-ES",
    "fr": "fr-FR",
    "de": "de-DE",
    "zh": "zh-CN",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "ru": "ru-RU",
    "it": "it-IT",
    "pt": "pt-PT",
    "ar": "ar-SA",
    "hi": "hi-IN",
    "th": "th-TH",
    "id": "id-ID",
    "tr": "tr-TR"
}

_google_blocked_until = 0

def translate_chunk_block(texts: List[str], target_lang: str = "vi", source_lang: str = "auto") -> List[str]:
    """Translates a batch of lines together in one fast HTTP request."""
    global _google_blocked_until
    if not texts:
        return []
        
    combined = "\n".join([t.replace("\n", " ").strip() for t in texts])
    now = time.time()
    
    # Try Google Translator if not currently rate-limited
    if now > _google_blocked_until:
        try:
            trans = GoogleTranslator(source=source_lang, target=target_lang).translate(combined)
            lines = trans.split("\n")
            if len(lines) == len(texts):
                return [l.strip() for l in lines]
        except Exception as e:
            # Mark Google as temporarily blocked for 5 minutes
            _google_blocked_until = now + 300
            
    # Fast & Reliable Fallback: MyMemory batch
    try:
        src = MYMEMORY_LANG_MAP.get(source_lang, "auto")
        if src == "auto":
            sample = "".join(texts[:3])
            src = "zh-CN" if any("\u4e00" <= c <= "\u9fff" for c in sample) else "en-US"
            
        tgt = MYMEMORY_LANG_MAP.get(target_lang, "vi-VN")
        trans = MyMemoryTranslator(source=src, target=tgt).translate(combined)
        if trans and not trans.startswith("MYMEMORY WARNING"):
            clean_trans = trans.replace("&#10;", "\n").replace("&quot;", '"')
            lines = clean_trans.split("\n")
            if len(lines) == len(texts):
                return [l.strip() for l in lines]
            # If line count differed slightly, fallback to per-item in this small chunk
            results = []
            for t in texts:
                try:
                    res = MyMemoryTranslator(source=src, target=tgt).translate(t)
                    results.append(res if res and not res.startswith("MYMEMORY") else t)
                except Exception:
                    results.append(t)
            return results
    except Exception:
        pass
        
    return texts

def translate_segments(segments: List[Dict], target_lang: str = "vi", source_lang: str = "auto") -> List[Dict]:
    """
    Translates all segments across the whole video in fast, efficient chunks.
    """
    if not segments:
        return []
        
    chunk_size = 15
    raw_texts = [seg.get("text", "").strip() for seg in segments]
    translated_all = []
    
    for i in range(0, len(raw_texts), chunk_size):
        chunk = raw_texts[i:i + chunk_size]
        translated_chunk = translate_chunk_block(chunk, target_lang=target_lang, source_lang=source_lang)
        translated_all.extend(translated_chunk)
        time.sleep(0.1)

    result_segments = []
    for seg, trans in zip(segments, translated_all):
        updated = dict(seg)
        updated["custom_text"] = trans if trans else seg.get("text", "")
        result_segments.append(updated)

    return result_segments
