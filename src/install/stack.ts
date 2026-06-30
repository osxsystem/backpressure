import { join } from "node:path";
import {
  detectPackageManager,
  type InstallIo,
  nodeInstallIo,
  type PackageManager,
} from "./init.js";

export type StackKind = "rust" | "node" | "unknown";
export type TestRunner = "vitest" | "jest" | "node";
export type Linter = "biome" | "eslint" | "none";

/** A detected project toolchain, enough to emit a tuned gate. */
export interface StackProfile {
  kind: StackKind;
  pm?: PackageManager; // node-only; already includes "bun"
  testRunner?: TestRunner;
  hasTsconfig?: boolean;
  hasBuildScript?: boolean;
  linter?: Linter;
}

/** True when `path` is readable (the codebase's "readText succeeds = present" probe). */
async function exists(path: string, io: InstallIo): Promise<boolean> {
  try {
    await io.readText(path);
    return true;
  } catch {
    return false;
  }
}

interface NodePkg {
  scripts?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  packageManager?: unknown;
}

function readDeps(pkg: NodePkg): Record<string, unknown> {
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

function detectRunner(pkg: NodePkg): TestRunner {
  const deps = readDeps(pkg);
  const testScript = typeof pkg.scripts?.test === "string" ? pkg.scripts.test : "";
  if ("vitest" in deps || testScript.includes("vitest")) return "vitest";
  if ("jest" in deps || testScript.includes("jest")) return "jest";
  return "node";
}

function detectLinter(pkg: NodePkg): Linter {
  const deps = readDeps(pkg);
  if ("@biomejs/biome" in deps || "biome" in deps) return "biome";
  if ("eslint" in deps) return "eslint";
  return "none";
}

/**
 * Detect the project's stack from repo signals (first match wins): a `Cargo.toml`
 * → Rust; else a `package.json` → Node (with pm/runner/linter/tsconfig/build
 * details); else `unknown`. Pure but for the injected {@link InstallIo}; never
 * throws (a bad/unreadable package.json degrades to `unknown`).
 */
export async function detectStack(
  repoDir: string,
  io: InstallIo = nodeInstallIo,
): Promise<StackProfile> {
  if (await exists(join(repoDir, "Cargo.toml"), io)) {
    return { kind: "rust" };
  }
  let pkg: NodePkg | null = null;
  try {
    pkg = JSON.parse(await io.readText(join(repoDir, "package.json"))) as NodePkg;
  } catch {
    pkg = null;
  }
  if (pkg === null) return { kind: "unknown" };

  return {
    kind: "node",
    pm: await detectPackageManager(repoDir, io, pkg),
    testRunner: detectRunner(pkg),
    hasTsconfig: await exists(join(repoDir, "tsconfig.json"), io),
    hasBuildScript: typeof pkg.scripts?.build === "string",
    linter: detectLinter(pkg),
  };
}
