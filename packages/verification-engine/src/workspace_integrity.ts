import { WorkspaceIntegrityResult, WorkspaceIntegrityStatus } from "@comu/protocol";
import { ChangeSet } from "@comu/diff-engine";
import { ToolExecutor, ToolContext } from "@comu/tool-core";

export class WorkspaceIntegrityVerifier {
  public static async verifyIntegrity(
    changeSet: ChangeSet | undefined,
    executor: ToolExecutor,
    ctx: ToolContext
  ): Promise<WorkspaceIntegrityResult> {
    const checkedAt = new Date().toISOString();

    if (!changeSet || changeSet.changes.size === 0) {
      // Clean state, no mutations recorded
      return {
        status: "VERIFIED",
        details: "No active changes recorded in ChangeSet.",
        checkedAt
      };
    }

    const conflicts: string[] = [];

    for (const [path, record] of changeSet.changes.entries()) {
      try {
        const readResult = (await executor.execute("read_file", { path }, ctx)) as any;
        const currentHash = readResult?.hash;

        if (record.newHash && currentHash !== record.newHash) {
          conflicts.push(
            `File '${path}' hash mismatch: recorded '${record.newHash}', current '${currentHash}'`
          );
        }
      } catch (err: any) {
        conflicts.push(`File '${path}' could not be read to verify integrity: ${err.message}`);
      }
    }

    if (conflicts.length > 0) {
      return {
        status: "CHANGED_EXTERNALLY",
        details: `Workspace integrity violation detected in ${conflicts.length} file(s).`,
        conflicts,
        checkedAt
      };
    }

    return {
      status: "VERIFIED",
      details: `Verified integrity for ${changeSet.changes.size} modified file(s).`,
      checkedAt
    };
  }
}
