import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("底层下载和转写进度不会污染桥接程序的JSON输出", () => {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "flowpilot-douyin-bridge-"));
  const bridgePath = path.join(process.cwd(), "scripts", "flowpilot_douyin_bridge.py");

  try {
    writeFileSync(path.join(fixtureDir, "whisper.py"), "", "utf8");
    writeFileSync(path.join(fixtureDir, "douyin_batch_transcript.py"), `
def extract_douyin_links(_text):
    return ["https://v.douyin.com/example/"]

def download_audio(_link, _output_dir, **_kwargs):
    print("[download] 100%")
    return "/tmp/example.mp3", "video-1", "测试视频", "", None

def transcribe_dispatch(_audio_path, _mode, _args):
    print("[whisper] done")
    return "测试逐字稿", []

def format_timestamped_text(_segments, fallback_text=""):
    return fallback_text
`, "utf8");

    const result = spawnSync("python3", [bridgePath], {
      cwd: fixtureDir,
      env: {
        ...process.env,
        FLOWPILOT_DOUYIN_TOOL_DIR: fixtureDir,
        PYTHONPATH: fixtureDir,
      },
      input: JSON.stringify({
        linksText: "https://v.douyin.com/example/",
        mode: "local",
        modelSize: "small",
        cookiesFromBrowser: "chrome",
      }),
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      results: Array<{ status: string; text: string }>;
    };
    assert.equal(payload.results[0]?.status, "success");
    assert.equal(payload.results[0]?.text, "测试逐字稿");
    assert.match(result.stderr, /\[download\] 100%/);
    assert.match(result.stderr, /\[whisper\] done/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
