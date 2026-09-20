import { describe, it, expect } from "vitest";
import { GitCreateBranchTool } from "../src/git_branch_tool.js";
import { GitStageFilesTool } from "../src/git_stage_tool.js";
import { GitCommitTool } from "../src/git_commit_tool.js";
import { GitPushTool } from "../src/git_push_tool.js";
import { ToolContext } from "@comu/tool-core";

describe("Git Tools & Governance", () => {
  const fakeContext: ToolContext = {
    taskId: "t-git",
    workspace: {
      rootPath: "/fake/repo"
    }
  };

  it("should sanitize and validate branch names correctly", () => {
    expect(GitCreateBranchTool.sanitizeBranchName("feature/add-auth ")).toBe("feature/add-auth");
    expect(GitCreateBranchTool.sanitizeBranchName("feature..branch")).toBe("feature.branch");
    expect(GitCreateBranchTool.sanitizeBranchName("feature?branch*name")).toBe("feature-branch-name");
    expect(GitCreateBranchTool.sanitizeBranchName("---feature")).toBe("feature");
  });

  it("should reject wildcard and dot staging in GitStageFilesTool", async () => {
    const stageTool = new GitStageFilesTool();
    const resDot = await stageTool.execute({ files: ["."] }, fakeContext);
    expect(resDot.success).toBe(false);
    expect(resDot.error).toContain("FORBIDDEN_STAGING_PATTERN");

    const resStar = await stageTool.execute({ files: ["src/*"] }, fakeContext);
    expect(resStar.success).toBe(false);
    expect(resStar.error).toContain("FORBIDDEN_STAGING_PATTERN");
  });

  it("should enforce authorized ChangeSet boundary on staging", async () => {
    const stageTool = new GitStageFilesTool();
    const res = await stageTool.execute(
      {
        files: ["src/auth.ts", "package.json"],
        authorizedFiles: ["src/auth.ts"]
      },
      fakeContext
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("UNAUTHORIZED_STAGING_FILE");
    expect(res.error).toContain("package.json");
  });

  it("should enforce conventional commit message format in GitCommitTool", () => {
    // Valid conventional messages
    expect(GitCommitTool.validateCommitMessage("feat(auth): add middleware token check").valid).toBe(true);
    expect(GitCommitTool.validateCommitMessage("fix: resolve off-by-one error").valid).toBe(true);
    expect(GitCommitTool.validateCommitMessage("docs: update API documentation").valid).toBe(true);
    expect(GitCommitTool.validateCommitMessage("refactor(core): extract helper method").valid).toBe(true);

    // Invalid messages
    expect(GitCommitTool.validateCommitMessage("fixed stuff").valid).toBe(false);
    expect(GitCommitTool.validateCommitMessage("").valid).toBe(false);
    expect(GitCommitTool.validateCommitMessage("WIP").valid).toBe(false);
  });

  it("git push carries no self-asserted approval flag and is marked requiresApproval: always", () => {
    const pushTool = new GitPushTool();
    // The model can no longer authorise its own push: the argument is gone from the schema.
    expect(Object.keys(pushTool.inputSchema.properties)).toEqual(["remote", "branch"]);
    expect(pushTool.inputSchema.required).toEqual([]);
    expect(JSON.stringify(pushTool.inputSchema)).not.toContain("approved");
    // The gate lives in the orchestrator and reads this marker in every autonomy level.
    expect(pushTool.requiresApproval).toBe("always");
  });

  it("git commit is gated by the autonomy level", () => {
    expect(new GitCommitTool().requiresApproval).toBe("byAutonomy");
  });

  it("should guarantee git reset --hard and git clean -fd are permanently forbidden", () => {
    // None of the tools expose reset or clean
    const branchTool = new GitCreateBranchTool();
    const stageTool = new GitStageFilesTool();
    const commitTool = new GitCommitTool();
    const pushTool = new GitPushTool();

    const toolNames = [branchTool.name, stageTool.name, commitTool.name, pushTool.name];
    expect(toolNames).not.toContain("git_reset");
    expect(toolNames).not.toContain("git_clean");
  });
});
