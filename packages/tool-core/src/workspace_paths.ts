import * as path from "path";
import * as fs from "fs";
import { PermissionError } from "@comu/shared";

/**
 * The single workspace boundary implementation.
 *
 * There used to be two: the filesystem tools did this correctly with `path.relative`, while the
 * terminal tool used `normalize(cwd).startsWith(normalize(root))`, which admits a sibling
 * directory that merely shares a name prefix (`/home/me/proj` admitting `/home/me/proj-evil`).
 * One boundary, used everywhere, is the only way that stays true.
 */

/** True when `target` is inside `root`. Prefix-safe: a shared name prefix is not containment. */
export function isInsideWorkspace(target: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot) return true;
  const relative = path.relative(resolvedRoot, resolvedTarget);
  // "" is the root itself; ".." escapes; an absolute result means a different drive on Windows.
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Resolves a path against the workspace root and refuses anything outside it, including through a
 * symlink. Throws `PermissionError` rather than returning a boolean, so a caller cannot forget to
 * check the result.
 */
export function resolveAndVerifyPath(requestPath: string, workspaceRoot: string): string {
  const root = path.resolve(workspaceRoot);

  const targetPath = path.normalize(
    path.isAbsolute(requestPath) ? path.resolve(requestPath) : path.resolve(root, requestPath)
  );

  if (!isInsideWorkspace(targetPath, root)) {
    throw new PermissionError(`Access denied: Path ${requestPath} resolves outside workspace boundary`);
  }

  // Symlinks are resolved so a link inside the workspace cannot point out of it.
  try {
    if (fs.existsSync(targetPath)) {
      const realPath = fs.realpathSync(targetPath);
      const realRoot = fs.realpathSync(root);
      if (!isInsideWorkspace(realPath, realRoot)) {
        throw new PermissionError("Access denied: Symlink resolves outside workspace boundary");
      }
    }
  } catch (e: any) {
    if (e instanceof PermissionError) throw e;
    throw new PermissionError(`Failed to verify path security: ${e.message}`);
  }

  return targetPath;
}
