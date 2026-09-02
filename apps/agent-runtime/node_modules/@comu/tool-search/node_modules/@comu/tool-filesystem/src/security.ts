import * as path from "path";
import * as fs from "fs";
import { PermissionError } from "@comu/shared";

export function resolveAndVerifyPath(requestPath: string, workspaceRoot: string): string {
  // Ensure workspaceRoot is absolute
  const root = path.resolve(workspaceRoot);
  
  // Resolve the requested path against the workspace root
  // If requestPath is absolute, path.resolve will ignore workspaceRoot unless we handle it carefully.
  // We want to force all paths to be relative to workspaceRoot or already inside it.
  
  let targetPath = requestPath;
  if (!path.isAbsolute(requestPath)) {
    targetPath = path.resolve(root, requestPath);
  } else {
    targetPath = path.resolve(requestPath);
  }

  // Normalize path to handle ../ and platform specifics
  targetPath = path.normalize(targetPath);

  // Check if target is inside root
  const relative = path.relative(root, targetPath);
  
  // If relative path starts with '..' or is an absolute path (on Windows different drive), it's outside.
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PermissionError(`Access denied: Path ${requestPath} resolves outside workspace boundary`);
  }

  // Verify realpath to prevent symlink escapes
  try {
    if (fs.existsSync(targetPath)) {
      const realPath = fs.realpathSync(targetPath);
      const realRoot = fs.realpathSync(root);
      const realRelative = path.relative(realRoot, realPath);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new PermissionError(`Access denied: Symlink resolves outside workspace boundary`);
      }
    }
  } catch (e: any) {
    // If realpath fails (e.g. permission error reading link), reject
    throw new PermissionError(`Failed to verify path security: ${e.message}`);
  }

  return targetPath;
}
