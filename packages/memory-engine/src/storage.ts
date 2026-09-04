import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { WorkspaceMemoryEntry, TaskEpisode } from "@comu/protocol";

export class MemoryStorage {
  private baseDir: string;

  constructor(customStorageDir?: string) {
    if (customStorageDir) {
      this.baseDir = customStorageDir;
    } else {
      const platform = os.platform();
      let appDataDir: string;
      if (platform === "win32") {
        appDataDir =
          process.env.LOCALAPPDATA ||
          process.env.APPDATA ||
          path.join(os.homedir(), "AppData", "Local");
      } else if (platform === "darwin") {
        appDataDir = path.join(os.homedir(), "Library", "Application Support");
      } else {
        appDataDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
      }
      this.baseDir = path.join(appDataDir, "comu", "workspaces");
    }
  }

  public getWorkspaceMemoryDir(workspaceId: string): string {
    const safeWorkspaceKey = crypto
      .createHash("sha256")
      .update(workspaceId || "default")
      .digest("hex")
      .substring(0, 16);
    return path.join(this.baseDir, safeWorkspaceKey, "memory");
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private atomicWriteFile(filePath: string, content: string): void {
    this.ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2)}.tmp`;
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, filePath);
  }

  public loadEntries(workspaceId: string, filename: string): WorkspaceMemoryEntry[] {
    const memoryDir = this.getWorkspaceMemoryDir(workspaceId);
    const filePath = path.join(memoryDir, filename);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw.trim()) {
        return [];
      }
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      // In case of corrupted file, return empty array and leave backup
      try {
        fs.copyFileSync(filePath, `${filePath}.corrupt.${Date.now()}`);
      } catch {}
      return [];
    }
  }

  public saveEntries(workspaceId: string, filename: string, entries: WorkspaceMemoryEntry[]): void {
    const memoryDir = this.getWorkspaceMemoryDir(workspaceId);
    const filePath = path.join(memoryDir, filename);
    const content = JSON.stringify(entries, null, 2);
    this.atomicWriteFile(filePath, content);
  }

  public appendEpisode(workspaceId: string, episode: TaskEpisode): void {
    const memoryDir = this.getWorkspaceMemoryDir(workspaceId);
    this.ensureDir(memoryDir);
    const filePath = path.join(memoryDir, "episodes.jsonl");
    const line = `${JSON.stringify(episode)}\n`;
    fs.appendFileSync(filePath, line, "utf8");
  }

  public loadEpisodes(workspaceId: string): TaskEpisode[] {
    const memoryDir = this.getWorkspaceMemoryDir(workspaceId);
    const filePath = path.join(memoryDir, "episodes.jsonl");

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const lines = raw.split("\n").filter(l => l.trim().length > 0);
      return lines.map(line => JSON.parse(line));
    } catch (err) {
      return [];
    }
  }

  public deleteWorkspaceMemory(workspaceId: string): void {
    const memoryDir = this.getWorkspaceMemoryDir(workspaceId);
    if (fs.existsSync(memoryDir)) {
      fs.rmSync(memoryDir, { recursive: true, force: true });
    }
  }
}
