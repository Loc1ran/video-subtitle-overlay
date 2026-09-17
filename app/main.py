import os
import sys

# Windows SafeStream protection against [Errno 22] Invalid argument on detached stderr/stdout
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

import re
import json
import time
import uuid
import shutil
import traceback
from typing import List, Dict, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.transcriber import transcribe_video
from app.translator import translate_segments, SUPPORTED_LANGUAGES
from app.video_processor import get_video_info, generate_ass_file, generate_srt_content, burn_subtitles_to_video, get_reframe_dimensions
from app.video_ocr import detect_video_subtitle_regions, extract_subtitles_from_video_ocr, detect_video_subtitle_colors, get_contrast_text_color

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
EXPORTS_DIR = os.path.join(BASE_DIR, "exports")
STATIC_DIR = os.path.join(BASE_DIR, "app", "static")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(EXPORTS_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

app = FastAPI(title="Video Subtitle Overlay Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    err_str = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    print("SERVER EXCEPTION:", err_str)
    return JSONResponse(
        status_code=500,
        content={"success": False, "detail": str(exc), "traceback": err_str}
    )

FILES_DB = {}
EXTRACTION_PROGRESS: Dict[str, Dict] = {}

@app.get("/api/extraction-progress/{file_id}")
def get_extraction_progress(file_id: str):
    progress = EXTRACTION_PROGRESS.get(file_id, {
        "status": "idle",
        "percent": 0,
        "stage": "",
        "found_count": 0,
        "engine": ""
    })
    return {"success": True, "progress": progress}

def sanitize_filename(filename: str) -> str:
    """Strips paths and Windows illegal characters (\\ / : * ? \" < > |) to prevent [Errno 22]."""
    if not filename:
        return "video.mp4"
    base = os.path.basename(filename.replace("\\", "/"))
    clean = re.sub(r'[\\/*?:"<>|\x00-\x1f]', '_', base).strip(" .")
    return clean if clean else "video.mp4"

def get_file_info(file_id: str) -> Optional[Dict]:
    if file_id in FILES_DB:
        return FILES_DB[file_id]
        
    if os.path.exists(UPLOADS_DIR):
        for fname in os.listdir(UPLOADS_DIR):
            if fname.startswith(f"{file_id}_") and fname.lower().endswith(('.mp4', '.mkv', '.avi', '.mov', '.webm')):
                saved_path = os.path.join(UPLOADS_DIR, fname)
                info = get_video_info(saved_path)
                data = {
                    "file_id": file_id,
                    "original_name": fname[len(file_id) + 1:],
                    "saved_path": saved_path,
                    "filename": fname,
                    "info": info
                }
                FILES_DB[file_id] = data
                return data
    return None

class SegmentItem(BaseModel):
    id: int
    start: float
    end: float
    text: str
    custom_text: Optional[str] = ""
    x_pct: Optional[float] = None
    y_pct: Optional[float] = None
    anchor: Optional[str] = None
    track_id: Optional[int] = None
    text_color: Optional[str] = None
    outline_color: Optional[str] = None
    bg_color: Optional[str] = None
    box_w: Optional[int] = None
    box_h: Optional[int] = None

class AnalyzeRequest(BaseModel):
    file_id: str
    model_size: Optional[str] = "base"
    language: Optional[str] = "auto"
    task: Optional[str] = "transcribe"

class DetectRequest(BaseModel):
    file_id: str

class AutoProcessRequest(BaseModel):
    file_id: str
    target_lang: Optional[str] = "vi"
    model_size: Optional[str] = "base"
    audio_language: Optional[str] = "auto"
    transcript_source: Optional[str] = "video_ocr"  # "video_ocr" (extract on-screen text) or "audio_whisper"
    enable_ocr: Optional[bool] = True
    enable_transcribe: Optional[bool] = True
    translation_mode: Optional[str] = "none"  # "none", "ai_chat", "machine"

class ExtractVideoSubtitlesRequest(BaseModel):
    file_id: str
    sample_interval: Optional[float] = 0.25

class TranslateRequest(BaseModel):
    segments: List[SegmentItem]
    target_lang: str
    source_lang: Optional[str] = "auto"

class StyleConfig(BaseModel):
    font_name: Optional[str] = "Arial"
    font_size: Optional[int] = 26
    text_color: Optional[str] = "#FFFFFF"
    bg_color: Optional[str] = "#000000"
    bg_opacity: Optional[float] = 0.95
    bg_padding: Optional[int] = 12
    outline_color: Optional[str] = "#000000"
    outline_width: Optional[int] = 3
    mask_mode: Optional[str] = "box"
    border_radius: Optional[int] = 18
    pos_x_pct: Optional[float] = 50.0
    pos_y_pct: Optional[float] = 90.5
    bold: Optional[bool] = True

class RenderRequest(BaseModel):
    file_id: str
    segments: List[SegmentItem]
    style: StyleConfig
    reframe_target: Optional[str] = "original"
    reframe_mode: Optional[str] = "blur"

@app.get("/api/languages")
def get_languages():
    return SUPPORTED_LANGUAGES

@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    try:
        raw_name = file.filename or "video.mp4"
        safe_name = sanitize_filename(raw_name)
        
        file_id = str(uuid.uuid4())[:8]
        saved_filename = f"{file_id}_{safe_name}"
        saved_path = os.path.join(UPLOADS_DIR, saved_filename)
        
        with open(saved_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        info = get_video_info(saved_path)
        data = {
            "file_id": file_id,
            "original_name": safe_name,
            "saved_path": saved_path,
            "filename": saved_filename,
            "info": info
        }
        FILES_DB[file_id] = data
        
        return {
            "success": True,
            "file_id": file_id,
            "filename": safe_name,
            "info": info,
            "video_url": f"/api/video/{file_id}"
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "detail": f"Upload failed: {str(e)}"})

@app.get("/api/video/{file_id}")
def serve_uploaded_video(file_id: str):
    file_info = get_file_info(file_id)
    if not file_info or not os.path.exists(file_info["saved_path"]):
        raise HTTPException(status_code=404, detail="Video file not found")
    return FileResponse(file_info["saved_path"])

@app.post("/api/detect-subtitles")
def detect_subtitles(req: DetectRequest):
    file_info = get_file_info(req.file_id)
    if not file_info:
        return JSONResponse(status_code=404, content={"success": False, "detail": "File ID not recognized"})
        
    try:
        detection = detect_video_subtitle_regions(file_info["saved_path"])
        return {"success": True, "data": detection}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "detail": f"Subtitle detection failed: {str(e)}"})

@app.post("/api/extract-video-subtitles")
def extract_video_subtitles_endpoint(req: ExtractVideoSubtitlesRequest):
    file_info = get_file_info(req.file_id)
    if not file_info:
        return JSONResponse(status_code=404, content={"success": False, "detail": "File ID not recognized"})
    try:
        def on_ocr_progress(pct, stage, found):
            EXTRACTION_PROGRESS[req.file_id] = {
                "status": "running",
                "percent": pct,
                "stage": stage,
                "found_count": found,
                "engine": "Screen OCR"
            }
        EXTRACTION_PROGRESS[req.file_id] = {
            "status": "running",
            "percent": 2,
            "stage": "Initializing EasyOCR engine...",
            "found_count": 0,
            "engine": "Screen OCR"
        }
        data = extract_subtitles_from_video_ocr(file_info["saved_path"], sample_interval=req.sample_interval or 0.25, progress_callback=on_ocr_progress)
        
        # Automatically detect transcript colors from video frames
        color_info = detect_video_subtitle_colors(file_info["saved_path"], data.get("segments", []))
        data["color_info"] = color_info
        seg_colors = color_info.get("segment_colors", {})
        dominant_outline = color_info.get("dominant_outline", "#000000")
        dominant_text = color_info.get("dominant_text", "#FFFFFF")
        dominant_bg = color_info.get("dominant_bg", "#000000")
        for seg in data.get("segments", []):
            sid = seg.get("id")
            s_col = seg_colors.get(sid, {})
            is_diag = float(seg.get("y_pct", 86.5)) >= 70.0
            fallback_bg = dominant_bg if is_diag else color_info.get("dominant_title_accent", dominant_bg)
            seg["bg_color"] = s_col.get("bg_color") or fallback_bg
            seg["outline_color"] = s_col.get("outline_color") or (dominant_outline if is_diag else seg["bg_color"])
            seg["text_color"] = s_col.get("text_color") or (dominant_text if is_diag else get_contrast_text_color(seg["bg_color"]))

        raw_transcript_path = os.path.join(UPLOADS_DIR, f"{req.file_id}_transcript.json")
        with open(raw_transcript_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        EXTRACTION_PROGRESS[req.file_id] = {
            "status": "completed",
            "percent": 100,
            "stage": f"Complete: {len(data.get('segments', []))} subtitles detected (outline: {color_info.get('dominant_outline', '#000000')})",
            "found_count": len(data.get("segments", [])),
            "engine": "Screen OCR"
        }
        return {"success": True, "data": data, "color_info": color_info}
    except Exception as e:
        EXTRACTION_PROGRESS[req.file_id] = {
            "status": "error",
            "percent": 0,
            "stage": f"Extraction error: {str(e)}",
            "found_count": 0,
            "engine": "Screen OCR"
        }
        return JSONResponse(status_code=500, content={"success": False, "detail": f"Extraction failed: {str(e)}"})

@app.post("/api/auto-process")
def auto_process(req: AutoProcessRequest):
    file_info = get_file_info(req.file_id)
    if not file_info:
        return JSONResponse(status_code=404, content={"success": False, "detail": "File ID not recognized. Please re-upload the video."})
        
    video_path = file_info["saved_path"]
    source_mode = (req.transcript_source or "video_ocr").lower()
    engine_name = "Screen OCR (EasyOCR)" if source_mode == "video_ocr" else "Whisper ASR"

    EXTRACTION_PROGRESS[req.file_id] = {
        "status": "running",
        "percent": 2,
        "stage": f"Initializing {engine_name}...",
        "found_count": 0,
        "engine": engine_name
    }

    def on_ocr_progress(pct, stage, found):
        EXTRACTION_PROGRESS[req.file_id] = {
            "status": "running",
            "percent": pct,
            "stage": stage,
            "found_count": found,
            "engine": engine_name
        }
    
    try:
        if source_mode == "video_ocr":
            # Extract on-screen subtitles directly from video frames using OCR!
            ocr_data = extract_subtitles_from_video_ocr(video_path, progress_callback=on_ocr_progress)
            segments = ocr_data.get("segments", [])
            auto_y = ocr_data.get("detected_y_pct", 86.5)
            auto_x = ocr_data.get("detected_x_pct", 50.0)
            auto_font_size = ocr_data.get("recommended_font_size", 26)
            auto_padding = ocr_data.get("recommended_padding", 14)
            source_lang = "zh"
            ocr_result = {
                "has_subtitles": len(segments) > 0,
                "detected_y_pct": auto_y,
                "detected_x_pct": auto_x,
                "recommended_font_size": auto_font_size,
                "recommended_padding": auto_padding,
                "message": f"Extracted {len(segments)} on-screen subtitles from video at Y={auto_y}%."
            }
            trans_result = {
                "language": source_lang,
                "segments": segments,
                "detected_y_pct": auto_y,
                "source": "video_ocr"
            }
        else:
            # Fallback to audio speech transcription via Whisper
            if req.enable_ocr:
                EXTRACTION_PROGRESS[req.file_id] = {
                    "status": "running",
                    "percent": 15,
                    "stage": "Detecting subtitle regions...",
                    "found_count": 0,
                    "engine": engine_name
                }
                ocr_result = detect_video_subtitle_regions(video_path)
                auto_y = ocr_result.get("detected_y_pct", 88.0)
                auto_x = ocr_result.get("detected_x_pct", 50.0)
                auto_font_size = ocr_result.get("recommended_font_size", 26)
                auto_padding = ocr_result.get("recommended_padding", 12)
            else:
                ocr_result = {"detected_y_pct": 88.0, "detected_x_pct": 50.0, "detected_height_pct": 8.0}
                auto_y, auto_x, auto_font_size, auto_padding = 88.0, 50.0, 26, 12

            if req.enable_transcribe:
                EXTRACTION_PROGRESS[req.file_id] = {
                    "status": "running",
                    "percent": 40,
                    "stage": "Transcribing speech audio with Whisper...",
                    "found_count": 0,
                    "engine": engine_name
                }
                trans_result = transcribe_video(
                    video_path=video_path,
                    model_size=req.model_size or "base",
                    language=req.audio_language if req.audio_language != "auto" else None,
                    task="transcribe"
                )
                segments = trans_result.get("segments", [])
                source_lang = trans_result.get("language", "auto")
            else:
                trans_result = {"segments": [], "language": "auto"}
                segments = []
                source_lang = "auto"
        
        # Save raw transcript for AI Chat / MCP usage
        raw_transcript_path = os.path.join(UPLOADS_DIR, f"{req.file_id}_transcript.json")
        with open(raw_transcript_path, "w", encoding="utf-8") as f:
            json.dump(trans_result, f, ensure_ascii=False, indent=2)
        
        # 3. Translation Decision (User selects what they want from the start)
        translation_mode = (req.translation_mode or "none").lower()
        target_lang = req.target_lang or "vi"

        if translation_mode == "machine" and target_lang != "none":
            # Quick Google translate
            final_segments = translate_segments(segments, target_lang=target_lang, source_lang=source_lang)
        else:
            # DO NOT translate: keep original transcript verbatim in both text and custom_text!
            final_segments = []
            for seg in segments:
                item = dict(seg)
                item["custom_text"] = seg.get("text", "")
                final_segments.append(item)
        
        # Auto-detect transcript colors from video frames
        color_info = detect_video_subtitle_colors(video_path, final_segments)
        dominant_outline = color_info.get("dominant_outline", "#000000")
        dominant_text = color_info.get("dominant_text", "#FFFFFF")
        dominant_bg = color_info.get("dominant_bg", "#000000")
        seg_colors = color_info.get("segment_colors", {})
        for s in final_segments:
            sid = s.get("id")
            s_col = seg_colors.get(sid, {})
            is_diag = float(s.get("y_pct", 86.5)) >= 70.0
            fallback_bg = dominant_bg if is_diag else color_info.get("dominant_title_accent", dominant_bg)
            s["bg_color"] = s_col.get("bg_color") or fallback_bg
            s["outline_color"] = s_col.get("outline_color") or (dominant_outline if is_diag else s["bg_color"])
            s["text_color"] = s_col.get("text_color") or (dominant_text if is_diag else get_contrast_text_color(s["bg_color"]))

        auto_style = {
            "pos_x_pct": auto_x,
            "pos_y_pct": auto_y,
            "font_size": auto_font_size,
            "bg_padding": auto_padding,
            "border_radius": 18,
            "outline_color": color_info.get("dominant_outline", dominant_bg),
            "outline_width": 2 if color_info.get("has_accent") else 0,
            "bg_color": dominant_bg,
            "bg_opacity": 1.0,
            "text_color": dominant_text,
            "mask_mode": "box",
            "font_name": "Arial",
            "bold": True
        }
        
        # Save initial state
        state_path = os.path.join(UPLOADS_DIR, f"{req.file_id}_state.json")
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump({
                "file_id": req.file_id,
                "segments": final_segments,
                "style": auto_style
            }, f, ensure_ascii=False, indent=2)
            
        # If user chose AI Chat mode, queue it right away
        if translation_mode == "ai_chat":
            global CURRENT_AI_JOB
            CURRENT_AI_JOB = {
                "file_id": req.file_id,
                "target_lang": target_lang,
                "status": "queued",
                "segments": final_segments
            }
        
        EXTRACTION_PROGRESS[req.file_id] = {
            "status": "completed",
            "percent": 100,
            "stage": f"Complete: {len(final_segments)} subtitles extracted",
            "found_count": len(final_segments),
            "engine": engine_name
        }

        return {
            "success": True,
            "ocr_info": ocr_result,
            "auto_style": auto_style,
            "color_info": color_info,
            "detected_language": source_lang,
            "segments": final_segments,
            "translation_mode": translation_mode
        }
    except Exception as e:
        traceback.print_exc()
        EXTRACTION_PROGRESS[req.file_id] = {
            "status": "error",
            "percent": 0,
            "stage": f"Extraction error: {str(e)}",
            "found_count": 0,
            "engine": engine_name
        }
        return JSONResponse(status_code=500, content={"success": False, "detail": f"Auto-process failed: {str(e)}"})

@app.post("/api/analyze")
def analyze_video(req: AnalyzeRequest):
    file_info = get_file_info(req.file_id)
    if not file_info:
        return JSONResponse(status_code=404, content={"success": False, "detail": "File ID not recognized"})
    
    try:
        result = transcribe_video(
            video_path=file_info["saved_path"],
            model_size=req.model_size or "base",
            language=req.language if req.language != "auto" else None,
            task=req.task or "transcribe"
        )
        return {
            "success": True,
            "detected_language": result["language"],
            "segments": result["segments"],
            "full_text": result["full_text"]
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "detail": f"Transcription failed: {str(e)}"})

@app.post("/api/translate")
def translate(req: TranslateRequest):
    try:
        segments_dict = [s.model_dump() for s in req.segments]
        translated = translate_segments(
            segments=segments_dict,
            target_lang=req.target_lang,
            source_lang=req.source_lang or "auto"
        )
        return {"success": True, "segments": translated}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "detail": f"Translation failed: {str(e)}"})

@app.get("/api/transcript/{file_id}")
def get_transcript_endpoint(file_id: str):
    transcript_file = os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json")
    if os.path.exists(transcript_file):
        with open(transcript_file, "r", encoding="utf-8") as f:
            return JSONResponse(content={"success": True, "data": json.load(f)})
    for f in os.listdir(UPLOADS_DIR):
        if f.startswith(f"{file_id}_transcript") and f.endswith(".json"):
            with open(os.path.join(UPLOADS_DIR, f), "r", encoding="utf-8") as tf:
                return JSONResponse(content={"success": True, "data": json.load(tf)})
    return JSONResponse(status_code=404, content={"success": False, "detail": "Transcript not found"})

@app.get("/api/state/{file_id}")
def get_state_endpoint(file_id: str):
    state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
    if os.path.exists(state_path):
        with open(state_path, "r", encoding="utf-8") as f:
            return JSONResponse(content={"success": True, "data": json.load(f)})
    return JSONResponse(status_code=404, content={"success": False, "detail": "State not found"})

@app.post("/api/detect-colors/{file_id}")
def detect_colors_endpoint(file_id: str):
    try:
        video_path = None
        for f in os.listdir(UPLOADS_DIR):
            if f.startswith(file_id) and f.endswith(".mp4"):
                video_path = os.path.join(UPLOADS_DIR, f)
                break
        if not video_path or not os.path.exists(video_path):
            return JSONResponse(status_code=404, content={"success": False, "detail": "Video file not found"})

        state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
        segments = []
        state_data = {}
        if os.path.exists(state_path):
            with open(state_path, "r", encoding="utf-8") as sf:
                state_data = json.load(sf)
                segments = state_data.get("segments", [])

        color_info = detect_video_subtitle_colors(video_path, segments)
        if not color_info.get("success"):
            return JSONResponse(status_code=500, content=color_info)

        if os.path.exists(state_path):
            style = state_data.setdefault("style", {})
            dom_bg = color_info.get("dominant_bg", "#000000")
            dom_outline = color_info.get("dominant_outline", dom_bg)
            dom_text = color_info.get("dominant_text", "#FFFFFF")
            style["outline_color"] = dom_outline
            style["outline_width"] = 2 if color_info.get("has_accent") else 0
            style["text_color"] = dom_text
            style["bg_color"] = dom_bg

            seg_colors = color_info.get("segment_colors", {})
            for seg in state_data.get("segments", []):
                sid = seg.get("id")
                is_diag = float(seg.get("y_pct", 86.5)) >= 70.0
                sc = seg_colors.get(sid, {})
                fallback_bg = dom_bg if is_diag else color_info.get("dominant_title_accent", dom_bg)
                seg["bg_color"] = sc.get("bg_color") or fallback_bg
                seg["outline_color"] = sc.get("outline_color") or (dom_outline if is_diag else seg["bg_color"])
                seg["text_color"] = sc.get("text_color") or (dom_text if is_diag else get_contrast_text_color(seg["bg_color"]))

            with open(state_path, "w", encoding="utf-8") as sf:
                json.dump(state_data, sf, ensure_ascii=False, indent=2)

        return color_info
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "detail": str(e)})

class SaveStateRequest(BaseModel):
    segments: List[SegmentItem]
    style: Optional[StyleConfig] = None
    target_lang: Optional[str] = "vi"
    reframe_target: Optional[str] = "original"
    reframe_mode: Optional[str] = "blur"

@app.post("/api/save-state/{file_id}")
def save_state_endpoint(file_id: str, req: SaveStateRequest):
    state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
    segments_dict = [s.model_dump() for s in req.segments]
    style_dict = req.style.model_dump() if req.style else {
        "pos_x_pct": 50.0,
        "pos_y_pct": 90.5,
        "font_size": 26,
        "bg_padding": 12,
        "border_radius": 18,
        "bg_color": "#000000",
        "bg_opacity": 0.95,
        "text_color": "#FFFFFF",
        "mask_mode": "box",
        "font_name": "Arial",
        "bold": True
    }
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump({
            "file_id": file_id,
            "segments": segments_dict,
            "style": style_dict,
            "target_lang": req.target_lang or "vi",
            "reframe_target": req.reframe_target or "original",
            "reframe_mode": req.reframe_mode or "blur"
        }, f, ensure_ascii=False, indent=2)
    return {"success": True, "message": "State saved successfully"}

@app.post("/api/clear-subtitles/{file_id}")
def clear_subtitles_endpoint(file_id: str):
    """Clears all subtitles/transcript for a given video."""
    state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
    trans_path = os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json")
    if os.path.exists(trans_path):
        try:
            os.remove(trans_path)
        except Exception:
            pass
    if os.path.exists(state_path):
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                sdata = json.load(f)
            sdata["segments"] = []
            with open(state_path, "w", encoding="utf-8") as f:
                json.dump(sdata, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    return {"success": True, "message": f"Transcript cleared for {file_id}"}

@app.post("/api/clear-all-transcripts")
def clear_all_transcripts_endpoint():
    """Removes all stored transcript and state files across all projects."""
    backup_dir = os.path.join(BASE_DIR, "backups", "transcripts_archive")
    os.makedirs(backup_dir, exist_ok=True)
    count = 0
    if os.path.exists(UPLOADS_DIR):
        for fname in os.listdir(UPLOADS_DIR):
            if fname.endswith(".json") and ("transcript" in fname or "state" in fname):
                src = os.path.join(UPLOADS_DIR, fname)
                dst = os.path.join(backup_dir, fname)
                try:
                    shutil.copy2(src, dst)
                    os.remove(src)
                    count += 1
                except Exception:
                    pass
    return {"success": True, "message": f"Successfully removed {count} transcript/state files"}

CURRENT_AI_JOB = {}

class SetJobRequest(BaseModel):
    file_id: str
    target_lang: Optional[str] = "vi"
    thinking_mode: Optional[bool] = True
    prompt: Optional[str] = None
    segments: Optional[List[SegmentItem]] = None

@app.get("/api/ai-job")
def get_ai_job():
    global CURRENT_AI_JOB
    if not CURRENT_AI_JOB.get("file_id") or not CURRENT_AI_JOB.get("segments"):
        candidates = []
        if os.path.exists(UPLOADS_DIR):
            for fname in os.listdir(UPLOADS_DIR):
                if fname.endswith("_state.json") or fname.endswith("_transcript.json"):
                    p = os.path.join(UPLOADS_DIR, fname)
                    try:
                        mtime = os.path.getmtime(p)
                        with open(p, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            segs = data.get("segments", [])
                            if segs:
                                fid = fname.replace("_state.json", "").replace("_transcript.json", "")
                                candidates.append((mtime, fid, segs))
                    except Exception:
                        pass
        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            best = candidates[0]
            CURRENT_AI_JOB = {
                "file_id": best[1],
                "target_lang": "vi",
                "thinking_mode": True,
                "status": "pending",
                "created_at": time.time(),
                "segments": best[2]
            }

    file_id = CURRENT_AI_JOB.get("file_id")
    if file_id:
        state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
        trans_path = os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json")
        segments = []
        if os.path.exists(state_path):
            try:
                with open(state_path, "r", encoding="utf-8") as f:
                    segments = json.load(f).get("segments", [])
            except Exception:
                pass
        if not segments and os.path.exists(trans_path):
            try:
                with open(trans_path, "r", encoding="utf-8") as f:
                    segments = json.load(f).get("segments", [])
            except Exception:
                pass
        if segments:
            CURRENT_AI_JOB["segments"] = segments

    return JSONResponse(content={"success": True, "job": CURRENT_AI_JOB})

@app.post("/api/ai-job/set")
def set_ai_job(req: SetJobRequest):
    global CURRENT_AI_JOB
    CURRENT_AI_JOB = {
        "file_id": req.file_id,
        "target_lang": req.target_lang or "vi",
        "thinking_mode": req.thinking_mode if req.thinking_mode is not None else True,
        "prompt": req.prompt,
        "status": "queued",
        "created_at": time.time(),
        "segments": [s.model_dump() for s in req.segments] if req.segments else []
    }
    return JSONResponse(content={"success": True, "job": CURRENT_AI_JOB})

@app.post("/api/ai-job/claim")
def claim_ai_job(req: dict = None):
    global CURRENT_AI_JOB
    if CURRENT_AI_JOB.get("status") in ("queued", "pending"):
        CURRENT_AI_JOB["status"] = "processing"
        CURRENT_AI_JOB["claimed_at"] = time.time()
        return JSONResponse(content={"success": True, "claimed": True, "job": CURRENT_AI_JOB})
    return JSONResponse(content={"success": True, "claimed": False, "job": CURRENT_AI_JOB})

def parse_ai_response_lines(raw_text: str, segments: list) -> int:
    raw_text = raw_text.strip()
    if not raw_text:
        return 0
        
    # Strip <think>...</think> reasoning blocks from DeepSeek R1 / Qwen models
    raw_text = re.sub(r'<think>[\s\S]*?</think>', '', raw_text, flags=re.IGNORECASE).strip()
    if not raw_text:
        return 0

    updated = 0
    seg_by_id = {str(s.get("id")): s for s in segments}
    
    # 1. Try JSON parsing
    parsed = None
    fence_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text)
    candidate_texts = [raw_text]
    if fence_match:
        candidate_texts.insert(0, fence_match.group(1).strip())
    
    for c_text in candidate_texts:
        try:
            parsed = json.loads(c_text)
            if parsed:
                break
        except Exception:
            pass
            
        cleaned = re.sub(r',\s*([\]\}])', r'\1', c_text)
        try:
            parsed = json.loads(cleaned)
            if parsed:
                break
        except Exception:
            pass
            
        arr_m = re.search(r'(\[\s*\{[\s\S]*\}\s*\])', cleaned)
        if arr_m:
            try:
                parsed = json.loads(arr_m.group(1))
                if parsed:
                    break
            except Exception:
                pass

    # If parsed is a dict, look for a list inside
    if isinstance(parsed, dict):
        for k in ["subtitles", "translations", "segments", "lines", "result", "data"]:
            if k in parsed and isinstance(parsed[k], list):
                parsed = parsed[k]
                break
        else:
            for v in parsed.values():
                if isinstance(v, list):
                    parsed = v
                    break

    # If parsed is a dict of ID -> text (e.g. {'1': 'text', '2': 'text'})
    if isinstance(parsed, dict):
        for k, v in parsed.items():
            k_clean = re.sub(r'\D', '', str(k))
            if k_clean in seg_by_id and isinstance(v, str):
                seg_by_id[k_clean]["custom_text"] = v.strip()
                updated += 1
        if updated > 0:
            return updated

    # If parsed is a list
    if isinstance(parsed, list):
        for idx, item in enumerate(parsed):
            if isinstance(item, dict):
                seg_id = None
                for id_key in ["id", "index", "line", "no", "num", "seg_id"]:
                    if id_key in item and item[id_key] is not None:
                        seg_id = str(item[id_key]).strip()
                        break
                if seg_id is None and idx < len(segments):
                    seg_id = str(segments[idx].get("id"))
                
                trans = None
                for trans_key in ["translated", "translation", "target", "text", "content", "vietnamese", "vi", "sub", "subtitle", "result", "output"]:
                    if trans_key in item and item[trans_key]:
                        trans = str(item[trans_key]).strip()
                        break
                
                if seg_id and trans and seg_id in seg_by_id:
                    seg_by_id[seg_id]["custom_text"] = trans
                    updated += 1
            elif isinstance(item, str) and idx < len(segments):
                seg_id = str(segments[idx].get("id"))
                seg_by_id[seg_id]["custom_text"] = item.strip()
                updated += 1
        if updated > 0:
            return updated

    # 2. Individual JSON objects regex: {"id": ...}
    obj_matches = re.findall(r'\{[^{}]*"(?:id|translated|text|translation)"[^{}]*\}', raw_text)
    if obj_matches:
        for obj_str in obj_matches:
            try:
                item = json.loads(obj_str)
                seg_id = str(item.get("id", "")).strip()
                trans = str(item.get("translated") or item.get("translation") or item.get("text") or "").strip()
                if seg_id in seg_by_id and trans:
                    seg_by_id[seg_id]["custom_text"] = trans
                    updated += 1
            except Exception:
                pass
        if updated > 0:
            return updated

    # 3. Line-by-line regex: #1: ..., 1. ..., [1] ..., Line 1: ...
    line_pattern = re.compile(r'^\s*(?:#|Line|Dòng|Câu|Đoạn|Segment|Item)?\s*\[?\(?(\d+)\]?\)?[\.\:\-\s]+(.*)$', re.IGNORECASE)
    for line in raw_text.split('\n'):
        m = line_pattern.match(line)
        if m:
            seg_id = m.group(1).strip()
            trans = m.group(2).strip()
            if (trans.startswith('"') and trans.endswith('"')) or (trans.startswith("'") and trans.endswith("'")):
                trans = trans[1:-1].strip()
            if seg_id in seg_by_id and trans:
                seg_by_id[seg_id]["custom_text"] = trans
                updated += 1
    if updated > 0:
        return updated

    # 4. SRT format parsing
    srt_blocks = re.findall(r'(\d+)\s*\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*\n([\s\S]*?)(?=\n\s*\d+\s*\n|\Z)', raw_text)
    if srt_blocks:
        for num_str, srt_text in srt_blocks:
            clean_trans = " ".join(srt_text.strip().splitlines())
            if num_str in seg_by_id and clean_trans:
                seg_by_id[num_str]["custom_text"] = clean_trans
                updated += 1
        if updated > 0:
            return updated

    # 5. Fallback: plain non-empty lines
    non_empty_lines = [l.strip() for l in raw_text.split('\n') if l.strip() and not l.strip().startswith('```') and not l.strip().startswith('Here is') and not l.strip().startswith('Dưới đây')]
    if len(non_empty_lines) >= len(segments) * 0.5:
        for idx, line in enumerate(non_empty_lines[:len(segments)]):
            seg_id = str(segments[idx].get("id"))
            seg_by_id[seg_id]["custom_text"] = line
            updated += 1

    return updated

class SubmitJobRequest(BaseModel):
    file_id: str
    response: str

@app.post("/api/ai-job/submit")
def submit_ai_job(req: SubmitJobRequest):
    global CURRENT_AI_JOB
    file_id = req.file_id
    raw_text = req.response.strip()
    
    # Load existing state
    state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
    if not os.path.exists(state_path):
        return JSONResponse(status_code=404, content={"success": False, "detail": "Project state not found"})
        
    with open(state_path, "r", encoding="utf-8") as f:
        project_state = json.load(f)
        
    segments = project_state.get("segments", [])
    style_dict = project_state.get("style", {})
    
    print(f"[AI SUBMIT] Processing {len(raw_text)} chars for file_id={file_id} ({len(segments)} segments)")
    updated_count = parse_ai_response_lines(raw_text, segments)
                        
    if updated_count == 0:
        return JSONResponse(status_code=400, content={"success": False, "detail": "Could not parse translated lines from AI output."})
        
    # Save updated state
    project_state["segments"] = segments
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(project_state, f, ensure_ascii=False, indent=2)
        
    # Regenerate ASS and SRT
    file_info = get_file_info(file_id)
    if file_info:
        info_dict = file_info.get("info") or {}
        w = int(info_dict.get("width", 1280))
        h = int(info_dict.get("height", 720))
        ass_path = os.path.join(EXPORTS_DIR, f"{file_id}_subtitles.ass")
        generate_ass_file(segments, ass_path, w, h, style_dict)
        srt_path = os.path.join(EXPORTS_DIR, f"{file_id}_subtitles.srt")
        with open(srt_path, "w", encoding="utf-8") as sf:
            sf.write(generate_srt_content(segments))
            
    CURRENT_AI_JOB["status"] = "completed"
    
    return {
        "success": True,
        "message": f"Successfully updated {updated_count} subtitles from AI Chat!",
        "updated_count": updated_count,
        "segments": segments
    }

@app.post("/api/render")
def render_video(req: RenderRequest):
    file_info = get_file_info(req.file_id)
    if not file_info:
        return JSONResponse(status_code=404, content={"success": False, "detail": "File ID not recognized"})
        
    input_path = file_info["saved_path"]
    w = file_info["info"]["width"]
    h = file_info["info"]["height"]
    
    reframe_target = req.reframe_target or "original"
    reframe_mode = req.reframe_mode or "blur"
    target_w, target_h = get_reframe_dimensions(w, h, reframe_target)

    segments_dict = [s.model_dump() for s in req.segments]
    style_dict = req.style.model_dump()
    
    try:
        ass_filename = f"{req.file_id}_subtitles.ass"
        ass_path = os.path.join(EXPORTS_DIR, ass_filename)
        generate_ass_file(segments_dict, ass_path, target_w, target_h, style_dict)
        
        srt_filename = f"{req.file_id}_subtitles.srt"
        srt_path = os.path.join(EXPORTS_DIR, srt_filename)
        srt_content = generate_srt_content(segments_dict)
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(srt_content)
            
        output_filename = f"{req.file_id}_burned.mp4"
        output_path = os.path.join(EXPORTS_DIR, output_filename)
        
        ok, err_msg = burn_subtitles_to_video(
            input_path, output_path, ass_path, w, h, style_dict,
            reframe_target=reframe_target, reframe_mode=reframe_mode
        )
        if not ok:
            return JSONResponse(status_code=500, content={"success": False, "detail": f"Rendering failed: {err_msg}"})
            
        return {
            "success": True,
            "video_url": f"/api/exports/{output_filename}",
            "srt_url": f"/api/exports/{srt_filename}",
            "ass_url": f"/api/exports/{ass_filename}",
            "filename": output_filename,
            "reframe_target": reframe_target,
            "reframe_mode": reframe_mode,
            "target_width": target_w,
            "target_height": target_h
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "detail": f"Render error: {str(e)}"})

@app.get("/api/exports/{filename}")
def serve_exported_file(filename: str):
    file_path = os.path.join(EXPORTS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Export file not found")
    return FileResponse(file_path, filename=filename)

@app.get("/api/videos")
def list_available_videos():
    projects = []
    if os.path.exists(UPLOADS_DIR):
        for fname in os.listdir(UPLOADS_DIR):
            if fname.lower().endswith(('.mp4', '.mkv', '.avi', '.mov', '.webm')):
                file_id = fname.split("_")[0] if "_" in fname else fname
                full_path = os.path.join(UPLOADS_DIR, fname)
                mtime = os.path.getmtime(full_path)
                original_name = fname[len(file_id) + 1:] if "_" in fname else fname
                
                transcript_path = os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json")
                state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
                
                segments_count = 0
                if os.path.exists(state_path):
                    try:
                        with open(state_path, "r", encoding="utf-8") as sf:
                            sdata = json.load(sf)
                            segments_count = len(sdata.get("segments", []))
                    except Exception:
                        pass
                elif os.path.exists(transcript_path):
                    try:
                        with open(transcript_path, "r", encoding="utf-8") as tf:
                            tdata = json.load(tf)
                            segments_count = len(tdata.get("segments", []))
                    except Exception:
                        pass
                        
                burned_path = os.path.join(EXPORTS_DIR, f"{file_id}_burned.mp4")
                
                projects.append({
                    "file_id": file_id,
                    "filename": fname,
                    "original_name": original_name,
                    "segments_count": segments_count,
                    "has_transcript": os.path.exists(transcript_path) or segments_count > 0,
                    "has_state": os.path.exists(state_path),
                    "has_burned": os.path.exists(burned_path),
                    "modified_time": mtime
                })
                
    projects.sort(key=lambda x: x["modified_time"], reverse=True)
    return {"success": True, "videos": projects}

@app.get("/api/load/{file_id}")
def load_video_project(file_id: str):
    file_info = get_file_info(file_id)
    if not file_info:
        return JSONResponse(status_code=404, content={"success": False, "detail": f"Project '{file_id}' not found."})
        
    state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
    transcript_path = os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json")
    
    segments = []
    style = {}
    target_lang = "vi"
    reframe_target = "original"
    reframe_mode = "blur"
    if os.path.exists(state_path):
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                sdata = json.load(f)
                segments = sdata.get("segments", [])
                style = sdata.get("style", {})
                target_lang = sdata.get("target_lang", "vi")
                reframe_target = sdata.get("reframe_target", "original")
                reframe_mode = sdata.get("reframe_mode", "blur")
        except Exception as e:
            print(f"Error reading state: {e}")
    if not segments and os.path.exists(transcript_path):
        try:
            with open(transcript_path, "r", encoding="utf-8") as f:
                tdata = json.load(f)
                segments = tdata.get("segments", [])
        except Exception as e:
            print(f"Error reading transcript: {e}")
            
    if segments:
        global CURRENT_AI_JOB
        CURRENT_AI_JOB = {
            "file_id": file_id,
            "target_lang": target_lang,
            "status": "pending",
            "segments": segments
        }
        
    return {
        "success": True,
        "file_id": file_id,
        "filename": file_info["original_name"],
        "video_url": f"/api/video/{file_id}",
        "info": file_info["info"],
        "segments": segments,
        "style": style,
        "target_lang": target_lang,
        "reframe_target": reframe_target,
        "reframe_mode": reframe_mode
    }

@app.get("/")
@app.get("/index.html")
async def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    return JSONResponse(status_code=404, content={"message": "Frontend not found. Please build frontend."})

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
