"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandResolver = void 0;
const project_detector_1 = require("./project_detector");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class CommandResolver {
    static resolve(context) {
        const projectType = project_detector_1.ProjectDetector.detect(context.cwd);
        if (projectType === "Node" || projectType === "TypeScript") {
            return this.resolveNodeTarget(context);
        }
        if (projectType === "Python") {
            if (context.target === "test")
                return { executable: "pytest", args: [], cwd: context.cwd, source: "VALIDATION" };
            if (context.target === "lint")
                return { executable: "flake8", args: [], cwd: context.cwd, source: "VALIDATION" };
            if (context.target === "typecheck")
                return { executable: "mypy", args: ["."], cwd: context.cwd, source: "VALIDATION" };
        }
        if (projectType === "Go") {
            if (context.target === "test")
                return { executable: "go", args: ["test", "./..."], cwd: context.cwd, source: "VALIDATION" };
            if (context.target === "build")
                return { executable: "go", args: ["build", "./..."], cwd: context.cwd, source: "VALIDATION" };
            if (context.target === "lint")
                return { executable: "golangci-lint", args: ["run"], cwd: context.cwd, source: "VALIDATION" };
        }
        if (projectType === "Rust") {
            if (context.target === "test")
                return { executable: "cargo", args: ["test"], cwd: context.cwd, source: "VALIDATION" };
            if (context.target === "build")
                return { executable: "cargo", args: ["build"], cwd: context.cwd, source: "VALIDATION" };
            if (context.target === "lint")
                return { executable: "cargo", args: ["clippy"], cwd: context.cwd, source: "VALIDATION" };
            if (context.target === "typecheck")
                return { executable: "cargo", args: ["check"], cwd: context.cwd, source: "VALIDATION" };
        }
        return null;
    }
    static resolveNodeTarget(context) {
        const pkgPath = path.join(context.cwd, 'package.json');
        let pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        }
        catch {
            return null;
        }
        const scripts = pkg.scripts || {};
        let scriptToRun = null;
        if (context.target === "test" && scripts["test"])
            scriptToRun = "test";
        else if (context.target === "build" && scripts["build"])
            scriptToRun = "build";
        else if (context.target === "lint" && scripts["lint"])
            scriptToRun = "lint";
        else if (context.target === "typecheck") {
            if (scripts["typecheck"])
                scriptToRun = "typecheck";
            else if (scripts["build"])
                scriptToRun = "build";
        }
        // Determine package manager
        let pm = "npm";
        if (fs.existsSync(path.join(context.cwd, 'pnpm-lock.yaml')))
            pm = "pnpm";
        else if (fs.existsSync(path.join(context.cwd, 'yarn.lock')))
            pm = "yarn";
        if (process.platform === 'win32')
            pm += '.cmd';
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
exports.CommandResolver = CommandResolver;
//# sourceMappingURL=command_resolver.js.map