import { SearchBackend, SearchQuery, SearchResult, SearchTextResult } from "../interfaces.js";
import { ToolContext } from "@comu/tool-core";
import { resolveAndVerifyPath } from "@comu/tool-filesystem";
import * as fs from "fs/promises";
import * as path from "path";

export class NodeRecursiveSearchBackend implements SearchBackend {
  
  private isBinaryString(buffer: Buffer): boolean {
    for (let i = 0; i < buffer.length && i < 1024; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  }

  async search(query: SearchQuery, context: ToolContext): Promise<SearchTextResult> {
    const rootPath = context.workspace.rootPath;
    const maxResults = context.limits.maxResults ?? 100;
    const maxBytes = context.limits.maxBytes ?? 1024 * 1024 * 5; // default 5MB file limit
    const ignoreList = new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage"]);
    
    let regex: RegExp;
    try {
      const flags = query.caseSensitive ? "g" : "gi";
      regex = query.isRegex ? new RegExp(query.query, flags) : new RegExp(query.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) {
      throw new Error(`Invalid search query: ${e}`);
    }

    const matches: SearchResult[] = [];
    let isTruncated = false;

    const walk = async (currentPath: string) => {
      if (context.cancellation?.isCancelled) return;
      if (matches.length >= maxResults) {
        isTruncated = true;
        return;
      }

      let entries;
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch (e) {
        return;
      }

      for (const entry of entries) {
        if (ignoreList.has(entry.name)) continue;

        const fullPath = path.join(currentPath, entry.name);
        
        // Basic security check (will throw if escaping workspace)
        try {
          resolveAndVerifyPath(fullPath, rootPath);
        } catch {
          continue; 
        }

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (matches.length >= maxResults) {
            isTruncated = true;
            return;
          }

          try {
            const stats = await fs.stat(fullPath);
            if (stats.size > maxBytes) continue;

            // Check if binary
            const fd = await fs.open(fullPath, 'r');
            const buffer = Buffer.alloc(1024);
            const { bytesRead } = await fd.read(buffer, 0, 1024, 0);
            await fd.close();
            
            if (this.isBinaryString(buffer.subarray(0, bytesRead))) continue;

            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxResults) {
                isTruncated = true;
                break;
              }
              const line = lines[i];
              regex.lastIndex = 0;
              const match = regex.exec(line);
              if (match) {
                matches.push({
                  path: path.relative(rootPath, fullPath),
                  line: i + 1,
                  column: match.index + 1,
                  preview: line.trim().substring(0, 200) // limit preview length
                });
              }
            }
          } catch (e) {
            // Ignore individual file read errors
          }
        }
      }
    }

    await walk(rootPath);

    return {
      matches,
      truncated: isTruncated
    };
  }
}
