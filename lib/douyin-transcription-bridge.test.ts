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

test("下载因缺少Cookie失败时返回独立状态且不启动Whisper", () => {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "flowpilot-douyin-cookie-"));
  const bridgePath = path.join(process.cwd(), "scripts", "flowpilot_douyin_bridge.py");

  try {
    writeFileSync(path.join(fixtureDir, "whisper.py"), "", "utf8");
    writeFileSync(path.join(fixtureDir, "douyin_batch_transcript.py"), `
def extract_douyin_links(_text):
    return ["https://v.douyin.com/cookie-required/"]

def download_audio(_link, _output_dir, **_kwargs):
    raise RuntimeError("ERROR: Fresh cookies (not necessarily logged in) are needed")

def transcribe_dispatch(_audio_path, _mode, _args):
    print("[whisper] should-not-run")
    return "不应产生的逐字稿", []

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
        linksText: "https://v.douyin.com/cookie-required/",
        mode: "local",
        modelSize: "small",
        cookiesFromBrowser: "",
      }),
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      results: Array<{ errorCode?: string; message?: string }>;
    };
    assert.equal(payload.results[0]?.errorCode, "cookie_required");
    assert.equal(
      payload.results[0]?.message,
      "该视频需要登录信息才能下载，请选择Chrome、Safari等浏览器登录信息后重试。",
    );
    assert.doesNotMatch(result.stderr, /\[whisper\]/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("下载、音频转换和转写失败返回各自独立状态", () => {
  const cases = [
    {
      name: "download",
      downloadBody: 'raise RuntimeError("网络连接超时")',
      transcribeBody: 'print("[whisper] should-not-run"); return "不会执行", []',
      errorCode: "download_failed",
      message: "视频下载失败，请检查网络或稍后重试。",
    },
    {
      name: "download-with-negative-login-text",
      downloadBody: 'raise RuntimeError("本视频不需要登录即可访问，但网络连接超时")',
      transcribeBody: 'print("[whisper] should-not-run"); return "不会执行", []',
      errorCode: "download_failed",
      message: "视频下载失败，请检查网络或稍后重试。",
    },
    {
      name: "conversion",
      downloadBody: 'raise RuntimeError("音频转码后未找到 mp3 文件，请确认 ffmpeg 已正确安装")',
      transcribeBody: 'print("[whisper] should-not-run"); return "不会执行", []',
      errorCode: "audio_conversion_failed",
      message: "视频已下载，但音频转换失败，请检查本机FFmpeg后重试。",
    },
    {
      name: "transcription",
      downloadBody: 'return "/tmp/example.mp3", "video-1", "测试视频", "", None',
      transcribeBody: 'raise RuntimeError("Whisper模型加载失败")',
      errorCode: "transcription_failed",
      message: "音频已下载，但转写失败，请检查所选转写方式或稍后重试。",
    },
  ] as const;
  const bridgePath = path.join(process.cwd(), "scripts", "flowpilot_douyin_bridge.py");

  for (const scenario of cases) {
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), `flowpilot-douyin-${scenario.name}-`));
    try {
      writeFileSync(path.join(fixtureDir, "whisper.py"), "", "utf8");
      writeFileSync(path.join(fixtureDir, "douyin_batch_transcript.py"), `
def extract_douyin_links(_text):
    return ["https://v.douyin.com/${scenario.name}/"]

def download_audio(_link, _output_dir, **_kwargs):
    ${scenario.downloadBody}

def transcribe_dispatch(_audio_path, _mode, _args):
    ${scenario.transcribeBody}

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
          linksText: `https://v.douyin.com/${scenario.name}/`,
          mode: "local",
          modelSize: "small",
          cookiesFromBrowser: "",
        }),
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        results: Array<{ errorCode?: string; message?: string }>;
      };
      assert.equal(payload.results[0]?.errorCode, scenario.errorCode, scenario.name);
      assert.equal(payload.results[0]?.message, scenario.message, scenario.name);
      if (scenario.errorCode !== "transcription_failed") {
        assert.doesNotMatch(result.stderr, /\[whisper\]/, scenario.name);
      }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }
});
