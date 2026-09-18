import os
import tempfile
import pytest
from app.video_processor import (
    hex_to_ass_color,
    hex_to_ass_bgr,
    opacity_to_ass_alpha,
    make_rounded_rect_path,
    seconds_to_srt_time,
    seconds_to_ass_time,
    generate_srt_content,
    generate_ass_file,
    get_reframe_dimensions,
)

def test_hex_to_ass_color():
    # Full opacity white (#FFFFFF) -> &H00FFFFFF
    white = hex_to_ass_color("#FFFFFF", opacity=1.0)
    assert white == "&H00FFFFFF"

    # Full opacity black (#000000) -> &H00000000
    black = hex_to_ass_color("#000000", opacity=1.0)
    assert black == "&H00000000"

    # 50% opacity red (#FF0000) -> alpha is ~127 (0x7F), BBRR -> &H7F0000FF
    red_semi = hex_to_ass_color("#FF0000", opacity=0.5)
    assert red_semi.startswith("&H")
    assert red_semi.endswith("0000FF")

    # 3-character hex (#FFF)
    short_hex = hex_to_ass_color("#FFF", opacity=1.0)
    assert short_hex == "&H00FFFFFF"

def test_hex_to_ass_bgr():
    assert hex_to_ass_bgr("#FFFFFF") == "&HFFFFFF&"
    assert hex_to_ass_bgr("#FF0000") == "&H0000FF&"

def test_opacity_to_ass_alpha():
    assert opacity_to_ass_alpha(1.0) == "&H00&"
    assert opacity_to_ass_alpha(0.0) == "&HFF&"

def test_make_rounded_rect_path():
    # Square
    square = make_rounded_rect_path(100, 50, 0)
    assert "m 0 0 l 100 0 l 100 50 l 0 50" in square
    # Rounded
    rounded = make_rounded_rect_path(100, 50, 10)
    assert rounded.startswith("m 10 0")

def test_seconds_to_srt_time():
    assert seconds_to_srt_time(0.0) == "00:00:00,000"
    assert seconds_to_srt_time(65.25) == "00:01:05,250"
    assert seconds_to_srt_time(3661.5) == "01:01:01,500"

def test_seconds_to_ass_time():
    assert seconds_to_ass_time(0.0) == "0:00:00.00"
    assert seconds_to_ass_time(65.25) == "0:01:05.25"
    assert seconds_to_ass_time(3661.55) == "1:01:01.55"

def test_generate_srt_content():
    segments = [
        {"id": 1, "start": 0.0, "end": 2.5, "text": "Hello World", "custom_text": "Hello World"},
        {"id": 2, "start": 3.0, "end": 5.2, "text": "Testing Subtitles", "custom_text": "Translated Subtitles"}
    ]
    srt = generate_srt_content(segments)
    assert "1\n00:00:00,000 --> 00:00:02,500\nHello World" in srt
    assert "2\n00:00:03,000 --> 00:00:05,200\nTranslated Subtitles" in srt

def test_generate_ass_file():
    segments = [
        {
            "id": 1,
            "start": 1.0,
            "end": 3.5,
            "text": "Subtitle line 1",
            "custom_text": "Subtitle line 1",
            "x_pct": 50.0,
            "y_pct": 85.0
        }
    ]
    style_config = {
        "pos_x_pct": 50.0,
        "pos_y_pct": 85.0,
        "font_name": "Arial",
        "font_size": 24,
        "text_color": "#FFFFFF",
        "bg_color": "#000000",
        "bg_opacity": 0.9,
        "bg_padding": 12,
        "mask_mode": "box",
        "bold": True
    }

    with tempfile.NamedTemporaryFile(suffix=".ass", delete=False) as tf:
        ass_path = tf.name

    try:
        generate_ass_file(segments, ass_path, video_width=1920, video_height=1080, style_config=style_config)
        assert os.path.exists(ass_path)
        with open(ass_path, "r", encoding="utf-8") as f:
            content = f.read()
        assert "[Script Info]" in content
        assert "PlayResX: 1920" in content
        assert "PlayResY: 1080" in content
        assert "[V4+ Styles]" in content
        assert "[Events]" in content
        assert "Subtitle line 1" in content
    finally:
        if os.path.exists(ass_path):
            os.remove(ass_path)

def test_get_reframe_dimensions():
    assert get_reframe_dimensions(1920, 1080, "original") == (1920, 1080)
    assert get_reframe_dimensions(1920, 1080, "tiktok") == (1080, 1920)
    assert get_reframe_dimensions(1920, 1080, "shorts") == (1080, 1920)
    assert get_reframe_dimensions(1080, 1920, "youtube") == (1920, 1080)
    assert get_reframe_dimensions(1920, 1080, "square") == (1080, 1080)

def test_burn_subtitles_with_reframe():
    import subprocess
    from app.video_processor import burn_subtitles_to_video, get_video_info
    
    with tempfile.TemporaryDirectory() as tmpdir:
        input_vid = os.path.join(tmpdir, "in.mp4")
        out_vid = os.path.join(tmpdir, "out_tiktok.mp4")
        ass_path = os.path.join(tmpdir, "test.ass")
        
        # Generate 1s 640x360 test video
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25",
            "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", input_vid
        ], check=True, capture_output=True)
        
        segments = [{"id": 1, "start": 0.0, "end": 1.0, "text": "Reframe Test", "custom_text": "Reframe Test"}]
        generate_ass_file(segments, ass_path, 1080, 1920, {"font_size": 28, "mask_mode": "box"})
        
        ok, msg = burn_subtitles_to_video(
            input_vid, out_vid, ass_path, 640, 360, {},
            reframe_target="tiktok", reframe_mode="blur"
        )
        assert ok is True
        assert os.path.exists(out_vid)
        
        info = get_video_info(out_vid)
        assert info["width"] == 1080
        assert info["height"] == 1920

def test_generate_ass_file_flipped():
    segments = [
        {
            "id": 1,
            "start": 1.0,
            "end": 3.5,
            "text": "Original Chinese OCR",
            "custom_text": "Translated Text",
            "x_pct": 20.0,
            "y_pct": 85.0,
            "anchor": r"\an4"
        }
    ]
    style_config = {
        "pos_x_pct": 50.0,
        "pos_y_pct": 85.0,
        "font_name": "Arial",
        "font_size": 24,
        "text_color": "#FFFFFF",
        "bg_color": "#000000",
        "bg_opacity": 0.9,
        "bg_padding": 12,
        "mask_mode": "box",
        "bold": True
    }

    with tempfile.NamedTemporaryFile(suffix=".ass", delete=False) as tf:
        ass_path = tf.name

    try:
        generate_ass_file(segments, ass_path, video_width=1000, video_height=500, style_config=style_config, flip_horizontal=True)
        assert os.path.exists(ass_path)
        with open(ass_path, "r", encoding="utf-8") as f:
            content = f.read()
            # 100 - 20 = 80%, so pos x should be 800
            assert "\\pos(800," in content
            # Center alignment with \an5 for box and text
            assert "\\an5" in content
            # Translated text should be preserved intact
            assert "Translated Text" in content
    finally:
        if os.path.exists(ass_path):
            os.remove(ass_path)

def test_burn_subtitles_with_flip():
    import subprocess
    from app.video_processor import burn_subtitles_to_video, get_video_info

    with tempfile.TemporaryDirectory() as tmpdir:
        input_vid = os.path.join(tmpdir, "in.mp4")
        out_vid = os.path.join(tmpdir, "out_flipped.mp4")
        ass_path = os.path.join(tmpdir, "test.ass")

        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25",
            "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", input_vid
        ], check=True, capture_output=True)

        segments = [{"id": 1, "start": 0.0, "end": 1.0, "text": "Flip Test", "custom_text": "Flip Test", "x_pct": 25.0}]
        generate_ass_file(segments, ass_path, 640, 360, {"font_size": 24, "mask_mode": "box"}, flip_horizontal=True)

        ok, msg = burn_subtitles_to_video(
            input_vid, out_vid, ass_path, 640, 360, {},
            reframe_target="original", flip_horizontal=True
        )
        assert ok is True
        assert os.path.exists(out_vid)

        info = get_video_info(out_vid)
        assert info["width"] == 640
        assert info["height"] == 360

