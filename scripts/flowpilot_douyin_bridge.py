#!/usr/bin/env python3
"""调用本机现有抖音逐字稿工具，并用JSON与FlowPilot通信。"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace


def tool_candidates() -> list[Path]:
    configured = os.environ.get("FLOWPILOT_DOUYIN_TOOL_DIR", "").strip()
    candidates = [Path(configured).expanduser()] if configured else []
    candidates.extend(
        [
            Path.home() / "Documents" / "逐字稿工具" / "douyin_transcript_tool",
            Path.home() / "Documents" / "逐字稿工具" / "douyin_transcript_tool-main",
        ]
    )
    return candidates


def find_tool_dir() -> Path:
    for candidate in tool_candidates():
        if (candidate / "douyin_batch_transcript.py").is_file():
            return candidate
    raise RuntimeError("找不到抖音逐字稿工具，请配置FLOWPILOT_DOUYIN_TOOL_DIR。")


def load_tool():
    tool_file = find_tool_dir() / "douyin_batch_transcript.py"
    spec = importlib.util.spec_from_file_location("flowpilot_douyin_tool", tool_file)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载抖音逐字稿工具。")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def health() -> dict:
    tool_dir = find_tool_dir()
    missing = []
    if not has_module("yt_dlp"):
        missing.append("yt-dlp")
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg")
    return {
        "ready": not missing,
        "toolDir": str(tool_dir),
        "missing": missing,
        "modes": {
            "local": has_module("whisper"),
            "api": has_module("openai"),
            "bailian": has_module("dashscope"),
        },
    }


def process(payload: dict) -> dict:
    tool = load_tool()
    links = tool.extract_douyin_links(str(payload.get("linksText", "")))
    if not links:
        raise RuntimeError("没有识别到抖音视频链接。")
    if len(links) > 20:
        raise RuntimeError("为避免误操作，一次最多处理20条链接。")

    mode = str(payload.get("mode", "local"))
    mode_health = health()["modes"]
    if mode not in mode_health:
        raise RuntimeError("不支持这种转写方式。")
    if not mode_health[mode]:
        raise RuntimeError("本机还没有安装所选转写方式需要的组件。")
    args = SimpleNamespace(
        mode=mode,
        model_size=str(payload.get("modelSize", "small")),
        api_key=str(payload.get("apiKey", "")),
        api_base_url=str(payload.get("apiBaseUrl", "")),
        api_model=str(payload.get("apiModel", "whisper-1")),
        dashscope_api_key=str(payload.get("dashscopeApiKey", "")),
    )
    cookies_browser = str(payload.get("cookiesFromBrowser", ""))
    results = []

    with tempfile.TemporaryDirectory(prefix="flowpilot-douyin-") as output_dir:
        for index, link in enumerate(links):
            audio_path = None
            try:
                audio_path, video_id, title, _, _ = tool.download_audio(
                    link,
                    output_dir,
                    cookies_from_browser=cookies_browser,
                    cookies_file="",
                )
                text, segments = tool.transcribe_dispatch(audio_path, mode, args)
                formatted = tool.format_timestamped_text(segments, fallback_text=text).strip()
                results.append(
                    {
                        "sourceUrl": link,
                        "videoId": video_id,
                        "title": title or f"抖音逐字稿{index + 1}",
                        "status": "success",
                        "text": formatted,
                    }
                )
            except Exception:
                results.append(
                    {
                        "sourceUrl": link,
                        "title": f"抖音链接{index + 1}",
                        "status": "error",
                        "text": "",
                        "message": "下载或转写失败，请检查链接、登录状态和所选转写方式。",
                    }
                )
            finally:
                if audio_path and os.path.isfile(audio_path):
                    try:
                        os.remove(audio_path)
                    except OSError:
                        pass
    return {"results": results}


def main() -> None:
    try:
        response = health() if "--health" in sys.argv else process(json.load(sys.stdin))
        print(json.dumps(response, ensure_ascii=False))
    except Exception:
        print(json.dumps({"error": "本机逐字稿工具处理失败。"}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
