import os
import cv2
import re
import difflib
import numpy as np
import easyocr
from typing import Dict, List

_ocr_reader = None

def get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        print("Initializing EasyOCR reader (Chinese & English)...")
        _ocr_reader = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)
    return _ocr_reader

def detect_video_subtitle_regions(video_path: str, max_samples: int = 12) -> Dict:
    """
    Scans video frames across the timeline to detect where burned-in/hardcoded subtitles exist.
    Calculates their exact vertical Y percentage, horizontal X percentage, and height.
    """
    try:
        if not os.path.exists(video_path):
            return {"has_subtitles": False, "error": "File not found"}
            
        cap = cv2.VideoCapture(os.path.abspath(video_path))
        if not cap.isOpened():
            return {"has_subtitles": False, "error": "Could not open video"}
            
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        duration = total_frames / fps if fps > 0 else 0
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        if total_frames <= 0 or frame_height <= 0:
            cap.release()
            return {"has_subtitles": False, "error": "Invalid video stream"}
            
        reader = get_ocr_reader()
        
        # Sample up to max_samples evenly spaced across the video
        step = max(1, total_frames // max_samples)
        frame_indices = list(range(step // 2, total_frames, step))[:max_samples]
        
        detected_entries = []
        
        for f_idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue
                
            timestamp = round(f_idx / fps, 2)
            
            # To make OCR much faster, crop to bottom 35% where subtitles appear
            h, w = frame.shape[:2]
            bottom_crop_start = int(h * 0.65)
            bottom_roi = frame[bottom_crop_start:h, 0:w]
            
            if bottom_roi is None or bottom_roi.size == 0 or bottom_roi.shape[0] < 10 or bottom_roi.shape[1] < 10:
                continue
                
            try:
                results = reader.readtext(bottom_roi)
                for bbox, text, conf in results:
                    if conf < 0.35 or not text.strip():
                        continue
                    # Transform bbox back to full-frame coordinates
                    ys = [p[1] + bottom_crop_start for p in bbox]
                    xs = [p[0] for p in bbox]
                    center_y = sum(ys) / len(ys)
                    center_x = sum(xs) / len(xs)
                    box_h = max(ys) - min(ys)
                    box_w = max(xs) - min(xs)
                    
                    y_pct = (center_y / h) * 100.0
                    x_pct = (center_x / w) * 100.0
                    h_pct = (box_h / h) * 100.0
                    
                    detected_entries.append({
                        "timestamp": timestamp,
                        "text": text.strip(),
                        "conf": round(conf, 2),
                        "x_pct": round(x_pct, 1),
                        "y_pct": round(y_pct, 1),
                        "box_h_px": int(box_h),
                        "box_w_px": int(box_w),
                        "h_pct": round(h_pct, 2)
                    })
            except Exception as e:
                print(f"OCR warning on frame {f_idx}: {e}")
                
        cap.release()
        
        if not detected_entries:
            return {
                "has_subtitles": False,
                "detected_y_pct": 88.0,
                "detected_x_pct": 50.0,
                "recommended_font_size": 26,
                "recommended_padding": 14,
                "detected_entries": [],
                "message": "No burned-in subtitles detected. Defaulted to standard bottom speech position (88.0%)."
            }
            
        # Isolate speech subtitle candidates in typical dialogue band (85% - 95%)
        speech_entries = [e for e in detected_entries if 85.0 <= e["y_pct"] <= 95.0]
        if speech_entries:
            y_positions = [e["y_pct"] for e in speech_entries]
            h_pixels = [e["box_h_px"] for e in speech_entries if e["box_h_px"] > 10]
        else:
            y_positions = [e["y_pct"] for e in detected_entries]
            h_pixels = [e["box_h_px"] for e in detected_entries if e["box_h_px"] > 10]
        
        raw_median_y = float(np.median(y_positions)) if y_positions else 88.0
        if raw_median_y < 85.0:
            final_y = 88.0
        else:
            final_y = raw_median_y
            
        median_h_px = float(np.median(h_pixels)) if h_pixels else 24
        scaled_font_size = max(20, min(50, int(median_h_px * (720.0 / max(1, frame_height)))))
        
        return {
            "has_subtitles": True,
            "detected_y_pct": round(final_y, 1),
            "detected_x_pct": 50.0,
            "recommended_font_size": scaled_font_size,
            "recommended_padding": max(12, int(scaled_font_size * 0.45)),
            "detected_entries": detected_entries[:20],
            "message": f"Subtitles aligned to Y={final_y:.1f}% ({len(detected_entries)} detections evaluated)."
        }
    except Exception as err:
        print(f"detect_video_subtitle_regions caught error: {err}")
        return {
            "has_subtitles": False,
            "detected_y_pct": 88.0,
            "detected_x_pct": 50.0,
            "recommended_font_size": 26,
            "recommended_padding": 14,
            "detected_entries": [],
            "message": f"Auto-detected fallback position Y=88.0%: {err}"
        }


def text_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def clean_ocr_text(text: str) -> str:
    return text.strip(" _-~`'\"|[]{}()<>;:,./\\")


def group_multi_area_detections(raw_detections: List[Dict], sample_interval: float = 0.25) -> List[Dict]:
    """
    Groups raw multi-area detections across time and 2D space.
    Maintains multiple simultaneous tracks so text in different positions (e.g. title cards,
    stickers, and bottom dialogue) are independently tracked and output with exact (x_pct, y_pct).
    """
    raw_detections.sort(key=lambda d: d["time"])
    active_tracks = []
    completed_segments = []

    for d in raw_detections:
        txt = d["text"]
        t = d["time"]
        x = d["x_pct"]
        y = d["y_pct"]
        w = d.get("box_w", 100)
        h = d.get("box_h", 24)

        matched_track = None
        for trk in active_tracks:
            gap = t - trk["end"]
            if 0 <= gap <= 0.45 or (gap < 0 and abs(gap) <= 0.30):
                # Spatial proximity: Y within 7% of screen height, X within 20%
                if abs(trk["y_pct"] - y) <= 7.0 and abs(trk["x_pct"] - x) <= 20.0:
                    sim = text_similarity(trk["text"], txt)
                    if sim >= 0.30 or txt in trk["text"] or trk["text"] in txt or (len(txt) <= 5 and len(trk["text"]) <= 5 and sim >= 0.20):
                        matched_track = trk
                        break

        if matched_track:
            matched_track["end"] = round(t + sample_interval, 2)
            matched_track["xs"].append(x)
            matched_track["ys"].append(y)
            matched_track["hs"].append(h)
            matched_track["ws"].append(w)
            matched_track["x_pct"] = round(float(np.median(matched_track["xs"])), 1)
            matched_track["y_pct"] = round(float(np.median(matched_track["ys"])), 1)
            if len(txt) > len(matched_track["text"]) or (len(txt) == len(matched_track["text"]) and not any(c in txt for c in "0123456789-_")):
                matched_track["text"] = txt
        else:
            remaining_active = []
            for trk in active_tracks:
                if t - trk["end"] > 0.45:
                    if trk["end"] - trk["start"] >= 0.20:
                        completed_segments.append(trk)
                else:
                    remaining_active.append(trk)
            active_tracks = remaining_active

            active_tracks.append({
                "start": t,
                "end": round(t + sample_interval, 2),
                "text": txt,
                "x_pct": x,
                "y_pct": y,
                "xs": [x],
                "ys": [y],
                "hs": [h],
                "ws": [w]
            })

    for trk in active_tracks:
        if trk["end"] - trk["start"] >= 0.20:
            completed_segments.append(trk)

    completed_segments.sort(key=lambda s: (s["start"], s["y_pct"]))

    # Calculate global median Y for bottom dialogue subtitles dynamically from detections
    dialogue_ys = [s["y_pct"] for s in completed_segments if s["y_pct"] >= 70.0]
    global_dialogue_y = round(float(np.median(dialogue_ys)), 1) if dialogue_ys else 84.0

    valid_segments = []
    for s in completed_segments:
        dur = s["end"] - s["start"]
        is_dialogue = s["y_pct"] >= 70.0

        # Reject upper background noise (posters, banners, clothing logos, single-frame flickers)
        if not is_dialogue:
            if dur < 0.55 or len(s["text"]) < 2:
                continue
            med_h = int(np.median(s["hs"])) if s.get("hs") else 30
            med_w = int(np.median(s["ws"])) if s.get("ws") else 120
            if med_h > 120 or med_h > med_w * 0.75:
                continue

        clean_s_text = re.sub(r'^[_\-*~]+', '', s["text"]).strip()
        clean_s_text = re.sub(r'(?<=[\u4e00-\u9fff])\-(?=[\u4e00-\u9fff])', '一', clean_s_text)
        if not clean_s_text:
            continue

        med_w = int(np.median(s["ws"])) if s.get("ws") else 120
        med_h = int(np.median(s["hs"])) if s.get("hs") else 30
        final_y = global_dialogue_y if is_dialogue else s["y_pct"]
        final_x = 50.0 if is_dialogue else s["x_pct"]

        # Lead start timestamp by 0.12s to compensate for frame sampling interval quantization
        # so the overlay appears synchronously with the video's subtitle onset
        lead_start = max(0.0, round(s["start"] - 0.12, 2))

        valid_segments.append({
            "id": len(valid_segments) + 1,
            "start": lead_start,
            "end": round(s["end"], 2),
            "text": clean_s_text,
            "custom_text": clean_s_text,
            "x_pct": final_x,
            "y_pct": final_y,
            "anchor": r"\an5",
            "box_w": med_w,
            "box_h": med_h
        })

    # Sort valid segments by start time
    valid_segments.sort(key=lambda seg: (seg["start"], seg["y_pct"]))

    # Eliminate timestamp micro-overlaps for consecutive dialogue lines to prevent flickering
    for i in range(len(valid_segments) - 1):
        s_cur = valid_segments[i]
        s_next = valid_segments[i + 1]
        if s_cur["y_pct"] >= 70.0 and s_next["y_pct"] >= 70.0:
            if s_cur["end"] > s_next["start"]:
                s_cur["end"] = round(s_next["start"], 2)

    # Nudge ONLY if two simultaneous upper cards virtually collide on the exact same line (< 5%)
    for i in range(len(valid_segments)):
        for j in range(i + 1, len(valid_segments)):
            s1 = valid_segments[i]
            s2 = valid_segments[j]
            # Dialogue subtitles (y >= 70%) must NEVER be vertically displaced
            if s1["y_pct"] >= 70.0 or s2["y_pct"] >= 70.0:
                continue
            # Check if simultaneous title intervals overlap with duration > 0.3s
            overlap = min(s1["end"], s2["end"]) - max(s1["start"], s2["start"])
            if overlap > 0.30:
                y_diff = s2["y_pct"] - s1["y_pct"]
                min_separation = 5.0
                if abs(y_diff) < min_separation:
                    needed = min_separation - abs(y_diff)
                    if y_diff >= 0:
                        s1["y_pct"] = round(max(10.0, s1["y_pct"] - needed / 2.0), 1)
                        s2["y_pct"] = round(min(65.0, s2["y_pct"] + needed / 2.0), 1)
                    else:
                        s1["y_pct"] = round(min(65.0, s1["y_pct"] + needed / 2.0), 1)
                        s2["y_pct"] = round(max(10.0, s2["y_pct"] - needed / 2.0), 1)

    return valid_segments


def extract_subtitles_from_video_ocr(video_path: str, sample_interval: float = 0.25, lang_list: list = None, progress_callback = None) -> Dict:
    """
    Extracts all on-screen burned-in subtitle lines directly from video frames across ALL areas:
    - Upper/middle region (25% - 72%): Captures intro titles, cards, topic headers, reactions.
    - Bottom dialogue band (72% - 95%): Captures conversation dialogue.
    Records exact (x_pct, y_pct) for every segment so overlays sit in their exact original locations.
    """
    clean_path = os.path.abspath(video_path)
    if not os.path.exists(clean_path):
        raise FileNotFoundError(f"Video file not found: {clean_path}")

    cap = cv2.VideoCapture(clean_path)
    if not cap.isOpened():
        raise RuntimeError("Could not open video file")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if total_frames <= 0 or frame_h <= 0:
        cap.release()
        raise RuntimeError("Invalid video stream")

    reader = get_ocr_reader()

    # Upper/middle band (titles, cards, side captions)
    u_top, u_bot = int(frame_h * 0.25), int(frame_h * 0.72)
    # Bottom dialogue band
    b_top, b_bot = int(frame_h * 0.72), int(frame_h * 0.95)

    step_frames = max(1, int(sample_interval * fps))
    raw_detections = []

    prev_u_gray = None
    prev_b_gray = None

    print(f"Extracting multi-area subtitles from video: {total_frames} frames ({total_frames/fps:.1f}s) at {sample_interval}s interval...")

    f_idx = 0
    while f_idx < total_frames:
        t_sec = round(f_idx / fps, 2)
        if progress_callback and (f_idx % (step_frames * 2) == 0 or f_idx == 0):
            pct = min(98, max(1, int((f_idx / total_frames) * 100)))
            cur_sec = round(f_idx / fps, 1)
            total_sec = round(total_frames / fps, 1)
            progress_callback(pct, f"Scanning video frames ({cur_sec}s / {total_sec}s)...", len(raw_detections))

        cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            break

        # 1. UPPER/MIDDLE BAND (Intro 0-5s scanned every frame; thereafter scanned every 0.5s or on motion)
        check_upper = (t_sec <= 5.0) or (f_idx % (step_frames * 2) == 0)
        if check_upper:
            u_roi = frame[u_top:u_bot, :]
            u_gray = cv2.cvtColor(u_roi, cv2.COLOR_BGR2GRAY)
            should_u = True
            if prev_u_gray is not None and prev_u_gray.shape == u_gray.shape:
                if float(np.mean(cv2.absdiff(prev_u_gray, u_gray))) < 2.5:
                    should_u = False
            prev_u_gray = u_gray

            if should_u:
                try:
                    res_u = reader.readtext(u_roi)
                    for bbox, text, conf in res_u:
                        clean_t = clean_ocr_text(text)
                        clean_t = re.sub(r'(?<=[\u4e00-\u9fff])\-(?=[\u4e00-\u9fff])', '一', clean_t)
                        clean_t = re.sub(r'^[_\-*~]+', '', clean_t).strip()
                        cjk_len = len(re.findall(r'[\u4e00-\u9fff]', clean_t))
                        min_conf = 0.02 if cjk_len >= 2 else 0.42
                        if conf < min_conf:
                            continue
                        if not re.search(r'[\u4e00-\u9fff]', clean_t) or len(clean_t) < 2:
                            continue
                        ys = [p[1] + u_top for p in bbox]
                        xs = [p[0] for p in bbox]
                        box_h = int(max(ys) - min(ys))
                        box_w = int(max(xs) - min(xs))
                        # Reject non-subtitle shapes (posters, banners, clothing logos, tall background elements)
                        if box_h > 120 or box_h > box_w * 0.75:
                            continue
                        y_pct = round(sum(ys) / len(ys) / frame_h * 100.0, 1)
                        x_pct = round(sum(xs) / len(xs) / frame_w * 100.0, 1)
                        raw_detections.append({
                            "time": t_sec,
                            "text": clean_t,
                            "x_pct": x_pct,
                            "y_pct": y_pct,
                            "box_w": box_w,
                            "box_h": box_h,
                            "region": "upper"
                        })
                except Exception:
                    pass

        # 2. BOTTOM DIALOGUE BAND (72% to 95%)
        b_roi = frame[b_top:b_bot, :]
        b_gray = cv2.cvtColor(b_roi, cv2.COLOR_BGR2GRAY)
        should_b = True
        if prev_b_gray is not None and prev_b_gray.shape == b_gray.shape:
            if float(np.mean(cv2.absdiff(prev_b_gray, b_gray))) < 2.8:
                recent_b = [d for d in raw_detections if d.get("region") == "bottom" and d["time"] == round(t_sec - sample_interval, 2)]
                if recent_b:
                    last = recent_b[-1]
                    raw_detections.append({
                        "time": t_sec,
                        "text": last["text"],
                        "x_pct": last["x_pct"],
                        "y_pct": last["y_pct"],
                        "box_w": last["box_w"],
                        "box_h": last["box_h"],
                        "region": "bottom"
                    })
                    should_b = False
        prev_b_gray = b_gray

        if should_b:
            try:
                res_b = reader.readtext(b_roi)
                cjk_boxes = []
                for bbox, text, conf in res_b:
                    clean_t = clean_ocr_text(text)
                    if not re.search(r'[\u4e00-\u9fff]', clean_t) or len(clean_t) < 1:
                        continue
                    ys = [p[1] + b_top for p in bbox]
                    xs = [p[0] for p in bbox]
                    y_pct = round(sum(ys) / len(ys) / frame_h * 100.0, 1)
                    x_pct = round(sum(xs) / len(xs) / frame_w * 100.0, 1)
                    if 72.0 <= y_pct <= 95.0:
                        cjk_boxes.append({
                            "x": min(xs),
                            "x_pct": x_pct,
                            "y_pct": y_pct,
                            "text": clean_t,
                            "box_w": int(max(xs) - min(xs)),
                            "box_h": int(max(ys) - min(ys))
                        })
                if cjk_boxes:
                    cjk_boxes.sort(key=lambda b: b["x"])
                    combined_txt = "".join(b["text"] for b in cjk_boxes)
                    avg_y = sum(b["y_pct"] for b in cjk_boxes) / len(cjk_boxes)
                    avg_x = sum(b["x_pct"] for b in cjk_boxes) / len(cjk_boxes)
                    raw_detections.append({
                        "time": t_sec,
                        "text": combined_txt,
                        "x_pct": round(avg_x, 1),
                        "y_pct": round(avg_y, 1),
                        "box_w": sum(b["box_w"] for b in cjk_boxes),
                        "box_h": max(b["box_h"] for b in cjk_boxes),
                        "region": "bottom"
                    })
            except Exception:
                pass

        f_idx += step_frames

    cap.release()

    if progress_callback:
        progress_callback(95, "Grouping and aligning subtitle blocks...", len(raw_detections))

    # Track and group all detections across time and 2D space
    final_segments = group_multi_area_detections(raw_detections, sample_interval=sample_interval)

    # Compute global median for bottom dialogue subtitles
    bottom_ys = [s["y_pct"] for s in final_segments if s["y_pct"] >= 75.0]
    global_y = round(float(np.median(bottom_ys)), 1) if bottom_ys else 86.5
    bottom_xs = [s["x_pct"] for s in final_segments if s["y_pct"] >= 75.0]
    global_x = round(float(np.median(bottom_xs)), 1) if bottom_xs else 50.0

    if progress_callback:
        progress_callback(100, f"Extraction complete ({len(final_segments)} subtitles detected)", len(final_segments))

    return {
        "success": True,
        "segments": final_segments,
        "detected_y_pct": global_y,
        "detected_x_pct": global_x,
        "recommended_font_size": 28,
        "recommended_padding": 14,
        "total_lines": len(final_segments),
        "source": "video_ocr"
    }


def rgb_to_hex(r, g, b) -> str:
    return f"#{int(r):02X}{int(g):02X}{int(b):02X}"


def get_contrast_text_color(hex_bg: str) -> str:
    """Returns #FFFFFF for dark/vibrant backgrounds and #111111 for bright backgrounds."""
    h = hex_bg.lstrip("#")
    if len(h) != 6:
        return "#FFFFFF"
    try:
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
        luminance = 0.299 * r + 0.587 * g + 0.114 * b
        return "#111111" if luminance > 165 else "#FFFFFF"
    except Exception:
        return "#FFFFFF"


def pick_dominant_cluster(hex_list: List[str], default: str = "#000000") -> str:
    """Finds the densest cluster of similar colors in a list of hex codes."""
    if not hex_list:
        return default
    try:
        rgbs = np.array([[int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)] for c in hex_list])
        densities = []
        for i, p in enumerate(rgbs):
            dists = np.linalg.norm(rgbs - p, axis=1)
            count = np.sum(dists < 45)
            densities.append((count, -float(np.sum(dists)), hex_list[i]))
        densities.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return densities[0][2]
    except Exception:
        return hex_list[0] if hex_list else default


def detect_video_subtitle_colors(video_path: str, segments: List[Dict] = None) -> Dict:
    """
    Analyzes video frames around subtitle timestamps to automatically detect:
    - Dominant text color (e.g. #FFFFFF or bright foreground)
    - Dominant outline/accent color (e.g. #A44771 pink, lime, gold, etc.)
    - Background color (e.g. #000000)
    - Palette of prominent colors in the subtitles
    - Per-segment color details
    """
    clean_path = os.path.abspath(video_path)
    if not os.path.exists(clean_path):
        return {"success": False, "error": "Video not found"}

    cap = cv2.VideoCapture(clean_path)
    if not cap.isOpened():
        return {"success": False, "error": "Could not open video"}

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    sample_targets = []
    if segments and len(segments) > 0:
        for seg in segments:
            txt = seg.get("text") or seg.get("custom_text") or ""
            if not txt.strip():
                continue
            t = float(seg.get("start", 0.0)) + 0.15
            x = float(seg.get("x_pct", 50.0))
            y = float(seg.get("y_pct", 86.5))
            bw = seg.get("box_w")
            bh = seg.get("box_h")
            sample_targets.append((seg.get("id"), t, x, y, txt, bw, bh))
    else:
        for sec in np.linspace(1.0, max(2.0, total_frames / fps - 1.0), 12):
            sample_targets.append((None, sec, 50.0, 86.5, "", None, None))

    # Prioritize sampling: ALL title cards (y < 70%) plus up to 15 dialogue samples
    title_targets = [t for t in sample_targets if t[3] < 70.0]
    dialogue_targets = [t for t in sample_targets if t[3] >= 70.0]
    eval_targets = title_targets + dialogue_targets[:15]

    detected_accents = []
    detected_dialogue_colors = []
    white_font_detections = []
    detected_texts = []
    segment_colors = {}

    for target in eval_targets:
        sid, t_sec, x_pct, y_pct, txt = target[0], target[1], target[2], target[3], target[4]
        raw_bw = target[5] if len(target) > 5 else None
        raw_bh = target[6] if len(target) > 6 else None

        f_idx = int(t_sec * fps)
        if f_idx >= total_frames:
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        cx = int(frame_w * (x_pct / 100.0))
        cy = int(frame_h * (y_pct / 100.0))

        if raw_bw and raw_bh:
            box_half_w = max(int(raw_bw * 0.55), int(frame_w * 0.15))
            box_half_h = max(int(raw_bh * 0.70), int(frame_h * 0.025))
        else:
            box_half_h = max(24, int(frame_h * 0.035))
            box_half_w = max(120, int(frame_w * 0.28))

        ymin = max(0, cy - box_half_h)
        ymax = min(frame_h, cy + box_half_h)
        xmin = max(0, cx - box_half_w)
        xmax = min(frame_w, cx + box_half_w)

        crop = frame[ymin:ymax, xmin:xmax]
        if crop is None or crop.size == 0 or crop.shape[0] < 8 or crop.shape[1] < 8:
            continue

        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        is_dialogue = y_pct >= 70.0

        # Exclude human skin tones (H: 5-25, S < 140) from being treated as colored fonts
        is_skin = (hsv[:, :, 0] >= 5) & (hsv[:, :, 0] <= 25) & (hsv[:, :, 1] < 140)

        if is_dialogue:
            # 1. First, check the font fill color of the dialogue text
            bright_mask = hsv[:, :, 2] > 175
            if np.sum(bright_mask) > 30:
                bright_hsv = hsv[bright_mask]
                bright_bgr = crop[bright_mask]
                bright_skin = is_skin[bright_mask]

                white_count = np.sum(bright_hsv[:, 1] < 20)
                colored_mask = (bright_hsv[:, 1] >= 28) & (~bright_skin)
                colored_count = np.sum(colored_mask)

                if colored_count > 80 and colored_count > white_count * 1.2:
                    # Genuine colored subtitle font (e.g. sky blue, yellow, pink, etc.)
                    col_bgr = bright_bgr[colored_mask]
                    med_bgr = np.median(col_bgr, axis=0)
                    hex_c = rgb_to_hex(int(med_bgr[2]), int(med_bgr[1]), int(med_bgr[0]))
                    detected_dialogue_colors.append(hex_c)
                    if sid is not None:
                        segment_colors[sid] = {
                            "accent_color": hex_c,
                            "outline_color": hex_c,
                            "bg_color": hex_c,
                            "text_color": get_contrast_text_color(hex_c),
                            "raw_text_color": hex_c
                        }
                elif white_count > 60:
                    white_font_detections.append("#FFFFFF")
                    # White text detected: also check if there is an actual solid, uniform graphic background box
                    bg_mask = (~bright_mask) & (gray > 20) & (~is_skin)
                    if np.sum(bg_mask) > 120:
                        bg_pixels = crop[bg_mask]
                        std_val = float(np.mean([np.std(bg_pixels[:, c]) for c in range(3)]))
                        bg_hsv = hsv[bg_mask]
                        med_sat = float(np.median(bg_hsv[:, 1]))
                        if std_val < 22.0 and med_sat > 35.0:
                            cb = int(np.median(bg_pixels[:, 0]))
                            cg = int(np.median(bg_pixels[:, 1]))
                            cr = int(np.median(bg_pixels[:, 2]))
                            hex_c = rgb_to_hex(cr, cg, cb)
                            detected_dialogue_colors.append(hex_c)
        else:
            # Isolate chromatic pixels strictly around high-contrast title text edges
            text_mask = gray > 190
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
            dilated_text = cv2.dilate(text_mask.astype(np.uint8), kernel)

            # Require true vibrant saturation & value (S > 80, V > 80), exclude human skin tones (H: 5-25, S < 140)
            chromatic_mask = (hsv[:, :, 1] > 80) & (hsv[:, :, 2] > 80) & (~is_skin) & (dilated_text > 0)
            chromatic_pixels = crop[chromatic_mask]

            accent_color = None
            if len(chromatic_pixels) >= 120:
                pixels_f = chromatic_pixels.astype(np.float32)
                criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
                k = min(3, len(chromatic_pixels))
                _, labels, centers = cv2.kmeans(pixels_f, k, None, criteria, 5, cv2.KMEANS_RANDOM_CENTERS)
                counts = np.bincount(labels.flatten())
                top_idx = np.argmax(counts)
                b, g, r = centers[top_idx]
                accent_color = rgb_to_hex(r, g, b)
                detected_accents.append(accent_color)

            if sid is not None:
                segment_colors[sid] = {
                    "accent_color": accent_color,
                    "outline_color": accent_color or "#A0456D",
                    "bg_color": accent_color or "#A0456D",
                    "text_color": "#FFFFFF",
                    "raw_text_color": "#FFFFFF"
                }

    cap.release()

    # Determine dominant dialogue styling via densest color cluster
    # Accept colored font if there are at least 3 colored detections AND colored detections exceed white detections
    if len(detected_dialogue_colors) >= 3 and len(detected_dialogue_colors) >= len(white_font_detections):
        dominant_dialogue_bg = pick_dominant_cluster(detected_dialogue_colors, "#000000")
        dominant_dialogue_text = get_contrast_text_color(dominant_dialogue_bg)
        dominant_dialogue_outline = dominant_dialogue_bg
    else:
        dominant_dialogue_bg = "#000000"
        dominant_dialogue_text = "#FFFFFF"
        dominant_dialogue_outline = "#000000"

    # Determine dominant title accent (pink/magenta/rose from intro title cards)
    dominant_title_accent = "#A0456D" if detected_accents else (dominant_dialogue_bg if dominant_dialogue_bg != "#000000" else "#A0456D")
    for c in detected_accents:
        r = int(c[1:3], 16)
        g = int(c[3:5], 16)
        b = int(c[5:7], 16)
        if r > 120 and b > 80 and g < r:  # Pink/Rose
            dominant_title_accent = c
            break

    unique_palette = list(dict.fromkeys(
        [dominant_dialogue_bg] + detected_dialogue_colors + detected_accents + ["#FFFFFF", "#000000"]
    ))[:8]

    # Explicitly ensure EVERY segment in the video has a defined color entry!
    if segments:
        for seg in segments:
            sid = seg.get("id")
            if sid is None:
                continue
            is_diag = float(seg.get("y_pct", 86.5)) >= 70.0
            if is_diag:
                segment_colors[sid] = {
                    "accent_color": dominant_dialogue_bg if dominant_dialogue_bg != "#000000" else None,
                    "outline_color": dominant_dialogue_outline,
                    "bg_color": dominant_dialogue_bg,
                    "text_color": dominant_dialogue_text,
                    "raw_text_color": dominant_dialogue_bg if dominant_dialogue_bg != "#000000" else "#FFFFFF"
                }
            else:
                accent = segment_colors.get(sid, {}).get("bg_color") or dominant_title_accent
                segment_colors[sid] = {
                    "accent_color": accent,
                    "outline_color": accent,
                    "bg_color": accent,
                    "text_color": get_contrast_text_color(accent),
                    "raw_text_color": "#FFFFFF"
                }

    # Fill in any missing fields
    for sid, info in segment_colors.items():
        if not info.get("bg_color"):
            info["bg_color"] = dominant_dialogue_bg
        if not info.get("text_color"):
            info["text_color"] = dominant_dialogue_text
        if not info.get("outline_color"):
            info["outline_color"] = info["bg_color"]

    return {
        "success": True,
        "dominant_outline": dominant_dialogue_outline,
        "dominant_title_accent": dominant_title_accent,
        "dominant_text": dominant_dialogue_text,
        "dominant_bg": dominant_dialogue_bg,
        "has_accent": dominant_dialogue_bg != "#000000" or bool(detected_accents),
        "detected_palette": unique_palette,
        "segment_colors": segment_colors
    }
