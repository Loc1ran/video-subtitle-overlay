import pytest
from app.video_ocr import clean_ocr_text, group_multi_area_detections

def test_clean_ocr_text():
    assert clean_ocr_text("  _test_subtitle~  ") == "test_subtitle"
    assert clean_ocr_text("[hello world]") == "hello world"

def test_group_multi_area_detections_allows_digits_and_clocks():
    # Digits and clocks like 11:59 or 12:00 in upper region must not be discarded
    raw_detections = [
        {"time": 0.0, "text": "11:59", "x_pct": 50.0, "y_pct": 39.4, "box_w": 200, "box_h": 60, "region": "upper"},
        {"time": 0.5, "text": "11:59", "x_pct": 50.0, "y_pct": 39.4, "box_w": 200, "box_h": 60, "region": "upper"},
        {"time": 1.0, "text": "11:59", "x_pct": 50.0, "y_pct": 39.4, "box_w": 200, "box_h": 60, "region": "upper"},
    ]
    grouped = group_multi_area_detections(raw_detections, sample_interval=0.5)
    assert len(grouped) == 1
    assert grouped[0]["text"] == "11:59"
    assert grouped[0]["x_pct"] == 50.0

def test_group_multi_area_detections_prevents_cross_column_merging():
    # Centered title (x ~ 50%) and side banner (x ~ 65%) must NOT be merged into a single multi-line card
    raw_detections = [
        {"time": 0.0, "text": "当下课还有一分钟时", "x_pct": 50.0, "y_pct": 34.6, "box_w": 600, "box_h": 80, "region": "upper"},
        {"time": 0.5, "text": "当下课还有一分钟时", "x_pct": 50.0, "y_pct": 34.6, "box_w": 600, "box_h": 80, "region": "upper"},
        {"time": 0.0, "text": "棍若雨", "x_pct": 65.0, "y_pct": 37.0, "box_w": 120, "box_h": 50, "region": "upper"},
        {"time": 0.5, "text": "棍若雨", "x_pct": 65.0, "y_pct": 37.0, "box_w": 120, "box_h": 50, "region": "upper"},
    ]
    grouped = group_multi_area_detections(raw_detections, sample_interval=0.5)
    assert len(grouped) == 2
    texts = [g["text"] for g in grouped]
    assert "当下课还有一分钟时" in texts
    assert "棍若雨" in texts
    assert "当下课还有一分钟时\n棍若雨" not in texts

def test_group_multi_area_detections_merges_true_stacked_center_lines():
    # Two lines in the same center column (x ~ 50% and x ~ 50%) should cleanly merge
    raw_detections = [
        {"time": 0.0, "text": "当下课还有一分钟时", "x_pct": 50.0, "y_pct": 34.6, "box_w": 600, "box_h": 80, "region": "upper"},
        {"time": 0.5, "text": "当下课还有一分钟时", "x_pct": 50.0, "y_pct": 34.6, "box_w": 600, "box_h": 80, "region": "upper"},
        {"time": 0.0, "text": "11:59", "x_pct": 50.0, "y_pct": 39.4, "box_w": 200, "box_h": 60, "region": "upper"},
        {"time": 0.5, "text": "11:59", "x_pct": 50.0, "y_pct": 39.4, "box_w": 200, "box_h": 60, "region": "upper"},
    ]
    grouped = group_multi_area_detections(raw_detections, sample_interval=0.5)
    assert len(grouped) == 1
    assert grouped[0]["text"] == "当下课还有一分钟时\n11:59"
    assert grouped[0]["x_pct"] == 50.0
