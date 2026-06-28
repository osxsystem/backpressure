# `backpressure add` — Phase 1 Implementation Plan (pack format + `command`/`script` kinds)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a manifest-declared capability pack installable from a *local* directory (no network), adding `command` and `script` as first-class installable kinds — which is exactly what makes `/backpressure-loop` shippable.

**Architecture:** A new self-contained `src/add/` module set — `manifest` (zod schema + parser), `scripts` (hook-command rewriting), `pack` (pure planner: manifest + install choice → write ops), `install-pack` (executes ops through the existing `InstallIo`, records `installed.json`). It **reuses the existing per-target adapter emitters** (`emitClaude*`/`emitCodex*`) for `agent`/`hook`/`mcp` items and byte-copies `skill`/`command`/`script` files. The existing `init` path is left untouched except for a new `--from <dir>` route and one additive `InstallIo.readText` method.

**Tech Stack:** TypeScript (ESM, Node 20+), zod, vitest, biome. **No new runtime dependency in Phase 1** (`nanotar` arrives in Phase 2).

## Global Constraints

- **Node 20+, ESM.** Every intra-repo import uses an explicit `.js` extension.
- **Sibling tests.** Every `src/<p>.ts` ships `test/<p>.test.ts` in the same task.
- **The gate is the done-signal.** `pnpm run check` (biome + tsc) and `pnpm test` must be green before every commit.
- **Zero new dependencies this phase.** Use `zod` (already present). Do not add packages.
- **Compile per target.** New per-target *path/emit* branching lives in `src/add/pack.ts` only, mirroring the existing `src/install/plan.ts` precedent — no other new file may branch on the CLI name.
- **Manifest `targets` ⊆ `{"claude","codex"}`.** Install `choice ∈ {"claude","codex","other"}` (`other` = portable content only).
- **Zod version:** confirm the installed major and match the `record`/`enum` spelling (zod v3: `z.record(z.string())`; zod v4: `z.record(z.string(), z.string())`). Adjust the one call in `manifest.ts` accordingly.
- **Commit trailer:** every commit message ends with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** work on `design/backpressure-add-installer` (already checked out). Never push.

---

## File structure (created/modified this phase)

| File | Responsibility |
|------|----------------|
| `src/add/manifest.ts` (create) | `backpressure.json` zod schema + `parseManifest`. |
| `src/install/errors.ts` (modify) | add `InvalidPackManifestError extends InstallError`. |
| `src/add/scripts.ts` (create) | `rewriteScriptRefs` — point hook commands at installed scripts. |
| `src/add/pack.ts` (create) | `InstallChoice`, `PackOp`, `PackPlan`, pure `planPack`. |
| `src/install/init.ts` (modify) | add `readText` to `InstallIo` + `nodeInstallIo`. |
| `src/add/installed.ts` (create) | `InstalledManifest` type + `serializeInstalled`. |
| `src/add/install-pack.ts` (create) | `installPack` — execute ops, write `installed.json`. |
| `src/cli.ts` (modify) | `init --from <dir>` route to `installPack`. |
| `packs/backpressure-loop/**` (create) | this repo's own pack: manifest + command + gate script. |
| `test/add/*.test.ts`, `test/install/*` (create/modify) | sibling + acceptance tests. |

---

## Task 1: Pack manifest schema + parser

**Files:**
- Create: `src/add/manifest.ts`
- Modify: `src/install/errors.ts` (append `InvalidPackManifestError`)
- Test: `test/add/manifest.test.ts`

**Interfaces:**
- Produces: `PackManifest`, `PackItem`, `parseManifest(text: string): PackManifest`, `InvalidPackManifestError`.
  - `PackManifest = { name: string; version: string; targets: ("claude"|"codex")[]; items: PackItem[]; scripts: string[] }`
  - `PackItem` is a discriminated union on `type`:
    - `{ type:"skill"; name:string; path:string }`
    - `{ type:"command"; name:string; path:string }`
    - `{ type:"agent"; name:string; description:string; prompt:string; tools?:string[] }`
    - `{ type:"hook"; event:string; command:string; matcher?:string }`
    - `{ type:"mcp"; name:string; command:string; args:string[]; env?:Record<string,string> }`

- [ ] **Step 1: Add the error class.** Append to `src/install/errors.ts`:

```ts
/**
 * Thrown when a pack's `backpressure.json` is missing, not valid JSON, or fails
 * schema validation. Carries a human message listing what's wrong.
 */
export class InvalidPackManifestError extends InstallError {
  constructor(message: string) {
    super(`invalid backpressure.json: ${message}`);
    this.name = "InvalidPackManifestError";
  }
}
```

- [ ] **Step 2: Write the failing test.** Create `test/add/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InvalidPackManifestError } from "../../src/install/errors.js";
import { parseManifest } from "../../src/add/manifest.js";

const valid = JSON.stringify({
  name: "backpressure-loop",
  version: "1.0.0",
  targets: ["claude", "codex"],
  items: [
    { type: "skill", name: "backpressure-loop", path: "skills/backpressure-loop" },
    { type: "command", name: "backpressure-loop", path: "commands/backpressure-loop.md" },
    { type: "agent", name: "reviewer", description: "Reviews.", prompt: "Review.", tools: ["Read"] },
    { type: "hook", event: "Stop", command: "./scripts/backpressure-gate.sh" },
  ],
  scripts: ["scripts/backpressure-gate.sh"],
});

describe("parseManifest", () => {
  it("parses a valid manifest and defaults scripts to []", () => {
    const m = parseManifest(valid);
    expect(m.name).toBe("backpressure-loop");
    expect(m.items).toHaveLength(4);
    expect(parseManifest(JSON.stringify({ name: "p", version: "1", targets: ["claude"], items: [] })).scripts)
      .toEqual([]);
  });

  it("rejects non-JSON", () => {
    expect(() => parseManifest("{not json")).toThrow(InvalidPackManifestError);
  });

  it("rejects an unknown item type", () => {
    const bad = JSON.stringify({ name: "p", version: "1", targets: ["claude"], items: [{ type: "widget" }] });
    expect(() => parseManifest(bad)).toThrow(InvalidPackManifestError);
  });

  it("rejects an unsupported target", () => {
    const bad = JSON.stringify({ name: "p", version: "1", targets: ["vim"], items: [] });
    expect(() => parseManifest(bad)).toThrow(InvalidPackManifestError);
  });
});
```

- [ ] **Step 3: Run it; verify it fails.** Run: `pnpm exec vitest run test/add/manifest.test.ts`
  Expected: FAIL — cannot resolve `../../src/add/manifest.js`.

- [ ] **Step 4: Implement `src/add/manifest.ts`:**

```ts
import { z } from "zod";
import { InvalidPackManifestError } from "../install/errors.js";

const SkillItem = z.object({ type: z.literal("skill"), name: z.string(), path: z.string() });
const CommandItem = z.object({ type: z.literal("command"), name: z.string(), path: z.string() });
const AgentItem = z.object({
  type: z.literal("agent"),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
});
const HookItem = z.object({
  type: z.literal("hook"),
  event: z.string(),
  command: z.string(),
  matcher: z.string().optional(),
});
const McpItem = z.object({
  type: z.literal("mcp"),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(), // zod v3: z.record(z.string())
});

/** One declared capability in a pack. Discriminated on `type`. */
export const PackItemSchema = z.discriminatedUnion("type", [
  SkillItem,
  CommandItem,
  AgentItem,
  HookItem,
  McpItem,
]);
export type PackItem = z.infer<typeof PackItemSchema>;

/** The validated `backpressure.json` contract. */
export const PackManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  targets: z.array(z.enum(["claude", "codex"])).nonempty(),
  items: z.array(PackItemSchema),
  scripts: z.array(z.string()).default([]),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

/** Parse + validate a `backpressure.json` body. Throws InvalidPackManifestError. */
export function parseManifest(text: string): PackManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidPackManifestError("not valid JSON");
  }
  const result = PackManifestSchema.safeParse(json);
  if (!result.success) {
    throw new InvalidPackManifestError(result.error.message);
  }
  return result.data;
}
```

- [ ] **Step 5: Run tests + gate.** Run: `pnpm exec vitest run test/add/manifest.test.ts && pnpm run check`
  Expected: PASS; biome + tsc clean.

- [ ] **Step 6: Commit.**

```bash
git add src/add/manifest.ts src/install/errors.ts test/add/manifest.test.ts
git commit -m "feat(add): backpressure.json manifest schema + parser"
```

---

## Task 2: Hook-command script rewriting

**Files:**
- Create: `src/add/scripts.ts`
- Test: `test/add/scripts.test.ts`

**Interfaces:**
- Produces: `rewriteScriptRefs(command: string, scripts: string[]): string` — for each declared script path (e.g. `scripts/backpressure-gate.sh`), rewrite its reference inside a hook command to the installed location `./.backpressure/scripts/<basename>`. Used by `planPack` (Task 3) and `installPack` (Task 4) so a hook still finds its script after install.

- [ ] **Step 1: Write the failing test.** Create `test/add/scripts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rewriteScriptRefs } from "../../src/add/scripts.js";

describe("rewriteScriptRefs", () => {
  it("rewrites a declared script reference to the installed path", () => {
    expect(rewriteScriptRefs("./scripts/backpressure-gate.sh", ["scripts/backpressure-gate.sh"]))
      .toBe("./.backpressure/scripts/backpressure-gate.sh");
    expect(rewriteScriptRefs("scripts/backpressure-gate.sh --x", ["scripts/backpressure-gate.sh"]))
      .toBe(".backpressure/scripts/backpressure-gate.sh --x");
  });

  it("leaves commands with no declared-script reference untouched", () => {
    expect(rewriteScriptRefs("pnpm test", ["scripts/backpressure-gate.sh"])).toBe("pnpm test");
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** Run: `pnpm exec vitest run test/add/scripts.test.ts`
  Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `src/add/scripts.ts`:**

```ts
import { basename } from "node:path";

/**
 * Rewrite references to declared pack scripts inside a hook `command` so they
 * point at where the installer puts them (`.backpressure/scripts/<basename>`).
 * Each script's manifest-relative path (e.g. `scripts/gate.sh`) is replaced with
 * `.backpressure/scripts/<basename>`; a leading `./` is preserved. Pure string op.
 */
export function rewriteScriptRefs(command: string, scripts: string[]): string {
  let out = command;
  for (const s of scripts) {
    const installed = `.backpressure/scripts/${basename(s)}`;
    out = out.split(`./${s}`).join(`./${installed}`);
    out = out.split(s).join(installed);
  }
  return out;
}
```

- [ ] **Step 4: Run tests + gate.** Run: `pnpm exec vitest run test/add/scripts.test.ts && pnpm run check`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/add/scripts.ts test/add/scripts.test.ts
git commit -m "feat(add): rewrite hook-command script refs to the installed path"
```

---

## Task 3: Pure pack planner

**Files:**
- Create: `src/add/pack.ts`
- Test: `test/add/pack.test.ts`

**Interfaces:**
- Consumes: `PackManifest`/`PackItem` (Task 1), `rewriteScriptRefs` (Task 2), the existing emitters `emitClaudeAgents`, `emitClaudeHooks`, `emitClaudeMcp`, `emitCodexAgents`, `emitCodexHooks`, `emitCodexMcp`.
- Produces:
  - `type InstallChoice = "claude" | "codex" | "other"`
  - `type PackOp = { op:"copyTree"; from:string; to:string } | { op:"copyFile"; from:string; to:string } | { op:"writeText"; path:string; contents:string }`
  - `interface PackPlan { ops: PackOp[]; notices: string[] }`
  - `planPack(packDir: string, manifest: PackManifest, choice: InstallChoice, baseDir: string): PackPlan` — pure.

- [ ] **Step 1: Write the failing test.** Create `test/add/pack.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/add/manifest.js";
import { planPack } from "../../src/add/pack.js";

const pack = "/pack";
const base = "/repo";
const manifest = parseManifest(
  JSON.stringify({
    name: "p",
    version: "1.0.0",
    targets: ["claude", "codex"],
    items: [
      { type: "skill", name: "loop", path: "skills/loop" },
      { type: "command", name: "loop", path: "commands/loop.md" },
      { type: "hook", event: "Stop", command: "./scripts/gate.sh" },
    ],
    scripts: ["scripts/gate.sh"],
  }),
);

describe("planPack", () => {
  it("plans Claude: skill copyTree, command copyFile, hook→settings.json, script→.backpressure", () => {
    const { ops } = planPack(pack, manifest, "claude", base);
    expect(ops).toContainEqual({ op: "copyTree", from: join(pack, "skills/loop"), to: join(base, ".claude/skills/loop") });
    expect(ops).toContainEqual({ op: "copyFile", from: join(pack, "commands/loop.md"), to: join(base, ".claude/commands/loop.md") });
    expect(ops).toContainEqual({ op: "copyFile", from: join(pack, "scripts/gate.sh"), to: join(base, ".backpressure/scripts/gate.sh") });
    const settings = ops.find((o) => o.op === "writeText" && o.path === join(base, ".claude/settings.json"));
    expect(settings && settings.op === "writeText" && settings.contents).toContain(".backpressure/scripts/gate.sh");
  });

  it("skips commands on Codex and emits one config.toml", () => {
    const { ops, notices } = planPack(pack, manifest, "codex", base);
    expect(ops.some((o) => o.op !== "writeText" ? false : o.path.endsWith("config.toml"))).toBe(true);
    expect(ops.some((o) => "to" in o && o.to.includes("commands"))).toBe(false);
    expect(notices.join(" ")).toContain("command");
  });

  it("for 'other' materialises skills under .backpressure and skips compiled items", () => {
    const { ops, notices } = planPack(pack, manifest, "other", base);
    expect(ops).toContainEqual({ op: "copyTree", from: join(pack, "skills/loop"), to: join(base, ".backpressure/skills/loop") });
    expect(ops.some((o) => o.op === "writeText")).toBe(false);
    expect(notices.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** Run: `pnpm exec vitest run test/add/pack.test.ts`
  Expected: FAIL — cannot resolve `pack.js`.

- [ ] **Step 3: Implement `src/add/pack.ts`:**

```ts
import { basename, join } from "node:path";
import { emitClaudeAgents } from "../adapters/claude/agents.js";
import { emitClaudeHooks } from "../adapters/claude/hooks.js";
import { emitClaudeMcp } from "../adapters/claude/mcp.js";
import { emitCodexAgents } from "../adapters/codex/agents.js";
import { emitCodexHooks } from "../adapters/codex/hooks.js";
import { emitCodexMcp } from "../adapters/codex/mcp.js";
import type { PackItem, PackManifest } from "./manifest.js";
import { rewriteScriptRefs } from "./scripts.js";

/** Which CLI the user is installing for; "other" = portable content only. */
export type InstallChoice = "claude" | "codex" | "other";

/** One filesystem operation the installer will perform. */
export type PackOp =
  | { op: "copyTree"; from: string; to: string }
  | { op: "copyFile"; from: string; to: string }
  | { op: "writeText"; path: string; contents: string };

/** A pure plan: the ops to perform plus any user-facing skip notices. */
export interface PackPlan {
  ops: PackOp[];
  notices: string[];
}

const byType = <T extends PackItem["type"]>(items: PackItem[], type: T) =>
  items.filter((i): i is Extract<PackItem, { type: T }> => i.type === type);

/**
 * Compile a validated manifest into write ops for `choice`, rooted at `baseDir`.
 * Pure — the emitters it calls are pure and it performs no I/O. `skill`/`command`
 * become file copies from `packDir`; `agent`/`hook`/`mcp` are compiled per target
 * via the existing adapters; `scripts` always land under `.backpressure/scripts/`.
 */
export function planPack(
  packDir: string,
  manifest: PackManifest,
  choice: InstallChoice,
  baseDir: string,
): PackPlan {
  const ops: PackOp[] = [];
  const notices: string[] = [];
  const abs = (...p: string[]): string => join(baseDir, ...p);

  for (const s of manifest.scripts) {
    ops.push({ op: "copyFile", from: join(packDir, s), to: abs(".backpressure", "scripts", basename(s)) });
  }

  const skills = byType(manifest.items, "skill");
  const commands = byType(manifest.items, "command");

  if (choice === "other") {
    for (const sk of skills) {
      ops.push({ op: "copyTree", from: join(packDir, sk.path), to: abs(".backpressure", "skills", sk.name) });
    }
    for (const c of commands) notices.push(`skipped command "${c.name}" — no destination for an unknown CLI`);
    if (manifest.items.some((i) => i.type === "agent" || i.type === "hook" || i.type === "mcp")) {
      notices.push("skipped hooks/agents/mcp — no adapter for an unknown CLI");
    }
    return { ops, notices };
  }

  const configDir = choice === "claude" ? ".claude" : ".codex";
  for (const sk of skills) {
    ops.push({ op: "copyTree", from: join(packDir, sk.path), to: abs(configDir, "skills", sk.name) });
  }

  const hookDefs = byType(manifest.items, "hook").map((h) => ({
    event: h.event,
    command: rewriteScriptRefs(h.command, manifest.scripts),
    ...(h.matcher !== undefined ? { matcher: h.matcher } : {}),
  }));
  const agentDefs = byType(manifest.items, "agent").map((a) => ({
    name: a.name,
    description: a.description,
    prompt: a.prompt,
    ...(a.tools !== undefined ? { tools: a.tools } : {}),
  }));
  const mcpDefs = byType(manifest.items, "mcp").map((m) => ({
    name: m.name,
    command: m.command,
    args: m.args,
    ...(m.env !== undefined ? { env: m.env } : {}),
  }));

  if (choice === "claude") {
    for (const c of commands) {
      ops.push({ op: "copyFile", from: join(packDir, c.path), to: abs(".claude", "commands", `${c.name}.md`) });
    }
    if (hookDefs.length > 0) {
      ops.push({ op: "writeText", path: abs(".claude", "settings.json"), contents: `${JSON.stringify(emitClaudeHooks(hookDefs), null, 2)}\n` });
    }
    if (mcpDefs.length > 0) {
      ops.push({ op: "writeText", path: abs(".mcp.json"), contents: `${JSON.stringify(emitClaudeMcp(mcpDefs), null, 2)}\n` });
    }
    for (const af of emitClaudeAgents(agentDefs)) {
      ops.push({ op: "writeText", path: abs(af.path), contents: af.contents });
    }
    return { ops, notices };
  }

  // choice === "codex": one config.toml carries hooks + mcp + agents.
  for (const c of commands) notices.push(`skipped command "${c.name}" — Codex has no project-level command surface`);
  const fragments: string[] = [];
  if (hookDefs.length > 0) fragments.push(emitCodexHooks(hookDefs));
  if (mcpDefs.length > 0) fragments.push(emitCodexMcp(mcpDefs));
  if (agentDefs.length > 0) fragments.push(emitCodexAgents(agentDefs));
  if (fragments.length > 0) {
    ops.push({ op: "writeText", path: abs(".codex", "config.toml"), contents: fragments.join("\n") });
  }
  return { ops, notices };
}
```

- [ ] **Step 4: Run tests + gate.** Run: `pnpm exec vitest run test/add/pack.test.ts && pnpm run check`
  Expected: PASS. (If `emitClaudeMcp` returns something other than a JS object, adjust the `.mcp.json` line — confirm against `src/adapters/claude/mcp.ts`; `init.ts` `JSON.stringify`s its result, so an object is expected.)

- [ ] **Step 5: Commit.**

```bash
git add src/add/pack.ts test/add/pack.test.ts
git commit -m "feat(add): pure planPack — manifest + choice -> write ops"
```

---

## Task 4: Pack writer + `installed.json`

**Files:**
- Modify: `src/install/init.ts` (add `readText` to `InstallIo` and `nodeInstallIo`)
- Create: `src/add/installed.ts`
- Create: `src/add/install-pack.ts`
- Test: `test/add/install-pack.test.ts`

**Interfaces:**
- Consumes: `parseManifest`, `planPack`/`PackOp`/`InstallChoice`, `rewriteScriptRefs`, `InstallIo`/`nodeInstallIo`, `isEnoent`, `InvalidPackManifestError`.
- Produces:
  - `interface InstalledManifest { name:string; version:string; choice:InstallChoice; files:string[]; hooks:{event:string;command:string;matcher?:string}[] }`
  - `serializeInstalled(m: InstalledManifest): string`
  - `interface InstallPackResult { installed: InstalledManifest; notices: string[] }`
  - `installPack(packDir: string, choice: InstallChoice, baseDir: string, io?: InstallIo): Promise<InstallPackResult>`

- [ ] **Step 1: Extend `InstallIo` with `readText`.** In `src/install/init.ts`, add to the `InstallIo` interface (next to `writeText`):

```ts
  /** Read a UTF-8 text file at `path`. Throws an ENOENT-coded error if absent. */
  readText(path: string): Promise<string>;
```

and to `nodeInstallIo` (import `readFile` from `node:fs/promises` at the top — it is not yet imported):

```ts
  async readText(path) {
    return readFile(path, "utf8");
  },
```

- [ ] **Step 2: Write the failing test.** Create `test/add/install-pack.test.ts` (uses an in-memory `InstallIo` fake seeded with a pack):

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InstallIo } from "../../src/install/init.js";
import { installPack } from "../../src/add/install-pack.js";

function fakeIo(seed: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(seed));
  const trees = new Map<string, string[]>(); // dir -> relative file list
  for (const p of Object.keys(seed)) {
    // register parents so listFiles can answer for a skill dir
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const rel = parts.slice(i).join("/");
      trees.set(dir, [...(trees.get(dir) ?? []), rel]);
    }
  }
  const io: InstallIo & { written: Map<string, string> } = {
    written: new Map(),
    async readText(p) {
      const v = files.get(p);
      if (v === undefined) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
        e.code = "ENOENT";
        throw e;
      }
      return v;
    },
    async listFiles(dir) {
      const rels = trees.get(dir);
      if (rels === undefined) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${dir}`);
        e.code = "ENOENT";
        throw e;
      }
      return rels;
    },
    async ensureDir() {},
    async writeText(p, data) {
      this.written.set(p, data);
    },
    async copyFile(from, to) {
      this.written.set(to, files.get(from) ?? "");
    },
  };
  return io;
}

const manifest = JSON.stringify({
  name: "loop",
  version: "1.0.0",
  targets: ["claude"],
  items: [
    { type: "command", name: "backpressure-loop", path: "commands/backpressure-loop.md" },
    { type: "hook", event: "Stop", command: "./scripts/gate.sh" },
  ],
  scripts: ["scripts/gate.sh"],
});

describe("installPack (@acceptance)", () => {
  it("installs a Claude pack: command, hook→settings, script→.backpressure, installed.json", async () => {
    const io = fakeIo({
      "/pack/backpressure.json": manifest,
      "/pack/commands/backpressure-loop.md": "# loop",
      "/pack/scripts/gate.sh": "#!/bin/sh\n",
    });
    const { installed } = await installPack("/pack", "claude", "/repo", io);

    expect(io.written.has(join("/repo", ".claude/commands/backpressure-loop.md"))).toBe(true);
    expect(io.written.has(join("/repo", ".backpressure/scripts/gate.sh"))).toBe(true);
    expect(io.written.get(join("/repo", ".claude/settings.json"))).toContain(".backpressure/scripts/gate.sh");
    expect(installed.hooks).toEqual([{ event: "Stop", command: ".backpressure/scripts/gate.sh" }]);
    expect(io.written.get(join("/repo", ".backpressure/installed.json"))).toContain("\"choice\": \"claude\"");
  });

  it("refuses a target the manifest does not declare", async () => {
    const io = fakeIo({ "/pack/backpressure.json": manifest });
    await expect(installPack("/pack", "codex", "/repo", io)).rejects.toThrow(/does not support/);
  });
});
```

- [ ] **Step 3: Run it; verify it fails.** Run: `pnpm exec vitest run test/add/install-pack.test.ts`
  Expected: FAIL — cannot resolve `install-pack.js`.

- [ ] **Step 4: Implement `src/add/installed.ts`:**

```ts
import type { InstallChoice } from "./pack.js";

/** What an install wrote, recorded under `.backpressure/installed.json`. */
export interface InstalledManifest {
  name: string;
  version: string;
  choice: InstallChoice;
  /** Every written path, relative to the install base dir. */
  files: string[];
  /** The exact hook entries merged in (for clean removal in a later phase). */
  hooks: { event: string; command: string; matcher?: string }[];
}

/** Serialize an {@link InstalledManifest} to the on-disk JSON text. */
export function serializeInstalled(m: InstalledManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}
```

- [ ] **Step 5: Implement `src/add/install-pack.ts`:**

```ts
import { dirname, join, relative } from "node:path";
import { parseManifest } from "./manifest.js";
import { type InstallChoice, type PackOp, planPack } from "./pack.js";
import { rewriteScriptRefs } from "./scripts.js";
import { type InstalledManifest, serializeInstalled } from "./installed.js";
import { type InstallIo, nodeInstallIo } from "../install/init.js";
import { InvalidPackManifestError, isEnoent } from "../install/errors.js";

/** The outcome of {@link installPack}: what was recorded, plus skip notices. */
export interface InstallPackResult {
  installed: InstalledManifest;
  notices: string[];
}

/**
 * Install a local pack directory (containing `backpressure.json`) into `baseDir`
 * for `choice`. Reads + validates the manifest, plans the write ops via
 * {@link planPack}, executes them through `io`, and records an
 * `installed.json`. Network-free — the Phase-2 `add` command fetches a pack into
 * a temp dir and then calls this.
 */
export async function installPack(
  packDir: string,
  choice: InstallChoice,
  baseDir: string,
  io: InstallIo = nodeInstallIo,
): Promise<InstallPackResult> {
  const manifest = parseManifest(await io.readText(join(packDir, "backpressure.json")));

  if (choice !== "other" && !manifest.targets.includes(choice)) {
    throw new InvalidPackManifestError(
      `pack "${manifest.name}" does not support target "${choice}". Supported: ${manifest.targets.join(", ")}`,
    );
  }

  const { ops, notices } = planPack(packDir, manifest, choice, baseDir);
  const files: string[] = [];
  const rel = (p: string): string => relative(baseDir, p);

  for (const op of ops) {
    if (op.op === "copyTree") {
      let rels: string[];
      try {
        rels = await io.listFiles(op.from);
      } catch (e) {
        if (isEnoent(e)) throw new InvalidPackManifestError(`item source not found: ${op.from}`);
        throw e;
      }
      if (rels.length === 0) throw new InvalidPackManifestError(`item source is empty: ${op.from}`);
      for (const r of rels) {
        const dest = join(op.to, r);
        await io.ensureDir(dirname(dest));
        await io.copyFile(join(op.from, r), dest);
        files.push(rel(dest));
      }
    } else if (op.op === "copyFile") {
      await io.ensureDir(dirname(op.to));
      await io.copyFile(op.from, op.to);
      files.push(rel(op.to));
    } else {
      await io.ensureDir(dirname(op.path));
      await io.writeText(op.path, op.contents);
      files.push(rel(op.path));
    }
  }

  const hooks =
    choice === "other"
      ? []
      : manifest.items
          .filter((i): i is Extract<typeof i, { type: "hook" }> => i.type === "hook")
          .map((h) => ({
            event: h.event,
            command: rewriteScriptRefs(h.command, manifest.scripts),
            ...(h.matcher !== undefined ? { matcher: h.matcher } : {}),
          }));

  const installed: InstalledManifest = { name: manifest.name, version: manifest.version, choice, files, hooks };
  const installedPath = join(baseDir, ".backpressure", "installed.json");
  await io.ensureDir(dirname(installedPath));
  await io.writeText(installedPath, serializeInstalled(installed));

  return { installed, notices };
}
```

- [ ] **Step 6: Run tests + gate.** Run: `pnpm exec vitest run test/add/install-pack.test.ts && pnpm run check`
  Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/install/init.ts src/add/installed.ts src/add/install-pack.ts test/add/install-pack.test.ts
git commit -m "feat(add): installPack writer + installed.json record"
```

---

## Task 5: CLI route — `init --from <dir>`

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts` (append; if absent, create it)

**Interfaces:**
- Consumes: `installPack` (Task 4), the existing `parseTarget`, `cliErrorLine`.
- Produces: a wired `init --from <dir>` path that installs a local pack and prints `Wrote: <path>` per file plus any notice lines.

- [ ] **Step 1: Write the failing test.** Append to `test/cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("init --from", () => {
  it("registers a --from option on init", () => {
    const init = buildProgram().commands.find((c) => c.name() === "init");
    expect(init?.options.some((o) => o.long === "--from")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** Run: `pnpm exec vitest run test/cli.test.ts -t "init --from"`
  Expected: FAIL — no `--from` option.

- [ ] **Step 3: Implement.** In `src/cli.ts`, import `installPack` and `resolve`:

```ts
import { resolve } from "node:path";
import { installPack } from "./add/install-pack.js";
```

Add the option to the `init` command definition (after `--gate`):

```ts
    .option("--from <dir>", "Install a local capability pack (a dir with backpressure.json) instead of the bundled defaults.")
```

At the very top of the `init` action body, before the existing logic, branch on `--from`:

```ts
        if (options.from !== undefined) {
          try {
            const target = parseTarget(options.target);
            const baseDir = options.global ? homedir() : cwd();
            const { installed, notices } = await installPack(resolve(options.from), target, baseDir);
            for (const f of installed.files) process.stdout.write(`Wrote: ${join(baseDir, f)}\n`);
            for (const n of notices) process.stdout.write(`Note: ${n}\n`);
          } catch (e) {
            const line = cliErrorLine(e);
            if (line === null) throw e;
            process.stderr.write(`${line}\n`);
            process.exitCode = 1;
          }
          return;
        }
```

(Add `from?: string` to the `init` action options type, and import `join` from `node:path` if not already imported.)

- [ ] **Step 4: Run tests + gate.** Run: `pnpm exec vitest run test/cli.test.ts && pnpm run check`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat(cli): init --from <dir> installs a local capability pack"
```

---

## Task 6: Author this repo's `/backpressure-loop` pack (the payoff)

**Files:**
- Create: `packs/backpressure-loop/backpressure.json`
- Create: `packs/backpressure-loop/commands/backpressure-loop.md` (copy of `.claude/commands/backpressure-loop.md`)
- Create: `packs/backpressure-loop/scripts/backpressure-gate.sh` (copy of `scripts/backpressure-gate.sh`, executable)
- Test: `test/add/backpressure-loop-pack.test.ts` (acceptance)

**Interfaces:**
- Consumes: `installPack` (Task 4). No new exports.

- [ ] **Step 1: Create the pack manifest** `packs/backpressure-loop/backpressure.json`:

```json
{
  "name": "backpressure-loop",
  "version": "0.1.0",
  "targets": ["claude"],
  "items": [
    { "type": "command", "name": "backpressure-loop", "path": "commands/backpressure-loop.md" },
    { "type": "hook", "event": "Stop", "command": "./scripts/backpressure-gate.sh" }
  ],
  "scripts": ["scripts/backpressure-gate.sh"]
}
```

- [ ] **Step 2: Populate the pack files.** Copy the existing artifacts into the pack and keep the script executable:

```bash
mkdir -p packs/backpressure-loop/commands packs/backpressure-loop/scripts
cp .claude/commands/backpressure-loop.md packs/backpressure-loop/commands/backpressure-loop.md
cp scripts/backpressure-gate.sh packs/backpressure-loop/scripts/backpressure-gate.sh
chmod +x packs/backpressure-loop/scripts/backpressure-gate.sh
```

- [ ] **Step 3: Write the acceptance test** `test/add/backpressure-loop-pack.test.ts` (installs the real pack into a temp dir on disk using the default `nodeInstallIo`):

```ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { installPack } from "../../src/add/install-pack.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packDir = join(repoRoot, "packs", "backpressure-loop");

describe("backpressure-loop pack (@acceptance)", () => {
  it("installs the command, the gate hook, and the executable gate script", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-pack-"));
    const { installed } = await installPack(packDir, "claude", base);

    const cmd = await readFile(join(base, ".claude/commands/backpressure-loop.md"), "utf8");
    expect(cmd).toContain("Backpressure loop launcher");

    const settings = await readFile(join(base, ".claude/settings.json"), "utf8");
    expect(settings).toContain(".backpressure/scripts/backpressure-gate.sh");

    const gate = join(base, ".backpressure/scripts/backpressure-gate.sh");
    const mode = (await stat(gate)).mode;
    expect(mode & 0o111).not.toBe(0); // executable bit preserved

    expect(installed.files).toContain(".claude/commands/backpressure-loop.md");
  });
});
```

- [ ] **Step 4: Run the acceptance test + full gate.** Run: `pnpm exec vitest run test/add/backpressure-loop-pack.test.ts && pnpm test && pnpm run check`
  Expected: PASS — `/backpressure-loop` is now installable from a pack.

- [ ] **Step 5: Commit.**

```bash
git add packs/backpressure-loop test/add/backpressure-loop-pack.test.ts
git commit -m "feat(pack): ship /backpressure-loop as an installable capability pack"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §4 manifest contract → Task 1. §4 `command`/`script` new kinds → Tasks 1+3. §4 script-path resolution rule → Task 2 + Task 3 (rewrite into `settings.json`). §5 pipeline (validate→compile→write→record), minus fetch/trust/prompts (Phases 2–3) → Tasks 3–5. §6 `.backpressure/` layout + `installed.json` → Task 4. §7 reuse adapters → Task 3. §9 error handling (invalid manifest, unsupported target, missing item source) → Tasks 1+4. §11 testing incl. exec-bit preservation + acceptance → Tasks 4+6. §12 Phase 1 = ships `/backpressure-loop` no-network → Task 6.
- **Deliberately deferred (documented):** remote fetch/`nanotar` (Phase 2); interactive target/scope pickers, trust prompt, `--link`, `remove` via `installed.json`, hook *merge into existing* settings.json (Phase 3). Phase 1 `init --from` writes `settings.json` fresh — merge-with-existing is a Phase-3 concern, noted so a reviewer doesn't flag it as missing.
- **Refinement vs spec example:** the spec's manifest example wrote `agent` as a file `path`; this plan carries `agent`/`hook`/`mcp` as **inline definitions** in the manifest (matching the existing `SubagentDefinition`/`HookDefinition`/`McpServerDefinition` shapes the emitters consume). This is *more* consistent with §4's "emitted by the existing per-target emitters" than the illustrative example was. Flagged for the spec to be updated.

**Placeholder scan:** none — every step carries runnable code/commands.

**Type consistency:** `PackManifest`/`PackItem` (T1) → `planPack` (T3) → `installPack` (T4) → CLI (T5); `InstallChoice`/`PackOp` defined in T3 and imported by T4; `InstalledManifest`/`serializeInstalled` (T4) consumed by `installPack`; `rewriteScriptRefs` (T2) used identically in T3 and T4; `InstallIo.readText` added in T4 before first use. Names checked end-to-end.

---

## Open follow-ups (not this phase)
- Update the spec's manifest example (`agent`-as-inline, not path).
- Confirm zod major and fix the one `z.record` spelling.
- Codex adapter pre-existing bugs (spec §13) — keep `init --from … --target codex` honest or gate it until the adapter is fixed.
