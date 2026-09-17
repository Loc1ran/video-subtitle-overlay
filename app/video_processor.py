import json
import os
import re
import subprocess
from typing import List, Dict, Tuple

def get_video_info(video_path: str) -> Dict:
    """Uses ffprobe to extract video width, height, duration, and fps."""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"width": 1920, "height": 1080, "duration": 0, "fps": 30}
    
    data = json.loads(result.stdout)
    width = 1920
    height = 1080
    fps = 30
    duration = 0

    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            width = int(stream.get("width", 1920))
            height = int(stream.get("height", 1080))
            r_fps = stream.get("r_frame_rate", "30/1")
            try:
                if "/" in r_fps:
                    num, den = r_fps.split("/")
                    fps = round(float(num) / float(den), 2)
                else:
                    fps = float(r_fps)
            except Exception:
                fps = 30
            break

    format_info = data.get("format", {})
    try:
        duration = round(float(format_info.get("duration", 0)), 2)
    except Exception:
        duration = 0

    return {
        "width": width,
        "height": height,
        "duration": duration,
        "fps": fps
    }

def hex_to_ass_color(hex_str: str, opacity: float = 1.0) -> str:
    """Converts #RRGGBB and opacity (0.0 - 1.0) to ASS &HAABBGGRR format."""
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join([c * 2 for c in hex_str])
    if len(hex_str) != 6:
        hex_str = "FFFFFF"
    
    r = int(hex_str[0:2], 16)
    g = int(hex_str[2:4], 16)
    b = int(hex_str[4:6], 16)
    
    # In ASS, Alpha is inverted: 0 is completely opaque, 255 is completely transparent
    alpha = max(0, min(255, int(round((1.0 - opacity) * 255))))
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"

def hex_to_ass_bgr(hex_str: str) -> str:
    """Converts #RRGGBB to ASS &HBBGGRR& format (no alpha)."""
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join([c * 2 for c in hex_str])
    if len(hex_str) != 6:
        hex_str = "FFFFFF"
    r = hex_str[0:2]
    g = hex_str[2:4]
    b = hex_str[4:6]
    return f"&H{b}{g}{r}&"

def opacity_to_ass_alpha(opacity: float) -> str:
    """Converts opacity (0.0 - 1.0) to ASS &HAA& format where 00 is opaque, FF is transparent."""
    alpha = max(0, min(255, int(round((1.0 - opacity) * 255))))
    return f"&H{alpha:02X}&"

def make_rounded_rect_path(w: int, h: int, r: int) -> str:
    """
    Generates ASS vector drawing for a rounded rectangle of width `w`, height `h`,
    and corner radius `r` using 0-based coordinates from (0, 0) to (w, h).
    When anchored with \\an5, the center (w/2, h/2) is positioned at \\pos(x, y).
    """
    w = max(10, int(w))
    h = max(10, int(h))
    r = max(0, min(int(r), w // 2, h // 2))
    if r <= 0:
        return f"m 0 0 l {w} 0 l {w} {h} l 0 {h}"
    
    k = int(round(r * 0.5522847498))
    return (
        f"m {r} 0 "
        f"l {w - r} 0 "
        f"b {w - r + k} 0 {w} {r - k} {w} {r} "
        f"l {w} {h - r} "
        f"b {w} {h - r + k} {w - r + k} {h} {w - r} {h} "
        f"l {r} {h} "
        f"b {r - k} {h} 0 {h - r + k} 0 {h - r} "
        f"l 0 {r} "
        f"b 0 {r - k} {r - k} 0 {r} 0"
    )

def seconds_to_ass_time(seconds: float) -> str:
    """Converts seconds float to ASS timestamp H:MM:SS.cc"""
    if seconds < 0:
        seconds = 0
    hours = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centis = int(round((seconds - int(seconds)) * 100))
    if centis >= 100:
        centis = 99
    return f"{hours}:{mins:02d}:{secs:02d}.{centis:02d}"

def seconds_to_srt_time(seconds: float) -> str:
    """Converts seconds float to SRT timestamp HH:MM:SS,mmm"""
    if seconds < 0:
        seconds = 0
    hours = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    return f"{hours:02d}:{mins:02d}:{secs:02d},{millis:03d}"

def generate_ass_file(
    segments: List[Dict],
    output_ass_path: str,
    video_width: int,
    video_height: int,
    style_config: Dict
) -> str:
    """
    Generates an Advanced SubStation Alpha (.ass) subtitle file.

    Uses a DUAL-LAYER vector approach matching the frontend preview pixel-for-pixel:
      Layer 0: Vector rounded box (or full-width bar) with exact corner radius (border_radius),
               fill color, and border stroke (outline_width & outline_color).
      Layer 1: Clean foreground text centered perfectly inside the box.
    """
    font_name = style_config.get("font_name", "Arial")
    font_size_base = int(style_config.get("font_size", 28))
    # Scale font size to video resolution (reference 720p)
    scale = max(1.0, video_height / 720.0)
    font_size = max(14, int(font_size_base * scale))

    text_color   = style_config.get("text_color",   "#FFFFFF")
    bg_color     = style_config.get("bg_color",     "#000000")
    bg_opacity   = float(style_config.get("bg_opacity", 1.0))
    outline_color = style_config.get("outline_color", bg_color or "#000000")
    mask_mode    = style_config.get("mask_mode", "box")   # "box" | "full_bar" | "outline"
    bg_padding   = int(style_config.get("bg_padding", 14))
    border_radius_base = int(style_config.get("border_radius", 18))
    bold         = 1 if style_config.get("bold", True) else 0
    outline_width_px = int(style_config.get("outline_width", 2))

    pos_x_pct = float(style_config.get("pos_x_pct", 50.0))
    pos_y_pct = float(style_config.get("pos_y_pct", 90.5))

    # ── ASS header ────────────────────────────────────────────────────────────
    ass_lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {video_width}",
        f"PlayResY: {video_height}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: CustomStyle,{font_name},{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,{bold},0,0,0,100,100,0,0,1,0,0,5,20,20,20,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    ]

    # Prepare segment entries and resolve simultaneous vertical collisions
    processed_entries = []
    for seg in segments:
        if "custom_text" in seg and seg["custom_text"] is not None:
            raw_text = seg["custom_text"]
        else:
            raw_text = seg.get("text") or ""
        if not str(raw_text).strip():
            continue

        text = str(raw_text).replace("\r\n", "\\N").replace("\n", "\\N")
        start_val = float(seg.get("start") if seg.get("start") is not None else 0.0)
        end_val = float(seg.get("end") if seg.get("end") is not None else 0.0)
        seg_x_pct = float(seg["x_pct"]) if seg.get("x_pct") is not None else pos_x_pct
        seg_y_pct = float(seg["y_pct"]) if seg.get("y_pct") is not None else pos_y_pct
        seg_x = int(video_width * (seg_x_pct / 100.0))
        seg_y = int(video_height * (seg_y_pct / 100.0))

        explicit_anchor = seg.get("anchor")
        if explicit_anchor and explicit_anchor not in [r"\an4", r"\an6", "left", "right"]:
            anchor = explicit_anchor if explicit_anchor.startswith("\\") else f"\\{explicit_anchor}"
        else:
            anchor = r"\an5"

        processed_entries.append({
            "seg": seg,
            "start": start_val,
            "end": end_val,
            "x": seg_x,
            "y": seg_y,
            "anchor": anchor,
            "text": text
        })

    # Collision resolution for simultaneous segments
    min_dist_px = max(int(font_size * 1.5), 65)
    for i in range(len(processed_entries)):
        for j in range(i + 1, len(processed_entries)):
            e1 = processed_entries[i]
            e2 = processed_entries[j]
            # Dialogue subtitles (y >= 70%) must NEVER have their vertical position altered
            if e1["y"] >= int(video_height * 0.70) or e2["y"] >= int(video_height * 0.70):
                # Clamp end time if consecutive dialogue segments have micro-overlap
                if e1["y"] >= int(video_height * 0.70) and e2["y"] >= int(video_height * 0.70):
                    if e1["end"] > e2["start"]:
                        e1["end"] = e2["start"]
                continue
            overlap = min(e1["end"], e2["end"]) - max(e1["start"], e2["start"])
            if overlap > 0.30:
                diff = e2["y"] - e1["y"]
                if abs(diff) < min_dist_px:
                    needed = min_dist_px - abs(diff)
                    if diff >= 0:
                        e1["y"] = max(int(video_height * 0.08), e1["y"] - needed // 2)
                        e2["y"] = min(int(video_height * 0.65), e2["y"] + (needed - needed // 2))
                    else:
                        e1["y"] = min(int(video_height * 0.65), e1["y"] + needed // 2)
                        e2["y"] = max(int(video_height * 0.08), e2["y"] - (needed - needed // 2))

    for e in processed_entries:
        start_time = seconds_to_ass_time(e["start"])
        end_time = seconds_to_ass_time(e["end"])
        seg = e["seg"]

        is_title = e["y"] < int(video_height * 0.70)
        if is_title:
            if len(e["text"]) > 40:
                seg_font_size = max(font_size, int(22 * scale))
            elif len(e["text"]) > 20:
                seg_font_size = max(font_size + int(4 * scale), int(26 * scale))
            else:
                seg_font_size = max(font_size + int(8 * scale), int(32 * scale))
        else:
            seg_font_size = font_size

        seg_text_color = seg.get("text_color") or text_color
        seg_bg_color = seg.get("bg_color") or bg_color
        seg_outline_color = seg.get("outline_color") or outline_color or seg_bg_color or "#000000"

        text_bgr = hex_to_ass_bgr(seg_text_color)
        bg_bgr = hex_to_ass_bgr(seg_bg_color)
        bg_alpha = opacity_to_ass_alpha(bg_opacity)
        outline_bgr = hex_to_ass_bgr(seg_outline_color)
        outline_w = int(outline_width_px * scale) if outline_width_px > 0 else 0

        lines = [l.strip() for l in re.split(r'\\N|\n', e["text"]) if l.strip()]
        if not lines:
            lines = [e["text"].strip()]
        line_count = len(lines)
        max_line_chars = max(len(l) for l in lines) if lines else 1
        clean_text = "\\N".join(lines)

        if mask_mode == "box":
            has_cjk = any('\u4e00' <= c <= '\u9fff' for c in e["text"])
            char_w = seg_font_size * (0.95 if has_cjk else 0.58)

            pad_h = int(bg_padding * scale)
            pad_w = int(max(bg_padding * 1.8, 16) * scale)

            natural_w = int(max_line_chars * char_w + pad_w * 2)
            natural_h = int(line_count * seg_font_size * 1.35 + pad_h * 1.6)

            raw_box_w = seg.get("box_w")
            raw_box_h = seg.get("box_h")

            if raw_box_w:
                target_w = int(raw_box_w + 16 * scale)
                calc_w = max(natural_w, target_w)
            else:
                calc_w = natural_w

            if raw_box_h:
                target_h = int(raw_box_h + 8 * scale)
                calc_h = max(natural_h, target_h)
            else:
                calc_h = natural_h

            box_w = min(int(video_width * 0.94), max(int(100 * scale), calc_w))
            box_h = max(int(seg_font_size * 1.3), calc_h)

            if border_radius_base >= 50:
                r = box_h // 2
            else:
                r = int(border_radius_base * scale)
            r = max(0, min(r, box_w // 2, box_h // 2))

            rect_path = make_rounded_rect_path(box_w, box_h, r)

            bord_tag = f"\\3c{outline_bgr}\\3a&H00&\\bord{outline_w}" if outline_w > 0 else "\\bord0"
            box_tag = f"\\an5\\pos({e['x']},{e['y']})\\1c{bg_bgr}\\1a{bg_alpha}{bord_tag}\\shad0\\p1"
            ass_lines.append(
                f"Dialogue: 0,{start_time},{end_time},CustomStyle,,0,0,0,,{{{box_tag}}}{rect_path}{{\\p0}}"
            )

            # Layer 1: Text centered perfectly on top
            txt_tag = f"\\an5\\pos({e['x']},{e['y']})\\c{text_bgr}\\1a&H00&\\bord0\\shad0\\fs{seg_font_size}\\fn{font_name}\\b{bold}"
            ass_lines.append(
                f"Dialogue: 1,{start_time},{end_time},CustomStyle,,0,0,0,,{{{txt_tag}}}{clean_text}"
            )

        elif mask_mode == "full_bar":
            bar_h = int(seg_font_size * 2.2)
            bar_path = make_rounded_rect_path(video_width, bar_h, 0)
            bar_tag = f"\\an5\\pos({video_width // 2},{e['y']})\\1c{bg_bgr}\\1a{bg_alpha}\\bord0\\shad0\\p1"
            ass_lines.append(
                f"Dialogue: 0,{start_time},{end_time},CustomStyle,,0,0,0,,{{{bar_tag}}}{bar_path}{{\\p0}}"
            )

            txt_tag = f"\\an5\\pos({e['x']},{e['y']})\\c{text_bgr}\\1a&H00&\\bord0\\shad0\\fs{seg_font_size}\\fn{font_name}\\b{bold}"
            ass_lines.append(
                f"Dialogue: 1,{start_time},{end_time},CustomStyle,,0,0,0,,{{{txt_tag}}}{clean_text}"
            )

        else:   # "outline"
            bord_tag = f"\\3c{outline_bgr}\\3a&H00&\\bord{max(1, outline_w)}" if outline_w > 0 else "\\bord2"
            txt_tag = f"\\an5\\pos({e['x']},{e['y']})\\c{text_bgr}\\1a&H00&{bord_tag}\\shad1\\fs{seg_font_size}\\fn{font_name}\\b{bold}"
            ass_lines.append(
                f"Dialogue: 1,{start_time},{end_time},CustomStyle,,0,0,0,,{{{txt_tag}}}{clean_text}"
            )

    with open(output_ass_path, "w", encoding="utf-8-sig") as f:
        f.write("\n".join(ass_lines))

    return output_ass_path


def generate_srt_content(segments: List[Dict]) -> str:
    srt_lines = []
    idx = 1
    for seg in segments:
        if "custom_text" in seg and seg["custom_text"] is not None:
            text = seg["custom_text"]
        else:
            text = seg.get("text") or ""
        if not text.strip():
            continue
        start_val = float(seg.get("start") if seg.get("start") is not None else 0.0)
        end_val   = float(seg.get("end")   if seg.get("end")   is not None else 0.0)
        start_str = seconds_to_srt_time(start_val)
        end_str   = seconds_to_srt_time(end_val)
        srt_lines.append(f"{idx}\n{start_str} --> {end_str}\n{text}\n")
        idx += 1
    return "\n".join(srt_lines)


def burn_subtitles_to_video(
    input_video_path: str,
    output_video_path: str,
    ass_path: str,
    video_width: int,
    video_height: int,
    style_config: Dict
) -> Tuple[bool, str]:
    """
    Renders the ASS subtitles onto the input video.
    """
    work_dir     = os.path.dirname(os.path.abspath(ass_path))
    ass_filename = os.path.basename(ass_path)
    
    # All masking modes (rounded box, full-width bar, outline) are drawn with pixel-perfect vector
    # accuracy directly inside the ASS file via Layer 0 and Layer 1.
    vf_chain = f"ass={ass_filename}"
    
    cmd = [
        "ffmpeg",
        "-y",
        "-i", os.path.abspath(input_video_path),
        "-vf", vf_chain,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "21",
        "-c:a", "aac",
        "-b:a", "192k",
        os.path.abspath(output_video_path)
    ]
    
    print("Running FFmpeg burn command:", " ".join(cmd))
    res = subprocess.run(cmd, cwd=work_dir, capture_output=True, text=True)
    
    if res.returncode != 0:
        print("FFmpeg Error:", res.stderr)
        return False, res.stderr
    
    return True, "Success"
