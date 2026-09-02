import { CommandPlan } from '@comu/terminal';
import { ValidationContext, ProjectType } from './types';
import { ProjectDetector } from './project_detector';
import * as fs from 'fs';
import * as path from 'path';

export class CommandResolver {
  public static resolve(context: ValidationContext): CommandPlan | null {
    const projectType = ProjectDetector.detect(context.cwd);

    if (projectType === "Node" || projectType === "TypeScript") {
      return this.resolveNodeTarget(context);
    }
    if (projectType === "Python") {
      if (context.target === "test") return { executable: "pytest", args: [], cwd: context.cwd, source: "VALIDATION" };
      if (context.target === "lint") return { executable: "flake8", args: [], cwd: context.cwd, source: "VALIDATION" };
      if (context.target === "typecheck") return { executable: "mypy", args: ["."], cwd: context.cwd, source: "VALIDATION" };
    }
    if (projectType === "Go") {
      if (context.target === "test") return { executable: "go", args: ["test", "./..."], cwd: context.cwd, source: "VALIDATION" };
      if (context.target === "build") return { executable: "go", args: ["build", "./..."], cwd: context.cwd, source: "VALIDATION" };
      if (context.target === "lint") return { executable: "golangci-lint", args: ["run"], cwd: context.cwd, source: "VALIDATION" };
    }
    if (projectType === "Rust") {
      if (context.target === "test") return { executable: "cargo", args: ["test"], cwd: context.cwd, source: "VALIDATION" };
      if (context.target === "build") return { executable: "cargo", args: ["build"], cwd: context.cwd, source: "VALIDATION" };
      if (context.target === "lint") return { executable: "cargo", args: ["clippy"], cwd: context.cwd, source: "VALIDATION" };
      if (context.target === "typecheck") return { executable: "cargo", args: ["check"], cwd: context.cwd, source: "VALIDATION" };
    }

    return null;
  }

  private static resolveNodeTarget(context: ValidationContext): CommandPlan | null {
    const pkgPath = path.join(context.cwd, 'package.json');
    let pkg: any;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      return null;
    }

    const scripts = pkg.scripts || {};
    let scriptToRun: string | null = null;

    if (context.target === "test" && scripts["test"]) scriptToRun = "test";
    else if (context.target === "build" && scripts["build"]) scriptToRun = "build";
    else if (context.target === "lint" && scripts["lint"]) scriptToRun = "lint";
    else if (context.target === "typecheck") {
      if (scripts["typecheck"]) scriptToRun = "typecheck";
      else if (scripts["build"]) scriptToRun = "build";
    }

    // Determine package manager
    let pm = "npm";
    if (fs.existsSync(path.join(context.cwd, 'pnpm-lock.yaml'))) pm = "pnpm";
    else if (fs.existsSync(path.join(context.cwd, 'yarn.lock'))) pm = "yarn";

    if (process.platform === 'win32') pm += '.cmd';

    if (scriptToRun) {
      return {
        executable: pm,
        args: ["run", scriptToRun],
        cwd: context.cwd,
        source: "VALIDATION",
        category: "SAFE_DEVELOPMENT"
      };
    }

    // Fallbacks
    if (context.target === "typecheck" && fs.existsSync(path.join(context.cwd, 'tsconfig.json'))) {
      return { executable: "tsc", args: ["--noEmit"], cwd: context.cwd, source: "VALIDATION", category: "SAFE_DEVELOPMENT" };
    }
    
    return null;
  }
}
