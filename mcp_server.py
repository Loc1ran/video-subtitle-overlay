import os
import sys
import json
from typing import List, Dict, Optional, Any
try:
    from mcp.server.fastmcp import FastMCP
    mcp = FastMCP("video-subtitle-studio")
except ImportError:
    print("[Error] 'mcp' package is not installed. Please run: pip install mcp")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
EXPORTS_DIR = os.path.join(BASE_DIR, "exports")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(EXPORTS_DIR, exist_ok=True)

def find_video_path(file_id: str) -> Optional[str]:
    if not os.path.exists(UPLOADS_DIR):
        return None
    for f in os.listdir(UPLOADS_DIR):
        if f.startswith(f"{file_id}_") and f.lower().endswith(('.mp4', '.mkv', '.avi', '.mov', '.webm')):
            return os.path.join(UPLOADS_DIR, f)
    exact = os.path.join(UPLOADS_DIR, file_id)
    if os.path.exists(exact):
        return exact
    return None

@mcp.tool()
def list_videos() -> str:
    """Lists all videos uploaded to the Video Subtitle Studio with their IDs, filenames, size, and status."""
    videos = []
    if os.path.exists(UPLOADS_DIR):
        for f in os.listdir(UPLOADS_DIR):
            if f.lower().endswith(('.mp4', '.mkv', '.avi', '.mov', '.webm')):
                file_id = f.split("_")[0] if "_" in f else f
                full_path = os.path.join(UPLOADS_DIR, f)
                size_mb = round(os.path.getsize(full_path) / (1024 * 1024), 2)
                
                transcript_path = os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json")
                state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
                transcript_zh_path = os.path.join(UPLOADS_DIR, f"{file_id}_transcript_zh.json")
                
                segments_count = 0
                for p in [transcript_path, state_path, transcript_zh_path]:
                    if os.path.exists(p):
                        try:
                            with open(p, "r", encoding="utf-8") as pf:
                                pdata = json.load(pf)
                                segs = pdata.get("segments", [])
                                if len(segs) > 0:
                                    segments_count = len(segs)
                                    break
                        except Exception:
                            pass
                
                has_transcript = segments_count > 0 or os.path.exists(transcript_path)
                burned_path = os.path.join(EXPORTS_DIR, f"{file_id}_burned.mp4")
                has_burned = os.path.exists(burned_path)
                
                videos.append({
                    "file_id": file_id,
                    "filename": f,
                    "size_mb": size_mb,
                    "segments_count": segments_count,
                    "has_transcript": has_transcript,
                    "has_burned_export": has_burned
                })
    return json.dumps(videos, indent=2, ensure_ascii=False)

@mcp.tool()
def get_transcript(file_id: str, model_size: str = "tiny", language: str = "auto") -> str:
    """
    Retrieves the transcript segments of a video. 
    If a transcript has already been generated or cached, it returns it.
    Otherwise, it runs Whisper to transcribe the dialogue.
    Returns: JSON string with segments containing id, start, end, text, and custom_text.
    """
    # Check for existing transcript files
    for candidate in [
        os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json"),
        os.path.join(UPLOADS_DIR, f"{file_id}_transcript_zh.json"),
        os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
    ]:
        if os.path.exists(candidate):
            with open(candidate, "r", encoding="utf-8") as f:
                return f.read()
                
    video_path = find_video_path(file_id)
    if not video_path:
        return json.dumps({"error": f"Video with file_id '{file_id}' not found in uploads."})
        
    from app.transcriber import transcribe_video
    lang_param = None if language == "auto" else language
    result = transcribe_video(video_path, model_size=model_size, language=lang_param)
    
    transcript_file = os.path.join(UPLOADS_DIR, f"{file_id}_transcript.json")
    with open(transcript_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        
    return json.dumps(result, ensure_ascii=False, indent=2)

@mcp.tool()
def update_subtitles(file_id: str, segments_json: str, pos_y_pct: float = 86.5, font_size: int = 26, bg_padding: int = 15) -> str:
    """
    Updates the video subtitles with high-quality AI translations and generates the ASS and SRT subtitle files.
    - file_id: ID of the video project.
    - segments_json: JSON string containing a list of segments with keys: id, start, end, text, custom_text.
    - pos_y_pct: Vertical position in % (default 86.5% to perfectly cover speech subtitles).
    - font_size: Font size in pixels (default 26).
    - bg_padding: Padding of black background masking box to fully cover original hardcoded subtitles (default 15).
    """
    video_path = find_video_path(file_id)
    if not video_path:
        return json.dumps({"error": f"Video with file_id '{file_id}' not found."})
        
    try:
        segments = json.loads(segments_json)
        if isinstance(segments, dict) and "segments" in segments:
            segments = segments["segments"]
    except Exception as e:
        return json.dumps({"error": f"Invalid segments_json: {str(e)}"})
        
    from app.video_processor import get_video_info, generate_ass_file, generate_srt_content
    info = get_video_info(video_path)
    w = info.get("width", 1024)
    h = info.get("height", 576)
    
    style_dict = {
        "pos_x_pct": 50.0,
        "pos_y_pct": pos_y_pct,
        "font_name": "Arial",
        "font_size": font_size,
        "text_color": "#FFFFFF",
        "bg_color": "#000000",
        "bg_opacity": 0.95,
        "bg_padding": bg_padding,
        "outline_color": "#000000",
        "outline_width": 3,
        "mask_mode": "box",
        "bold": True
    }
    
    ass_path = os.path.join(EXPORTS_DIR, f"{file_id}_subtitles.ass")
    generate_ass_file(segments, ass_path, w, h, style_dict)
    
    srt_path = os.path.join(EXPORTS_DIR, f"{file_id}_subtitles.srt")
    srt_content = generate_srt_content(segments)
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_content)
        
    state_path = os.path.join(UPLOADS_DIR, f"{file_id}_state.json")
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump({
            "file_id": file_id,
            "segments": segments,
            "style": style_dict
        }, f, ensure_ascii=False, indent=2)
        
    return json.dumps({
        "success": True,
        "message": f"Updated {len(segments)} subtitle segments. ASS and SRT files saved.",
        "ass_path": ass_path,
        "srt_path": srt_path,
        "style": style_dict
    }, indent=2)

@mcp.tool()
def render_subtitled_video(file_id: str, pos_y_pct: float = 86.5, font_size: int = 26, bg_padding: int = 15) -> str:
    """
    Burns the updated subtitles with the black masking box onto the video using FFmpeg.
    Returns: JSON with output video path and download URL.
    """
    video_path = find_video_path(file_id)
    if not video_path:
        return json.dumps({"error": f"Video with file_id '{file_id}' not found."})
        
    ass_path = os.path.join(EXPORTS_DIR, f"{file_id}_subtitles.ass")
    if not os.path.exists(ass_path):
        return json.dumps({"error": f"Subtitle file {file_id}_subtitles.ass does not exist. Call update_subtitles first."})
        
    from app.video_processor import get_video_info, burn_subtitles_to_video
    info = get_video_info(video_path)
    w = info.get("width", 1024)
    h = info.get("height", 576)
    
    output_filename = f"{file_id}_burned.mp4"
    output_path = os.path.join(EXPORTS_DIR, output_filename)
    
    style_dict = {
        "pos_x_pct": 50.0,
        "pos_y_pct": pos_y_pct,
        "font_name": "Arial",
        "font_size": font_size,
        "text_color": "#FFFFFF",
        "bg_color": "#000000",
        "bg_opacity": 0.95,
        "bg_padding": bg_padding,
        "outline_color": "#000000",
        "outline_width": 3,
        "mask_mode": "box",
        "bold": True
    }
    
    ok, err_msg = burn_subtitles_to_video(video_path, output_path, ass_path, w, h, style_dict)
    if not ok:
        return json.dumps({"error": f"Rendering failed: {err_msg}"})
        
    return json.dumps({
        "success": True,
        "burned_video_path": output_path,
        "download_url": f"http://localhost:8000/api/exports/{output_filename}"
    }, indent=2)

if __name__ == "__main__":
    mcp.run()
