import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  isLocalSyncKey,
  type LocalSyncPayload,
} from "./local-sync-contract";

type LocalSyncManagerOptions = {
  dataDir: string;
  backupLimit?: number;
  now?: () => Date;
};

export class LocalSyncCorruptionError extends Error {
  constructor() {
    super("本地同步主文件损坏，已停止写入以保护现有数据。");
    this.name = "LocalSyncCorruptionError";
  }
}

export class LocalSyncValidationError extends Error {
  constructor() {
    super("本地同步快照包含不支持的字段或数据类型。");
    this.name = "LocalSyncValidationError";
  }
}

function validateData(data: Record<string, unknown>) {
  const entries = Object.entries(data);
  if (entries.some(([key, value]) => !isLocalSyncKey(key) || typeof value !== "string")) {
    throw new LocalSyncValidationError();
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parsePayload(raw: string): LocalSyncPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LocalSyncCorruptionError();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalSyncCorruptionError();
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.updatedAt !== "string"
    || Number.isNaN(Date.parse(record.updatedAt))
    || !record.data
    || typeof record.data !== "object"
    || Array.isArray(record.data)
  ) {
    throw new LocalSyncCorruptionError();
  }
  const dataEntries = Object.entries(record.data as Record<string, unknown>);
  if (dataEntries.some(([key, value]) => !isLocalSyncKey(key) || typeof value !== "string")) {
    throw new LocalSyncCorruptionError();
  }

  return {
    updatedAt: record.updatedAt,
    data: Object.fromEntries(dataEntries) as Record<string, string>,
  };
}

export class LocalSyncManager {
  private readonly dataDir: string;
  private readonly syncFile: string;
  private readonly managedBackupDir: string;
  private readonly backupLimit: number;
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: LocalSyncManagerOptions) {
    this.dataDir = options.dataDir;
    this.syncFile = path.join(options.dataDir, "flowpilot-local-sync.json");
    this.managedBackupDir = path.join(options.dataDir, "backups", "managed");
    this.backupLimit = options.backupLimit ?? 10;
    this.now = options.now ?? (() => new Date());
  }

  private async backupCurrentFile(now: Date) {
    await mkdir(this.managedBackupDir, { recursive: true, mode: 0o700 });
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(
      this.managedBackupDir,
      `flowpilot-local-sync-${stamp}-${randomUUID()}.json`,
    );
    await copyFile(this.syncFile, backupFile);
    await chmod(backupFile, 0o600);

    const managedFiles = (await readdir(this.managedBackupDir, { withFileTypes: true }))
      .filter(entry => entry.isFile()
        && entry.name.startsWith("flowpilot-local-sync-")
        && entry.name.endsWith(".json"))
      .map(entry => entry.name)
      .sort();
    const excessFiles = managedFiles.slice(0, Math.max(0, managedFiles.length - this.backupLimit));
    await Promise.all(excessFiles.map(file => (
      rm(path.join(this.managedBackupDir, file), { force: true })
    )));
  }

  async read(): Promise<LocalSyncPayload> {
    let raw: string;
    try {
      raw = await readFile(this.syncFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { updatedAt: "", data: {} };
      }
      throw error;
    }
    return parsePayload(raw);
  }

  update(incoming: Record<string, unknown>): Promise<LocalSyncPayload> {
    const operation = this.writeQueue.then(() => this.updateNow(validateData(incoming)));
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async updateNow(incoming: Record<string, string>): Promise<LocalSyncPayload> {
    const current = await this.read();
    const now = this.now();
    const next: LocalSyncPayload = {
      updatedAt: now.toISOString(),
      data: incoming,
    };

    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    if (current.updatedAt) {
      await this.backupCurrentFile(now);
    }
    const temporaryFile = path.join(
      this.dataDir,
      `.flowpilot-local-sync-${process.pid}-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryFile, JSON.stringify(next, null, 2), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporaryFile, this.syncFile);
    } finally {
      await rm(temporaryFile, { force: true });
    }

    return next;
  }
}
