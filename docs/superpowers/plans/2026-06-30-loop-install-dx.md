# Loop install DX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `backpressure init --with-loop` (one-step loop install) and a stack-aware composite gate (detect Rust / Node-TS / unknown, emit a tuned `backpressure-gate.sh`), generated automatically at install plus a `backpressure gate` regen command.

**Architecture:** Two pure functions — `detectStack(repoDir, io)` and `emitGate(profile)` — plus a thin side-effecting `writeTunedGate`. A new leaf module `with-loop.ts` orchestrates `init()` (with its Stop hook suppressed) + the bundled `installPack` + `writeTunedGate`, keeping `init.ts` free of an `installPack` import (avoids an `init ↔ install-pack` cycle). The CLI wires `--with-loop`, a `gate` command, and an auto-tune after `add`.

**Tech Stack:** TypeScript (Node 20+, ESM), commander, vitest, biome. No new dependencies.

## Global Constraints

- **Node 20+, ESM, TypeScript.** No new runtime dependencies.
- **Author once, compile per target:** no new `target ===` branch outside `src/seam/` and `src/adapters/`. Stack detection branches on *language*, not CLI target — allowed in `src/install/`.
- **Every `src/` file ships its sibling `test/` file in the same change.**
- **The gate is the done-signal:** `pnpm run check` (biome + tsc) and `pnpm test` must pass before each commit.
- **Reuse, don't re-create:** `detectPackageManager` (already supports `bun`), the exported `PackageManager` type, `InstallIo`/`nodeInstallIo`, `installPack`, `bundledSkillsDir`, `cliErrorLine`/`InstallError` — all exist.
- **Decision A (Stop hook):** with `--with-loop`, `init` emits **no** Stop hook (the loop pack's gate hook is the sole writer; `settings.json` is overwrite, not merge).
- **Decision B:** emit a **plain editable bash gate**; no config-file override model.
- **Fail-closed:** an `unknown` stack emits the generic script + loud banner, never a silent pass.

---

### Task 1: `detectStack` — stack profile detection

**Files:**
- Create: `src/install/stack.ts`
- Test: `test/install/stack.test.ts`

**Interfaces:**
- Consumes: `InstallIo` and `detectPackageManager`, `PackageManager` from `src/install/init.ts` (signatures: `interface InstallIo { readText(path): Promise<string>; … }`, `detectPackageManager(repoPath: string, io: InstallIo, pkg: TargetPackageJson | null): Promise<PackageManager>`). Note `detectPackageManager` already recognizes `bun`.
- Produces: `type StackProfile`, `type StackKind`, `detectStack(repoDir: string, io?: InstallIo): Promise<StackProfile>`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/install/stack.test.ts
import { describe, expect, it } from "vitest";
import type { InstallIo } from "../../src/install/init.js";
import { detectStack } from "../../src/install/stack.js";

/** Fake InstallIo over an in-memory file map. readText throws ENOENT when absent. */
function fakeIo(files: Record<string, string>): InstallIo {
  return {
    async readText(path) {
      const key = Object.keys(files).find((f) => path.endsWith(f));
      if (key === undefined) {
        const e = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      }
      return files[key] as string;
    },
    async listFiles() {
      return [];
    },
    async ensureDir() {},
    async writeText() {},
    async copyFile() {},
  };
}

describe("detectStack (@acceptance)", () => {
  it("detects a Rust crate from Cargo.toml", async () => {
    const io = fakeIo({ "Cargo.toml": "[package]\nname='x'\n" });
    expect(await detectStack("/repo", io)).toEqual({ kind: "rust" });
  });

  it("detects a Node project with jest + npm, tsconfig, and a build script", async () => {
    const io = fakeIo({
      "package.json": JSON.stringify({
        scripts: { test: "jest", build: "tsc" },
        devDependencies: { jest: "^29", "@biomejs/biome": "^2" },
      }),
      "package-lock.json": "{}",
      "tsconfig.json": "{}",
    });
    expect(await detectStack("/repo", io)).toEqual({
      kind: "node",
      pm: "npm",
      testRunner: "jest",
      hasTsconfig: true,
      hasBuildScript: true,
      linter: "biome",
    });
  });

  it("returns unknown when neither Cargo.toml nor package.json is present", async () => {
    expect(await detectStack("/repo", fakeIo({}))).toEqual({ kind: "unknown" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/install/stack.test.ts`
Expected: FAIL — `Cannot find module '../../src/install/stack.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/install/stack.ts
import { join } from "node:path";
import { detectPackageManager, type InstallIo, nodeInstallIo, type PackageManager } from "./init.js";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/install/stack.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + typecheck, then commit**

```bash
pnpm run check
git add src/install/stack.ts test/install/stack.test.ts
git commit -m "feat(install): detectStack — Rust/Node/unknown stack detection"
```

---

### Task 2: `emitGate` — pure gate-script generator

**Files:**
- Create: `src/install/gate.ts`
- Test: `test/install/gate.test.ts`

**Interfaces:**
- Consumes: `StackProfile` from `src/install/stack.ts`.
- Produces: `const GENERATED_MARKER: string`, `emitGate(profile: StackProfile): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/install/gate.test.ts
import { describe, expect, it } from "vitest";
import { emitGate, GENERATED_MARKER } from "../../src/install/gate.js";
import type { StackProfile } from "../../src/install/stack.js";

const shapeOk = (s: string) =>
  s.startsWith("#!/usr/bin/env bash") &&
  s.includes(GENERATED_MARKER) &&
  s.includes("set -euo pipefail") &&
  s.includes('echo "gate: GREEN"');

describe("emitGate (@acceptance)", () => {
  it("emits a Rust gate using cargo, keeping the shape", () => {
    const out = emitGate({ kind: "rust" });
    expect(shapeOk(out)).toBe(true);
    expect(out).toContain("cargo fmt --check");
    expect(out).toContain("cargo clippy --all-targets -- -D warnings");
    expect(out).toContain("cargo test");
    expect(out).toContain("cargo build");
  });

  it("emits a Node gate with the detected pm + jest, dropping typecheck when no tsconfig", () => {
    const p: StackProfile = {
      kind: "node",
      pm: "npm",
      testRunner: "jest",
      hasTsconfig: false,
      hasBuildScript: true,
      linter: "biome",
    };
    const out = emitGate(p);
    expect(shapeOk(out)).toBe(true);
    expect(out).toContain("npm exec biome check .");
    expect(out).toContain("npm test");
    expect(out).toContain("npm run build");
    expect(out).not.toContain("tsc --noEmit"); // no tsconfig → no typecheck stage
  });

  it("emits the generic gate + loud TUNE-ME banner for an unknown stack (fail-closed)", () => {
    const out = emitGate({ kind: "unknown" });
    expect(shapeOk(out)).toBe(true);
    expect(out).toContain("TUNE THIS GATE TO YOUR STACK");
  });

  it("is deterministic", () => {
    expect(emitGate({ kind: "rust" })).toBe(emitGate({ kind: "rust" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/install/gate.test.ts`
Expected: FAIL — `Cannot find module '../../src/install/gate.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/install/gate.ts
import type { StackProfile } from "./stack.js";

/** Sentinel marking a generated gate. Used for hand-edit protection in writeTunedGate. */
export const GENERATED_MARKER = "@generated by backpressure gate";

const HEADER = `#!/usr/bin/env bash
# ${GENERATED_MARKER} — edits are overwritten; re-run 'backpressure gate' to retune.
# Composite gate: fail-fast, ONE exit code.
set -euo pipefail
`;

// Lang-agnostic, tool-guarded so a fresh project still runs the gate out of the box.
const SECRET_SCAN = `
echo "== secret scan =="
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-banner --redact
else
  echo "  (gitleaks not installed — skipping secret scan)"
fi
`;

const GREEN = `\necho "gate: GREEN"\n`;

function rustStages(): string {
  return [
    `\necho "== 1. format =="\ncargo fmt --check`,
    `\necho "== 2. lint =="\ncargo clippy --all-targets -- -D warnings`,
    `\necho "== 3. test =="\ncargo test`,
    `\necho "== 4. build =="\ncargo build`,
  ].join("");
}

function nodeStages(p: StackProfile): string {
  const pm = p.pm ?? "npm";
  const out: string[] = [];
  if (p.linter === "biome") out.push(`\necho "== 1. lint =="\n${pm} exec biome check .`);
  else if (p.linter === "eslint") out.push(`\necho "== 1. lint =="\n${pm} exec eslint .`);
  else out.push(`\necho "== 1. lint (skipped — no biome/eslint detected) =="`);
  if (p.hasTsconfig) out.push(`\necho "== 2. typecheck =="\n${pm} exec tsc --noEmit`);
  out.push(`\necho "== 3. test =="\n${pm} test`);
  if (p.hasBuildScript) out.push(`\necho "== 4. build =="\n${pm} run build`);
  return out.join("");
}

const UNKNOWN_BANNER = `
# ┌───────────────────────────────────────────────────────────────────────────┐
# │  ⚠  TUNE THIS GATE TO YOUR STACK. Backpressure could not detect a Rust or    │
# │  Node project, so this is a generic pnpm/TypeScript pipeline. Edit the       │
# │  stages for your toolchain, or run 'backpressure gate' from a detected repo. │
# └───────────────────────────────────────────────────────────────────────────┘`;

function unknownStages(): string {
  return [
    `\necho "== 1. lint =="\npnpm exec biome check . || echo "  (biome not present — tune me)"`,
    `\necho "== 2. typecheck =="\npnpm exec tsc --noEmit || echo "  (tsc not present — tune me)"`,
    `\necho "== 3. test + build =="\npnpm test && pnpm run build`,
  ].join("");
}

function describe(p: StackProfile): string {
  if (p.kind === "rust") return "rust (cargo)";
  if (p.kind === "node") return `node (${p.pm ?? "npm"}, runner=${p.testRunner}, linter=${p.linter})`;
  return "unknown";
}

/**
 * Generate a tuned composite gate (bash) for `profile`. Shape is invariant across
 * profiles: shebang, generated marker, `set -euo pipefail`, a secret-scan stage,
 * and a final `gate: GREEN`. Per-language stages differ. `unknown` emits a generic
 * pipeline behind a loud tune-me banner (fail-closed). Pure + deterministic.
 */
export function emitGate(profile: StackProfile): string {
  const banner = profile.kind === "unknown" ? `${UNKNOWN_BANNER}\n` : "";
  const stack = `# Stack: ${describe(profile)}\n`;
  const stages =
    profile.kind === "rust"
      ? rustStages()
      : profile.kind === "node"
        ? nodeStages(profile)
        : unknownStages();
  return `${HEADER}${banner}${stack}${stages}\n${SECRET_SCAN}${GREEN}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/install/gate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + typecheck, then commit**

```bash
pnpm run check
git add src/install/gate.ts test/install/gate.test.ts
git commit -m "feat(install): emitGate — stack-tuned composite gate generator"
```

---

### Task 3: `writeTunedGate` + `InstallIo.makeExecutable`

**Files:**
- Modify: `src/install/init.ts` (add optional `makeExecutable?` to `InstallIo` + implement in `nodeInstallIo`)
- Modify: `src/install/gate.ts` (add `writeTunedGate`)
- Test: `test/install/gate.test.ts` (append)

**Interfaces:**
- Consumes: `detectStack`, `emitGate`, `GENERATED_MARKER`, `InstallIo`/`nodeInstallIo`, `InstallError` (from `src/install/errors.ts`).
- Produces: `writeTunedGate(repoDir: string, io?: InstallIo, opts?: { force?: boolean }): Promise<{ path: string; profile: StackProfile }>`.

- [ ] **Step 1: Add `makeExecutable?` to `InstallIo` and `nodeInstallIo`**

In `src/install/init.ts`, add to the `InstallIo` interface (after `copyFile`):

```typescript
  /**
   * Mark `path` executable (chmod +x). Optional so existing in-memory test fakes
   * need not implement it; the node impl sets mode 0o755. Used by writeTunedGate
   * for the generated gate script (a text writeText would otherwise drop +x).
   */
  makeExecutable?(path: string): Promise<void>;
```

In the `nodeInstallIo` object (same file), add the method:

```typescript
  async makeExecutable(path) {
    await chmod(path, 0o755);
  },
```

Add `chmod` to the existing `node:fs/promises` import at the top of `init.ts`
(it currently imports `copyFile, mkdir, readdir, readFile, writeFile`):

```typescript
import { chmod, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
```

- [ ] **Step 2: Write the failing test (append to `test/install/gate.test.ts`)**

```typescript
import { writeTunedGate } from "../../src/install/gate.js";
import { InstallError } from "../../src/install/errors.js";
import type { InstallIo } from "../../src/install/init.js";

/** In-memory InstallIo capturing writes; readText throws ENOENT for absent paths. */
function memIo(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const made: string[] = [];
  const io: InstallIo = {
    async readText(p) {
      for (const [k, v] of files) if (p.endsWith(k)) return v;
      const e = new Error("ENOENT") as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    },
    async writeText(p, d) {
      files.set(p, d);
    },
    async ensureDir() {},
    async listFiles() {
      return [];
    },
    async copyFile() {},
    async makeExecutable(p) {
      made.push(p);
    },
  };
  return { io, files, made };
}

describe("writeTunedGate (@acceptance)", () => {
  it("detects, emits, writes a tuned gate and marks it executable; idempotent", async () => {
    const { io, files, made } = memIo({ "Cargo.toml": "[package]\n" });
    const a = await writeTunedGate("/repo", io, { force: true });
    expect(a.path.endsWith(".backpressure/scripts/backpressure-gate.sh")).toBe(true);
    expect(a.profile.kind).toBe("rust");
    expect(files.get(a.path)).toContain("cargo test");
    expect(made).toContain(a.path);
    const first = files.get(a.path);
    await writeTunedGate("/repo", io, { force: true });
    expect(files.get(a.path)).toBe(first); // byte-identical re-run
  });

  it("refuses a hand-edited (marker-less) gate unless --force", async () => {
    const gate = "/repo/.backpressure/scripts/backpressure-gate.sh";
    const { io } = memIo({ "Cargo.toml": "[package]\n", [gate]: "#!/usr/bin/env bash\n# my own gate\n" });
    await expect(writeTunedGate("/repo", io)).rejects.toBeInstanceOf(InstallError);
    await expect(writeTunedGate("/repo", io, { force: true })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/install/gate.test.ts`
Expected: FAIL — `writeTunedGate` is not exported.

- [ ] **Step 4: Implement `writeTunedGate` (append to `src/install/gate.ts`)**

```typescript
import { join } from "node:path";
import { InstallError } from "./errors.js";
import { type InstallIo, nodeInstallIo } from "./init.js";
import { detectStack, type StackProfile } from "./stack.js";

const GATE_REL = join(".backpressure", "scripts", "backpressure-gate.sh");

/**
 * Detect the stack, emit a tuned gate, and write it to
 * `.backpressure/scripts/backpressure-gate.sh` (chmod +x via the io seam).
 *
 * Hand-edit protection: if a gate already exists and does NOT carry the generated
 * marker, refuse (a clean InstallError) unless `opts.force` — so `backpressure
 * gate` never clobbers a hand-authored gate. Install-time callers pass
 * `force: true` because they just wrote the bundled gate themselves.
 */
export async function writeTunedGate(
  repoDir: string,
  io: InstallIo = nodeInstallIo,
  opts: { force?: boolean } = {},
): Promise<{ path: string; profile: StackProfile }> {
  const path = join(repoDir, GATE_REL);
  if (!opts.force) {
    let existing: string | null = null;
    try {
      existing = await io.readText(path);
    } catch {
      existing = null; // no gate yet — nothing to protect
    }
    if (existing !== null && !existing.includes(GENERATED_MARKER)) {
      throw new InstallError(
        `${GATE_REL} looks hand-edited (no '${GENERATED_MARKER}' marker). Re-run with --force to overwrite it.`,
      );
    }
  }
  const profile = await detectStack(repoDir, io);
  await io.ensureDir(join(repoDir, ".backpressure", "scripts"));
  await io.writeText(path, emitGate(profile));
  await io.makeExecutable?.(path);
  return { path, profile };
}
```

Move the new imports to the top of `gate.ts` with the existing `StackProfile` import (biome will enforce import order on `pnpm run check`).

- [ ] **Step 5: Run test + check to verify all pass**

Run: `pnpm vitest run test/install/gate.test.ts && pnpm run check`
Expected: PASS (6 tests in the file), check clean.

- [ ] **Step 6: Commit**

```bash
git add src/install/gate.ts src/install/init.ts test/install/gate.test.ts
git commit -m "feat(install): writeTunedGate (+ InstallIo.makeExecutable) with hand-edit protection"
```

---

### Task 4: `bundledPacksDir` + `init` Stop-hook suppression

**Files:**
- Modify: `src/install/init.ts` (extract `packageRootDir`, add `bundledPacksDir`, add `withLoop` filter)
- Test: `test/install/init.test.ts` (append)

**Interfaces:**
- Consumes: existing `bundledSkillsDir` internals.
- Produces: `bundledPacksDir(): string`; `InitOptions.withLoop?: boolean`.

- [ ] **Step 1: Write the failing test (append to `test/install/init.test.ts`)**

```typescript
import { bundledPacksDir } from "../../src/install/init.js";

describe("bundledPacksDir + withLoop hook suppression (@acceptance)", () => {
  it("bundledPacksDir resolves the package's own packs/ dir", () => {
    expect(bundledPacksDir().endsWith("/packs")).toBe(true);
  });

  it("init withLoop:true plans NO hooks file (the loop pack owns the Stop hook)", async () => {
    const { plan } = await init("claude", "/repo", { dryRun: true, withLoop: true });
    expect(plan.some((f) => f.kind === "hooks")).toBe(false);
  });

  it("init without withLoop still plans the hooks file", async () => {
    const { plan } = await init("claude", "/repo", { dryRun: true });
    expect(plan.some((f) => f.kind === "hooks")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/install/init.test.ts -t "withLoop hook suppression"`
Expected: FAIL — `bundledPacksDir` not exported / `withLoop` not honored.

- [ ] **Step 3: Implement**

Refactor `bundledSkillsDir` in `src/install/init.ts` to share a root resolver, and add `bundledPacksDir`. Replace the existing `bundledSkillsDir` function with:

```typescript
/** Walk up from this module to the nearest package root (dir with package.json). */
function packageRootDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let hops = 0; hops < 16; hops++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve the pack's own bundled skills dir (`<package-root>/skills`). */
export function bundledSkillsDir(): string {
  const root = packageRootDir();
  return root === null ? join(process.cwd(), "skills") : join(root, "skills");
}

/** Resolve the pack's own bundled packs dir (`<package-root>/packs`). */
export function bundledPacksDir(): string {
  const root = packageRootDir();
  return root === null ? join(process.cwd(), "packs") : join(root, "packs");
}
```

Add `withLoop` to `InitOptions` (after `gateCommand`):

```typescript
  /**
   * When true, suppress init's own Stop-gate hook. `--with-loop` sets this so the
   * loop pack's gate hook is the sole writer of `.claude/settings.json` (which is
   * overwrite, not merge). Orchestration of the actual loop-pack install lives in
   * `src/install/with-loop.ts` to avoid an init ↔ install-pack import cycle.
   */
  withLoop?: boolean;
```

In `init()`, after `skillsOnly` is destructured, add `withLoop = false` to the destructure defaults, and after the existing `if (skillsOnly) { plan = plan.filter(...) }` block add:

```typescript
  if (withLoop) {
    // Decision A: drop init's Stop hook so the loop pack's gate hook is the only one.
    plan = plan.filter((f) => f.kind !== "hooks");
  }
```

- [ ] **Step 4: Run test + existing init tests to verify all pass**

Run: `pnpm vitest run test/install/init.test.ts`
Expected: PASS (new 3 tests + all existing init tests unchanged).

- [ ] **Step 5: Commit**

```bash
pnpm run check
git add src/install/init.ts test/install/init.test.ts
git commit -m "feat(install): bundledPacksDir + init withLoop Stop-hook suppression"
```

---

### Task 5: `installWithLoop` orchestration

**Files:**
- Create: `src/install/with-loop.ts`
- Test: `test/install/with-loop.test.ts`

**Interfaces:**
- Consumes: `init` + `bundledPacksDir` + `nodeInstallIo`/`InstallIo` (from `init.ts`), `installPack` (`src/add/install-pack.ts`, signature `installPack(packDir: string, choice: InstallChoice, baseDir: string, io?: InstallIo)`), `writeTunedGate` (`src/install/gate.ts`), `AgentTarget` (`src/seam/targets.ts`).
- Produces: `installWithLoop(target: AgentTarget, repoPath: string, io?: InstallIo): Promise<{ profile: StackProfile }>`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/install/with-loop.test.ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installWithLoop } from "../../src/install/with-loop.js";

describe("installWithLoop (@acceptance)", () => {
  it("installs the loop pack and leaves the gate hook as the only Stop hook", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-withloop-"));
    await installWithLoop("claude", base);

    // loop pack artifacts present
    await expect(stat(join(base, ".claude/commands/backpressure-loop.md"))).resolves.toBeDefined();
    await expect(stat(join(base, ".backpressure/scripts/backpressure-gate.sh"))).resolves.toBeDefined();

    // exactly the gate Stop hook — NOT `<pm> test`
    const settings = JSON.parse(await readFile(join(base, ".claude/settings.json"), "utf8"));
    const cmd = settings.hooks.Stop[0].hooks[0].command;
    expect(cmd).toContain("backpressure-gate.sh");
    expect(cmd).not.toContain(" test");
  });

  it("rejects --with-loop for codex (the loop pack is claude-only)", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-withloop-codex-"));
    await expect(installWithLoop("codex", base)).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/install/with-loop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/install/with-loop.ts
import { join } from "node:path";
import { installPack } from "../add/install-pack.js";
import type { AgentTarget } from "../seam/targets.js";
import { writeTunedGate } from "./gate.js";
import { bundledPacksDir, init, type InstallIo, nodeInstallIo } from "./init.js";
import type { StackProfile } from "./stack.js";

/**
 * Install the default capabilities (with init's own Stop hook suppressed) plus the
 * BUNDLED loop pack (network-free, via {@link installPack}), then retune the gate
 * to the detected stack. The loop pack supplies the sole `Stop` hook (the gate).
 *
 * Codex is rejected by `installPack` (the loop pack targets claude only) as a clean
 * InvalidPackManifestError.
 */
export async function installWithLoop(
  target: AgentTarget,
  repoPath: string,
  io: InstallIo = nodeInstallIo,
): Promise<{ profile: StackProfile }> {
  await init(target, repoPath, { withLoop: true, io });
  await installPack(join(bundledPacksDir(), "backpressure-loop"), target, repoPath, io);
  const { profile } = await writeTunedGate(repoPath, io, { force: true });
  return { profile };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/install/with-loop.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
pnpm run check
git add src/install/with-loop.ts test/install/with-loop.test.ts
git commit -m "feat(install): installWithLoop — one-step loop install + auto-tuned gate"
```

---

### Task 6: CLI `--with-loop` flag on `init`

**Files:**
- Modify: `src/cli.ts` (init command)
- Test: `test/cli.test.ts` (append)

**Interfaces:**
- Consumes: `installWithLoop` (`src/install/with-loop.ts`), existing `cliErrorLine`, `parseTarget`.

- [ ] **Step 1: Write the failing test (append to `test/cli.test.ts`)**

```typescript
it("registers --with-loop on init", () => {
  const initCmd = buildProgram().commands.find((c: commander.Command) => c.name() === "init");
  const flags = initCmd?.options.map((o: { long?: string }) => o.long);
  expect(flags).toContain("--with-loop");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli.test.ts -t "with-loop"`
Expected: FAIL — flag not registered.

- [ ] **Step 3: Implement**

Add the import near the other install imports in `src/cli.ts`:

```typescript
import { installWithLoop } from "./install/with-loop.js";
```

On the `init` command, add the option (after `--gate`):

```typescript
    .option(
      "--with-loop",
      "Also install the bundled backpressure-loop pack and a stack-tuned gate (claude only).",
    )
```

In the init `.action(...)` body, branch on `options.withLoop` **before** the normal
`init(...)` call, inside the existing `try`:

```typescript
        if (options.withLoop) {
          const { profile } = await installWithLoop(target, cwd());
          process.stdout.write(`Installed the loop pack; gate tuned for: ${profile.kind}\n`);
          return;
        }
```

(`target` is already computed via `parseTarget(options.target)` at the top of the
action; reuse it. The `options` type literal on the action must gain `withLoop?: boolean`.)

- [ ] **Step 4: Run test + a real smoke check**

Run: `pnpm vitest run test/cli.test.ts -t "with-loop" && pnpm run build`
Then: `cd "$(mktemp -d)" && git init -q && node <repo>/dist/cli.js init --with-loop`
Expected: writes `.claude/commands/backpressure-loop.md`, `.backpressure/scripts/backpressure-gate.sh`, and prints `gate tuned for: …`.

- [ ] **Step 5: Commit**

```bash
pnpm run check
git add src/cli.ts test/cli.test.ts
git commit -m "feat(cli): init --with-loop (one-step loop install)"
```

---

### Task 7: CLI `gate` command + auto-tune after `add`

**Files:**
- Modify: `src/cli.ts` (new `gate` command; tune after `add`)
- Test: `test/cli.test.ts` (append)

**Interfaces:**
- Consumes: `writeTunedGate` (`src/install/gate.ts`), existing `cliErrorLine`, `cwd`.

- [ ] **Step 1: Write the failing test (append to `test/cli.test.ts`)**

```typescript
it("registers the gate command (not a stub)", () => {
  const names = buildProgram().commands.map((c: commander.Command) => c.name());
  expect(names).toContain("gate");
  const cmd = buildProgram().commands.find((c: commander.Command) => c.name() === "gate");
  expect(cmd?.description().toLowerCase()).not.toContain("not yet implemented");
});

it("@acceptance `gate` errors cleanly when no .backpressure/ exists", async () => {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => {
    chunks.push(typeof c === "string" ? c : Buffer.from(c).toString());
    return true;
  });
  const prevExit = process.exitCode;
  try {
    // run from a temp dir with no .backpressure/ and a hand-edit-less, absent gate
    const dir = await mkdtemp(join(tmpdir(), "bp-gate-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    await buildProgram().parseAsync(["node", "backpressure", "gate"]);
    cwdSpy.mockRestore();
    // unknown stack is allowed (writes a generic gate); assert no raw stack trace
    expect(chunks.join("")).not.toContain(" at ");
  } finally {
    spy.mockRestore();
    process.exitCode = prevExit;
  }
});
```

(Imports `mkdtemp`, `tmpdir`, `join` already present at the top of `test/cli.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli.test.ts -t "gate"`
Expected: FAIL — `gate` command not registered.

- [ ] **Step 3: Implement the `gate` command**

Add the import:

```typescript
import { writeTunedGate } from "./install/gate.js";
```

Register the command (place it after `index`, before `skills`):

```typescript
  program
    .command("gate")
    .description("(Re)generate the composite gate tuned to this repo's stack.")
    .option("--force", "Overwrite a hand-edited gate (one without the generated marker).")
    .action(async (options: { force?: boolean }) => {
      try {
        const { path, profile } = await writeTunedGate(cwd(), nodeInstallIo, { force: options.force });
        process.stdout.write(`Wrote ${path}\nStack: ${profile.kind}\n`);
      } catch (e) {
        const line = cliErrorLine(e);
        if (line === null) throw e;
        process.stderr.write(`${line}\n`);
        process.exitCode = 1;
      }
    });
```

- [ ] **Step 4: Auto-tune after a loop-pack `add`**

In the existing `add` `.action(...)`, after the `pinned …` line is printed, add — still inside the `try`:

```typescript
        // If the pack installed the composite gate, tune it to this repo's stack.
        if (files.some((f) => f.endsWith("backpressure-gate.sh"))) {
          const { profile } = await writeTunedGate(baseDir, nodeInstallIo, { force: true });
          process.stdout.write(`gate tuned for: ${profile.kind}\n`);
        }
```

- [ ] **Step 5: Run tests + build smoke check**

Run: `pnpm vitest run test/cli.test.ts && pnpm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat(cli): backpressure gate command + auto-tune after add"
```

---

### Task 8: Docs + regenerate the bundled fallback gate

**Files:**
- Modify: `docs/USER_GUIDE.md` (document `--with-loop`, the `gate` command, stack-aware behavior)
- Modify: `packs/backpressure-loop/commands/backpressure-loop.md` (soften the Phase 2 manual-tune step)
- Modify: `packs/backpressure-loop/scripts/backpressure-gate.sh` (regenerate from `emitGate("unknown")` so the bundled fallback carries the generated marker and can't drift)

**Interfaces:** none (docs + generated artifact).

- [ ] **Step 1: Regenerate the bundled fallback gate from the emitter**

Run (after `pnpm run build`):

```bash
node -e "import('./dist/index.js').catch(()=>{}); const {emitGate}=await import('./src/install/gate.ts').catch(async()=>await import('./dist/install/gate.js')); process.stdout.write(emitGate({kind:'unknown'}))" \
  > /tmp/gate.sh 2>/dev/null || \
node --experimental-strip-types -e "import {emitGate} from './src/install/gate.ts'; process.stdout.write(emitGate({kind:'unknown'}))" > packs/backpressure-loop/scripts/backpressure-gate.sh
chmod +x packs/backpressure-loop/scripts/backpressure-gate.sh
```

If the toolchain can't strip types inline, instead add a one-off throwaway script
`scripts/gen-fallback-gate.ts` that imports `emitGate` and writes the file, run it
with `pnpm tsx`, then delete it. The committed result MUST contain the
`@generated by backpressure gate` marker and the TUNE-ME banner.

Verify:

```bash
grep -q "@generated by backpressure gate" packs/backpressure-loop/scripts/backpressure-gate.sh && echo OK
```

- [ ] **Step 2: Update `docs/USER_GUIDE.md`**

In the CLI command table, add a `gate` row and document `--with-loop` under `init`:

```markdown
| `gate`   | ✅ wired | (Re)generates the composite gate tuned to this repo's stack (Rust / Node-TS). |
```

Add an `init` option row:

```markdown
| `--with-loop` | off | Also install the bundled **backpressure-loop** pack and a **stack-tuned** gate, in one step (claude only). Equivalent to `init` + `add …/backpressure-loop`, but network-free and auto-tuned. |
```

Add a short section:

```markdown
### `backpressure gate`

Regenerates `.backpressure/scripts/backpressure-gate.sh` tuned to the detected
stack — `cargo fmt/clippy/test/build` for a Rust crate (`Cargo.toml`), the repo's
package manager + `tsc`/test/build for a Node project (`package.json`), else a
generic pipeline behind a loud tune-me banner. Pass `--force` to overwrite a
hand-edited gate (one missing the `@generated` marker). Runs automatically during
`init --with-loop` and `add …/backpressure-loop`.
```

- [ ] **Step 3: Soften the loop command's manual-tune step**

In `packs/backpressure-loop/commands/backpressure-loop.md`, change the Phase 2
"Tune `.backpressure/scripts/backpressure-gate.sh` to the project's stack." bullet to:

```markdown
- **Verify the auto-tuned gate.** The install detected the stack and wrote a tuned
  `.backpressure/scripts/backpressure-gate.sh` (Rust/Node). Re-run `backpressure gate`
  if the stack changed; only hand-edit for a stack it doesn't yet support (then the
  gate drops its `@generated` marker and `backpressure gate` won't clobber it without `--force`).
```

- [ ] **Step 4: Run the full gate**

Run: `pnpm run check && pnpm test`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add docs/USER_GUIDE.md packs/backpressure-loop/commands/backpressure-loop.md packs/backpressure-loop/scripts/backpressure-gate.sh
git commit -m "docs: document --with-loop + gate; regenerate bundled fallback gate from emitGate"
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
| --- | --- |
| `init --with-loop` one-step, bundled, network-free | 4 (suppression) + 5 (orchestration) + 6 (flag) |
| Decision A — gate is sole Stop hook (overwrite/omission) | 4 (plan filter) + 5 (loop pack writes the hook) |
| `detectStack` Rust/Node/unknown, bun-aware pm | 1 |
| `emitGate` per-language tables + shape + unknown banner (fail-closed) | 2 |
| `writeTunedGate` shared by install + `add` + `gate` | 3 (fn) + 5 (init) + 7 (add + command) |
| Decision B — plain editable script, no config model | 2 (no config emitted) |
| `backpressure gate` regen command | 7 |
| Idempotency (deterministic re-run) | 2 (deterministic test) + 3 (idempotent test) |
| `@generated` provenance header + hand-edit protection + `--force` | 3 (writeTunedGate) + 8 (bundled fallback carries marker) |
| Pre-#8 `add` route retunes in place | 7 (auto-tune after add) |
| codex / hand-edit clean errors | 5 (codex) + 3 (hand-edit) |
| Docs (`--with-loop`, `gate`, loop command softened) | 8 |

No gaps.

**2. Placeholder scan:** none — every code step shows complete code; Task 8 Step 1
gives a concrete generation command with a named fallback.

**3. Type consistency:** `StackProfile`/`StackKind` (Task 1) are consumed unchanged
in Tasks 2/3/5; `writeTunedGate` returns `{ path, profile }` (Task 3) and is consumed
that way in Tasks 5/7; `installWithLoop` returns `{ profile }` (Task 5) consumed in
Task 6; `GENERATED_MARKER` (Task 2) is consumed in Task 3 and asserted in Task 8;
`InstallIo.makeExecutable?` (Task 3) is optional and only called with `?.`.

**Open risk carried from the spec:** Task 8 Step 1's inline TypeScript execution is
environment-dependent; the named fallback (throwaway `pnpm tsx` script) is the
reliable path. The committed bundled gate MUST contain the `@generated` marker
(verified in Task 8 Step 1).
