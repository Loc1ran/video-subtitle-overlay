import asyncio
import json

import pytest

mcp_server = pytest.importorskip("mcp_server", reason="mcp package not installed")


def test_all_tools_declare_annotations():
    tools = asyncio.run(mcp_server.mcp.list_tools())
    names = {t.name for t in tools}
    assert {"list_videos", "get_transcript", "update_subtitles", "render_subtitled_video"} <= names
    for t in tools:
        assert t.annotations is not None, f"{t.name} missing ToolAnnotations"
        for hint in ("readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"):
            assert isinstance(getattr(t.annotations, hint), bool), f"{t.name}.{hint} not bool"
    assert tools[0].annotations is not None


def test_list_videos_returns_json_list():
    result = json.loads(mcp_server.list_videos())
    assert isinstance(result, list)


def test_get_transcript_missing_video_returns_error():
    result = json.loads(mcp_server.get_transcript("nonexistent_file_id_xyz"))
    assert "error" in result


def test_update_subtitles_missing_video_returns_error():
    result = json.loads(mcp_server.update_subtitles("nonexistent_file_id_xyz", "[]"))
    assert "error" in result


def test_render_subtitled_video_missing_video_returns_error():
    result = json.loads(mcp_server.render_subtitled_video("nonexistent_file_id_xyz"))
    assert "error" in result
