import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalSyncRouteHandlers } from "./local-sync-route-handlers";
import { LOCAL_SYNC_MAX_BODY_BYTES } from "./local-sync-contract";
import {
  LocalSyncCorruptionError,
  LocalSyncManager,
} from "./local-sync-manager";

test("本地同步未显式开启时GET和POST都返回404且不访问存储", async () => {
  let storageCalls = 0;
  const manager = {
    async read() {
      storageCalls += 1;
      return { updatedAt: "", data: {} };
    },
    async update() {
      storageCalls += 1;
      return { updatedAt: "", data: {} };
    },
  };
  const handlers = createLocalSyncRouteHandlers({
    manager,
    isEnabled: () => false,
  });

  const getResponse = await handlers.GET(new Request("http://127.0.0.1/api/local-sync"));
  const postResponse = await handlers.POST(new Request("http://127.0.0.1/api/local-sync", {
    method: "POST",
    body: JSON.stringify({ data: {} }),
  }));

  assert.equal(getResponse.status, 404);
  assert.equal(postResponse.status, 404);
  assert.equal(storageCalls, 0);
});

test("本地同步拒绝非回环地址和外部Origin", async () => {
  let storageCalls = 0;
  const manager = {
    async read() {
      storageCalls += 1;
      return { updatedAt: "", data: {} };
    },
    async update() {
      storageCalls += 1;
      return { updatedAt: "", data: {} };
    },
  };
  const handlers = createLocalSyncRouteHandlers({ manager, isEnabled: () => true });

  const lanResponse = await handlers.GET(new Request("http://192.168.1.8/api/local-sync"));
  const forgedHostResponse = await handlers.GET(new Request("http://127.0.0.1/api/local-sync", {
    headers: { Host: "192.168.1.8:3000" },
  }));
  const foreignOriginResponse = await handlers.POST(new Request("http://127.0.0.1/api/local-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://192.168.1.8:3000",
    },
    body: JSON.stringify({ data: {} }),
  }));

  assert.equal(lanResponse.status, 404);
  assert.equal(forgedHostResponse.status, 404);
  assert.equal(foreignOriginResponse.status, 404);
  assert.equal(storageCalls, 0);
});

test("POST请求声明超过10MB时立即返回413", async () => {
  let storageCalls = 0;
  const handlers = createLocalSyncRouteHandlers({
    isEnabled: () => true,
    manager: {
      async read() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
      async update() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
    },
  });

  const response = await handlers.POST(new Request("http://127.0.0.1/api/local-sync", {
    method: "POST",
    headers: {
      "Content-Length": String(LOCAL_SYNC_MAX_BODY_BYTES + 1),
      "Content-Type": "application/json",
    },
    body: "{}",
  }));

  assert.equal(response.status, 413);
  assert.equal(storageCalls, 0);
});

test("POST请求头缺失时仍按正文实际字节数拦截", async () => {
  let storageCalls = 0;
  const handlers = createLocalSyncRouteHandlers({
    isEnabled: () => true,
    maxBodyBytes: 20,
    manager: {
      async read() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
      async update() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
    },
  });

  const response = await handlers.POST(new Request("http://127.0.0.1/api/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { "ipwr:activeIpId": "一段超限内容" } }),
  }));

  assert.equal(response.status, 413);
  assert.equal(storageCalls, 0);
});

test("正文超限后即使取消数据流失败仍返回413", async () => {
  let storageCalls = 0;
  let emitted = false;
  const handlers = createLocalSyncRouteHandlers({
    isEnabled: () => true,
    maxBodyBytes: 20,
    manager: {
      async read() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
      async update() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
    },
  });
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted) return;
      emitted = true;
      controller.enqueue(new Uint8Array(21));
    },
    cancel() {
      throw new Error("取消失败");
    },
  });
  const request = new Request("http://127.0.0.1/api/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const response = await handlers.POST(request);

  assert.equal(response.status, 413);
  assert.equal(storageCalls, 0);
});

test("POST请求格式错误时返回400且不写入", async () => {
  let storageCalls = 0;
  const handlers = createLocalSyncRouteHandlers({
    isEnabled: () => true,
    manager: {
      async read() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
      async update() {
        storageCalls += 1;
        return { updatedAt: "", data: {} };
      },
    },
  });

  for (const body of ["{", JSON.stringify({ data: [] }), JSON.stringify({})]) {
    const response = await handlers.POST(new Request("http://127.0.0.1/api/local-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(storageCalls, 0);
});

test("主文件损坏时API返回专用409且不泄露文件路径", async () => {
  const handlers = createLocalSyncRouteHandlers({
    isEnabled: () => true,
    manager: {
      async read() {
        throw new LocalSyncCorruptionError();
      },
      async update() {
        throw new LocalSyncCorruptionError();
      },
    },
  });

  const getResponse = await handlers.GET(new Request("http://127.0.0.1/api/local-sync"));
  const postResponse = await handlers.POST(new Request("http://127.0.0.1/api/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { "ipwr:activeIpId": "ip-1" } }),
  }));
  const getBody = await getResponse.json() as { errorCode?: string; error?: string };
  const postBody = await postResponse.json() as { errorCode?: string; error?: string };

  assert.equal(getResponse.status, 409);
  assert.equal(postResponse.status, 409);
  assert.equal(getBody.errorCode, "LOCAL_SYNC_FILE_CORRUPTED");
  assert.equal(postBody.errorCode, "LOCAL_SYNC_FILE_CORRUPTED");
  assert.doesNotMatch(getBody.error ?? "", /\/Users\/|data\//);
  assert.doesNotMatch(postBody.error ?? "", /\/Users\/|data\//);
});

test("本机开启后拒绝未知字段并通过POST与GET同步合法快照", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "flowpilot-local-sync-route-"));
  try {
    const handlers = createLocalSyncRouteHandlers({
      isEnabled: () => true,
      manager: new LocalSyncManager({
        dataDir,
        now: () => new Date("2026-08-11T10:00:00.000Z"),
      }),
    });
    const invalidResponse = await handlers.POST(new Request("http://localhost/api/local-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        data: {
          "unknown:key": "不应保存",
        },
      }),
    }));
    const postResponse = await handlers.POST(new Request("http://localhost/api/local-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        data: { "ipwr:activeIpId": "ip-shuimuran" },
      }),
    }));
    const getResponse = await handlers.GET(new Request("http://localhost/api/local-sync"));
    const payload = await getResponse.json() as {
      updatedAt: string;
      data: Record<string, string>;
    };

    assert.equal(invalidResponse.status, 400);
    assert.equal(postResponse.status, 200);
    assert.equal(getResponse.status, 200);
    assert.equal(payload.updatedAt, "2026-08-11T10:00:00.000Z");
    assert.deepEqual(payload.data, { "ipwr:activeIpId": "ip-shuimuran" });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
