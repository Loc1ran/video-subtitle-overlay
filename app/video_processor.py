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
        "WrapStyle: 2",
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

        is_title = seg_y < int(video_height * 0.70)
        is_side_callout = is_title and (seg_x < int(video_width * 0.28) or seg_x > int(video_width * 0.72))

        processed_entries.append({
            "seg": seg,
            "start": start_val,
            "end": end_val,
            "x": seg_x,
            "y": seg_y,
            "anchor": anchor,
            "text": text,
            "is_title": is_title,
            "is_side_callout": is_side_callout,
        })

    # Collision resolution: Only adjust if simultaneous segments genuinely overlap vertically (< min_gap)
    for i in range(len(processed_entries)):
        for j in range(i + 1, len(processed_entries)):
            e1 = processed_entries[i]
            e2 = processed_entries[j]
            # Dialogue subtitles (y >= 70%) must NEVER have their vertical position altered
            if e1["y"] >= int(video_height * 0.70) or e2["y"] >= int(video_height * 0.70):
                if e1["y"] >= int(video_height * 0.70) and e2["y"] >= int(video_height * 0.70):
                    if e1["end"] > e2["start"]:
                        e1["end"] = e2["start"]
                continue
            overlap = min(e1["end"], e2["end"]) - max(e1["start"], e2["start"])
            if overlap > 0.30:
                is_horiz_overlap = abs(e1["x"] - e2["x"]) < int(video_width * 0.22)
                if not is_horiz_overlap:
                    continue
                # Only separate if they are virtually identical in Y (< 25px apart)
                diff = e2["y"] - e1["y"]
                min_separation = 25
                if abs(diff) < min_separation:
                    needed = min_separation - abs(diff)
                    if diff >= 0:
                        e1["y"] = max(int(video_height * 0.08), e1["y"] - needed // 2)
                        e2["y"] = min(int(video_height * 0.65), e2["y"] + (needed - needed // 2))
                    else:
                        e1["y"] = min(int(video_height * 0.65), e1["y"] + needed // 2)
                        e2["y"] = max(int(video_height * 0.08), e2["y"] - (needed - needed // 2))

    # Detect if any center title has simultaneous side callouts nearby
    for e in processed_entries:
        if e["is_title"] and not e["is_side_callout"]:
            e["has_side_callouts"] = any(
                other["is_side_callout"] and
                (min(e["end"], other["end"]) - max(e["start"], other["start"]) > 0.3) and
                abs(other["y"] - e["y"]) < int(video_height * 0.15)
                for other in processed_entries
            )
        else:
            e["has_side_callouts"] = False

    for e in processed_entries:
        start_time = seconds_to_ass_time(e["start"])
        end_time = seconds_to_ass_time(e["end"])
        seg = e["seg"]

        has_cjk = any('\u4e00' <= c <= '\u9fff' for c in e["text"])
        lines = [l.strip() for l in re.split(r'\\N|\n', e["text"]) if l.strip()]
        if not lines:
            lines = [e["text"].strip()]

        raw_box_w = seg.get("box_w")
        raw_box_h = seg.get("box_h")

        # If it's a top title card (y <= 28%) and text is on 1 line, but original was multi-line (box_h > 100) or text is long (> 28 chars), auto-balance into 2 lines!
        is_top_title = e["is_title"] and not e["is_side_callout"] and e["y"] <= int(video_height * 0.28)
        if is_top_title and len(lines) == 1 and (len(lines[0]) > 28 or (raw_box_h and raw_box_h > 100)):
            words = lines[0].split(" ")
            if len(words) >= 3:
                mid = len(lines[0]) // 2
                best_idx = -1
                best_dist = 9999
                running = 0
                for i, w in enumerate(words[:-1]):
                    running += len(w) + 1
                    dist = abs(running - mid)
                    if dist < best_dist:
                        best_dist = dist
                        best_idx = i
                if best_idx >= 0:
                    line1 = " ".join(words[:best_idx + 1])
                    line2 = " ".join(words[best_idx + 1:])
                    lines = [line1, line2]

        line_count = len(lines)
        max_line_chars = max(len(l) for l in lines) if lines else 1
        clean_text = "\\N".join(lines)

        if e["is_side_callout"]:
            # Side sticker badge: compact font size, snug padding, small radius
            seg_font_size = max(int(9 * scale), min(int(12 * scale), int(font_size * 0.40)))
            pad_h = int(3 * scale)
            pad_w = int(6 * scale)
            border_r = int(5 * scale)
            outline_w = max(1, int(1.5 * scale))
        elif e["is_title"]:
            # Center title header:
            if e.get("has_side_callouts"):
                max_header_w = int(video_width * 0.48)
            else:
                max_header_w = int(video_width * 0.86)
            char_w_est = 0.95 if has_cjk else 0.52
            target_fs = int(max_header_w / (max(1, max_line_chars) * char_w_est + 1.5))
            seg_font_size = max(int(10 * scale), min(int(13 * scale), target_fs))
            pad_h = int(4 * scale)
            pad_w = int(10 * scale)
            border_r = int(6 * scale)
            outline_w = max(1, int(2.0 * scale))
        else:
            # Dialogue
            seg_font_size = min(font_size, int(20 * scale))
            pad_h = int(bg_padding * 0.5 * scale)
            pad_w = int(max(bg_padding * 1.2, 14) * scale)
            border_r = int(border_radius_base * scale) if border_radius_base < 50 else 9999
            outline_w = int(outline_width_px * scale) if outline_width_px > 0 else 0

        seg_text_color = seg.get("text_color") or text_color
        seg_bg_color = seg.get("bg_color") or bg_color
        seg_outline_color = seg.get("outline_color") or outline_color or seg_bg_color or "#000000"

        text_bgr = hex_to_ass_bgr(seg_text_color)
        bg_bgr = hex_to_ass_bgr(seg_bg_color)
        bg_alpha = opacity_to_ass_alpha(bg_opacity)
        outline_bgr = hex_to_ass_bgr(seg_outline_color)

        # Full-width bar is strictly for bottom dialogue subtitles; title cards and side stickers must always use fitted box
        is_dialogue = not e["is_title"] and not e["is_side_callout"] and e["y"] >= int(video_height * 0.70)
        effective_mask_mode = mask_mode if is_dialogue else ("outline" if mask_mode == "outline" else "box")

        if effective_mask_mode == "box":
            char_w = seg_font_size * (0.95 if has_cjk else 0.52)
            natural_w = int(max_line_chars * char_w + pad_w * 2)
            natural_h = int(line_count * seg_font_size * 1.30 + pad_h * 2)

            if e["is_side_callout"]:
                calc_w = max(natural_w, int(raw_box_w if raw_box_w else 0))
                calc_h = max(natural_h, int(raw_box_h if raw_box_h else 0))
            elif e["is_title"]:
                # Always cover the original height raw_box_h so original burned Chinese text NEVER peeks out!
                min_title_h = int(raw_box_h) if raw_box_h else int(line_count * 32 * scale)
                target_mask_h = max(natural_h, min_title_h)
                calc_w = max(natural_w, int(raw_box_w + 80 if raw_box_w else 0))
                calc_h = max(natural_h, target_mask_h)
            else:
                calc_w = max(natural_w, int(raw_box_w + 16 if raw_box_w else 0))
                calc_h = max(natural_h, int(raw_box_h + 8 if raw_box_h else 0))

            box_w = min(int(video_width * 0.94), max(int(50 * scale), calc_w))
            box_h = max(int(seg_font_size * 1.3), calc_h)

            if border_radius_base >= 50:
                r = box_h // 2
            else:
                r = border_r
            r = max(0, min(r, box_w // 2, box_h // 2))

            rect_path = make_rounded_rect_path(box_w, box_h, r)

            bord_tag = f"\\3c{outline_bgr}\\3a&H00&\\bord{outline_w}" if outline_w > 0 else "\\bord0"
            box_tag = f"\\an5\\pos({e['x']},{e['y']})\\1c{bg_bgr}\\1a{bg_alpha}{bord_tag}\\shad0\\p1"
            ass_lines.append(
                f"Dialogue: 0,{start_time},{end_time},CustomStyle,,0,0,0,,{{{box_tag}}}{rect_path}{{\\p0}}"
            )

            # Layer 1: Text centered perfectly on top (with \q2 to prevent line wrapping)
            txt_tag = f"\\an5\\pos({e['x']},{e['y']})\\c{text_bgr}\\1a&H00&\\bord0\\shad0\\fs{seg_font_size}\\fn{font_name}\\b{bold}\\q2"
            ass_lines.append(
                f"Dialogue: 1,{start_time},{end_time},CustomStyle,,0,0,0,,{{{txt_tag}}}{clean_text}"
            )

        elif effective_mask_mode == "full_bar":
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


def get_reframe_dimensions(orig_w: int, orig_h: int, target: str = "original") -> Tuple[int, int]:
    """Returns the output (width, height) for a given reframe target."""
    target = (target or "original").lower()
    if target in ("tiktok", "shorts", "reels", "9:16"):
        return 1080, 1920
    elif target in ("youtube", "widescreen", "16:9"):
        return 1920, 1080
    elif target in ("square", "1:1"):
        return 1080, 1080
    return orig_w, orig_h


def burn_subtitles_to_video(
    input_video_path: str,
    output_video_path: str,
    ass_path: str,
    video_width: int,
    video_height: int,
    style_config: Dict,
    reframe_target: str = "original",
    reframe_mode: str = "blur"
) -> Tuple[bool, str]:
    """
    Renders the ASS subtitles onto the input video with optional auto-reframe
    for TikTok (9:16), YouTube (16:9), or Square (1:1).
    """
    work_dir     = os.path.dirname(os.path.abspath(ass_path))
    ass_filename = os.path.basename(ass_path)
    
    target_w, target_h = get_reframe_dimensions(video_width, video_height, reframe_target)
    mode = (reframe_mode or "blur").lower()
    
    # Check if aspect ratios match closely (within 2%)
    orig_ratio = video_width / max(1, video_height)
    target_ratio = target_w / max(1, target_h)
    aspect_diff = abs(orig_ratio - target_ratio)
    
    needs_reframe = (reframe_target or "original").lower() != "original" and aspect_diff > 0.02

    cmd = ["ffmpeg", "-y", "-i", os.path.abspath(input_video_path)]

    if not needs_reframe:
        # Standard overlay without reframing canvas
        vf_chain = f"ass={ass_filename}"
        cmd.extend([
            "-vf", vf_chain,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "21",
            "-c:a", "aac",
            "-b:a", "192k",
            os.path.abspath(output_video_path)
        ])
    else:
        # Auto Reframe with specified framing mode
        if mode == "crop":
            filter_str = (
                f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h},ass={ass_filename}[outv]"
            )
        elif mode == "fit":
            filter_str = (
                f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
                f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,ass={ass_filename}[outv]"
            )
        else:  # "blur" (Smart blurred background fill)
            filter_str = (
                f"[0:v]split=2[bg_in][fg_in];"
                f"[bg_in]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h},boxblur=25:5[bg];"
                f"[fg_in]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2,ass={ass_filename}[outv]"
            )

        cmd.extend([
            "-filter_complex", filter_str,
            "-map", "[outv]",
            "-map", "0:a?",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "21",
            "-c:a", "aac",
            "-b:a", "192k",
            os.path.abspath(output_video_path)
        ])
    
    print("Running FFmpeg burn command:", " ".join(cmd))
    res = subprocess.run(cmd, cwd=work_dir, capture_output=True, text=True)
    
    if res.returncode != 0:
        print("FFmpeg Error:", res.stderr)
        return False, res.stderr
    
    return True, "Success"
