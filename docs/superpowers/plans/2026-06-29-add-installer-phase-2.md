# `backpressure add` — Phase 2 (Remote Installer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `npx @osxsystem/backpressure@latest add <owner/repo>[@ref]` — fetch a
manifest-declared capability pack from a GitHub repo, gate it behind a trust prompt,
and install it into the current repo by reusing the Phase-1 local installer.

**Architecture:** Phase 1 already built the *writer* (`src/add/install-pack.ts`
`installPack(packDir, choice, baseDir)`, which reads a local pack dir and copies +
compiles it via `planPack`). Phase 2 adds the *remote front-end* that produces such
a dir: parse `owner/repo[@ref]` → resolve the ref to an immutable commit SHA →
download the GitHub tarball → gunzip (Node `DecompressionStream`) → parse (`nanotar`)
→ extract zip-slip-safely into a temp dir → trust-gate → call the existing
`installPack` → write `.backpressure/backpressure.lock`. Network and fs sit behind
injectable seams (`PackFetcher`, `Prompter`, the existing `InstallIo`) so every unit
tests without touching the network or disk. Finally, publish prep renames the
package to the scoped `@osxsystem/backpressure` and un-privates it.

**Tech Stack:** TypeScript (ESM, Node 20+), zod, commander, vitest, biome.
**One** new runtime dependency: `nanotar`.

## Global Constraints

- **Node 20+, ESM.** Every intra-repo import uses an explicit `.js` extension.
- **Sibling tests.** Every `src/<p>.ts` ships `test/<p>.test.ts` in the same task.
- **The gate is the done-signal.** `pnpm run check` (biome + tsc) and `pnpm test`
  must be green before every commit.
- **Exactly one new runtime dependency: `nanotar`** (zero transitive deps, ESM,
  Node 18+). `fetch` + gzip decompression are Node-20 built-ins. Do NOT add `tar`,
  `degit`, `pako`, or any other package. The gate guards `pnpm-lock.yaml` changes,
  so the lockfile delta in Task 3 must contain only `nanotar`.
- **Compile per target.** Only `src/seam/` and `src/adapters/` may branch on the
  CLI name. The fetch/extract/ref/trust code is target-agnostic; per-target
  compilation stays inside the existing `planPack` (reused, not modified).
- **Reuse Phase 1.** Do NOT reimplement `planPack`/`installPack`/`rewriteScriptRefs`.
  The remote path extracts to a temp dir and calls `installPack(tempDir, …)`.
- **Typed errors.** Every expected failure is an `InstallError` subclass, surfaced
  as a single `backpressure: …` line (matching `cliErrorLine`). No raw stack traces.
- **Security.** Resolve a moving ref to an immutable SHA and pin it. The extractor
  rejects `..`, absolute paths, and symlink entries (zip-slip). The trust gate
  prints `owner/repo@<sha>` plus every hook command and executable script, and
  requires confirmation unless `--yes`.
- **Commit trailer:** every commit message ends with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** create a throwaway branch before starting; never push from the loop.

---

## File structure (created/modified this phase)

| File | Responsibility |
|------|----------------|
| `src/add/ref.ts` (create) | `parseRef(arg)` → `PackRef { owner, repo, subdir?, ref? }`. Pure. |
| `src/add/safejoin.ts` (create) | `safeResolve(root, entry)` — reject `..`/absolute/empty; pure. |
| `src/add/fetch.ts` (create) | `PackFetcher` seam + `nodePackFetcher` + `fetchPack(ref, io, fetcher)` → `{ dir, sha }`. Network + fs behind seams. |
| `src/add/trust.ts` (create) | `summarizeTrust(manifest, source, sha)` (pure) + `Prompter` seam + `confirmInstall`. |
| `src/add/lock.ts` (create) | `PackLock` type + `serializeLock`. Pure. |
| `src/add/add.ts` (create) | `addPack(arg, opts, deps)` — orchestrates ref→fetch→trust→`installPack`→lock. |
| `src/install/errors.ts` (modify) | add `PackFetchError`, `UnsafePackEntryError`. |
| `src/cli.ts` (modify) | register the `add` subcommand. |
| `package.json` (modify) | add `nanotar`; rename to `@osxsystem/backpressure`; `private:false`; `version`; `prepare`. |
| `docs/USER_GUIDE.md`, `README.md` (modify) | document `add`. |
| `test/add/*.test.ts` (create) | sibling unit + `@acceptance` tests. |

---

## Task 1: `parseRef` — the `owner/repo[/subdir][@ref]` parser

**Files:**
- Create: `src/add/ref.ts`
- Test: `test/add/ref.test.ts`

**Interfaces:**
- Produces: `PackRef = { owner: string; repo: string; subdir?: string; ref?: string }`,
  `parseRef(arg: string): PackRef`, and an `InvalidPackRefError` (added in `errors.ts`).

- [ ] **Step 1: Add the error class.** Append to `src/install/errors.ts`:

```ts
/** Thrown when the `add` argument is not a valid `owner/repo[/subdir][@ref]`. */
export class InvalidPackRefError extends InstallError {
  constructor(arg: string) {
    super(`invalid pack reference "${arg}". Expected owner/repo[/subdir][@ref].`);
    this.name = "InvalidPackRefError";
  }
}
```

- [ ] **Step 2: Write the failing test.** Create `test/add/ref.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRef } from "../../src/add/ref.js";
import { InvalidPackRefError } from "../../src/install/errors.js";

describe("parseRef", () => {
  it("parses owner/repo", () => {
    expect(parseRef("osxsystem/backpressure")).toEqual({
      owner: "osxsystem",
      repo: "backpressure",
    });
  });
  it("parses an @ref", () => {
    expect(parseRef("osxsystem/backpressure@v1.2.0")).toEqual({
      owner: "osxsystem",
      repo: "backpressure",
      ref: "v1.2.0",
    });
  });
  it("parses a subdir before the @ref", () => {
    expect(parseRef("osxsystem/backpressure/packs/loop@main")).toEqual({
      owner: "osxsystem",
      repo: "backpressure",
      subdir: "packs/loop",
      ref: "main",
    });
  });
  it.each(["", "noslash", "owner/", "/repo", "owner/repo@", "a/b/../c"])(
    "rejects %j",
    (bad) => expect(() => parseRef(bad)).toThrow(InvalidPackRefError),
  );
});
```

- [ ] **Step 3: Run it; verify it fails.** Run: `pnpm exec vitest run test/add/ref.test.ts`
  Expected: FAIL ("parseRef is not a function").

- [ ] **Step 4: Implement `src/add/ref.ts`:**

```ts
import { InvalidPackRefError } from "../install/errors.js";

/** A parsed `owner/repo[/subdir][@ref]` GitHub pack reference. */
export interface PackRef {
  owner: string;
  repo: string;
  /** Path within the repo to the pack root (where backpressure.json lives). */
  subdir?: string;
  /** Branch, tag, or SHA; undefined → the repo's default branch. */
  ref?: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Parse `owner/repo[/subdir][@ref]`. Throws {@link InvalidPackRefError}. */
export function parseRef(arg: string): PackRef {
  const at = arg.indexOf("@");
  const ref = at === -1 ? undefined : arg.slice(at + 1);
  const path = at === -1 ? arg : arg.slice(0, at);
  if (at !== -1 && !ref) throw new InvalidPackRefError(arg);

  const parts = path.split("/");
  if (parts.length < 2) throw new InvalidPackRefError(arg);
  const [owner, repo, ...rest] = parts;
  const subdir = rest.length ? rest.join("/") : undefined;

  const all = [owner, repo, ...rest, ...(ref ? [ref] : [])];
  if (all.some((s) => !s || !SEGMENT.test(s))) throw new InvalidPackRefError(arg);

  return { owner, repo, ...(subdir ? { subdir } : {}), ...(ref ? { ref } : {}) };
}
```

- [ ] **Step 5: Run the test; verify it passes.** Run: `pnpm exec vitest run test/add/ref.test.ts` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/add/ref.ts test/add/ref.test.ts src/install/errors.ts
git commit -m "feat(add): parseRef for owner/repo[/subdir][@ref]"
```

---

## Task 2: `safeResolve` — the zip-slip guard

**Files:**
- Create: `src/add/safejoin.ts`
- Modify: `src/install/errors.ts` (add `UnsafePackEntryError`)
- Test: `test/add/safejoin.test.ts`

**Interfaces:**
- Produces: `safeResolve(root: string, entry: string): string`,
  `UnsafePackEntryError`.

- [ ] **Step 1: Add the error.** Append to `src/install/errors.ts`:

```ts
/** Thrown when a fetched tar entry would escape the extraction root (zip-slip). */
export class UnsafePackEntryError extends InstallError {
  constructor(entry: string) {
    super(`refusing unsafe pack entry "${entry}" (path traversal).`);
    this.name = "UnsafePackEntryError";
  }
}
```

- [ ] **Step 2: Write the failing test.** Create `test/add/safejoin.test.ts`:

```ts
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { safeResolve } from "../../src/add/safejoin.js";
import { UnsafePackEntryError } from "../../src/install/errors.js";

const root = resolve("/tmp/extract-root");

describe("safeResolve", () => {
  it("resolves a normal nested entry under root", () => {
    expect(safeResolve(root, "a/b/c.txt")).toBe(join(root, "a/b/c.txt"));
  });
  it.each(["../escape", "a/../../escape", "/etc/passwd", "", "a/../.."])(
    "rejects %j",
    (bad) => expect(() => safeResolve(root, bad)).toThrow(UnsafePackEntryError),
  );
});
```

- [ ] **Step 3: Run it; verify it fails.** Run: `pnpm exec vitest run test/add/safejoin.test.ts` → FAIL.

- [ ] **Step 4: Implement `src/add/safejoin.ts`:**

```ts
import { isAbsolute, resolve, sep } from "node:path";
import { UnsafePackEntryError } from "../install/errors.js";

/**
 * Resolve `entry` (a tar member name) under `root`, guaranteeing the result stays
 * inside `root`. Rejects empty names, absolute paths, and any `..` traversal.
 * Returns the absolute on-disk path. Pure (no I/O).
 */
export function safeResolve(root: string, entry: string): string {
  if (!entry || isAbsolute(entry)) throw new UnsafePackEntryError(entry);
  const abs = resolve(root, entry);
  const prefix = resolve(root) + sep;
  if (abs !== resolve(root) && !abs.startsWith(prefix)) {
    throw new UnsafePackEntryError(entry);
  }
  return abs;
}
```

- [ ] **Step 5: Run the test; verify it passes.** `pnpm exec vitest run test/add/safejoin.test.ts` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/add/safejoin.ts test/add/safejoin.test.ts src/install/errors.ts
git commit -m "feat(add): zip-slip-safe safeResolve for tar extraction"
```

---

## Task 3: `fetchPack` — pin the SHA, download, extract (adds `nanotar`)

**Files:**
- Create: `src/add/fetch.ts`
- Modify: `src/install/errors.ts` (add `PackFetchError`); `package.json` (add `nanotar`)
- Test: `test/add/fetch.test.ts`

**Interfaces:**
- Consumes: `PackRef` (Task 1), `safeResolve` (Task 2), `InstallIo` (existing,
  from `src/install/init.ts` — `ensureDir`, and a new `writeBytes`; see Step 4a).
- Produces:
  - `PackFetcher = { resolveSha(ref: PackRef): Promise<string>; downloadTarball(ref: PackRef, sha: string): Promise<Uint8Array>; }`
  - `nodePackFetcher: PackFetcher`
  - `fetchPack(ref: PackRef, io: BytesIo, fetcher: PackFetcher): Promise<{ dir: string; sha: string }>`
  - `BytesIo = { ensureDir(p: string): Promise<void>; writeBytes(p: string, data: Uint8Array): Promise<void>; mkdtemp(prefix: string): Promise<string>; }`

- [ ] **Step 1: Add `nanotar` (the one allowed dependency).**

Run: `pnpm add nanotar`
Expected: `package.json` `dependencies` gains `"nanotar": "^0.2.0"` (or current),
`pnpm-lock.yaml` updates with `nanotar` only.

- [ ] **Step 2: Add the error.** Append to `src/install/errors.ts`:

```ts
/** Thrown when fetching a pack from GitHub fails (network, 404, 403, private). */
export class PackFetchError extends InstallError {
  constructor(message: string) {
    super(message);
    this.name = "PackFetchError";
  }
}
```

- [ ] **Step 3: Write the failing test.** Create `test/add/fetch.test.ts`. It builds a
  real gzipped tar in-memory with `nanotar` and injects a fake fetcher, so no
  network is touched:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTarGzip } from "nanotar";
import { describe, expect, it } from "vitest";
import { fetchPack } from "../../src/add/fetch.js";
import { nodeBytesIo } from "../../src/add/fetch.js";
import type { PackFetcher } from "../../src/add/fetch.js";

// GitHub tarballs wrap everything in a top-level "<repo>-<sha>/" dir.
async function fakeTarball(prefix: string): Promise<Uint8Array> {
  return createTarGzip([
    { name: `${prefix}/backpressure.json`, data: '{"name":"p"}' },
    { name: `${prefix}/scripts/gate.sh`, data: "#!/bin/sh\n", attrs: { mode: 0o755 } },
  ]);
}

describe("fetchPack", () => {
  it("pins the sha, strips the top dir, and extracts files to a temp dir", async () => {
    const sha = "a".repeat(40);
    const fetcher: PackFetcher = {
      resolveSha: async () => sha,
      downloadTarball: async () => fakeTarball(`backpressure-${sha}`),
    };
    const { dir, sha: pinned } = await fetchPack(
      { owner: "o", repo: "backpressure" },
      nodeBytesIo,
      fetcher,
    );
    expect(pinned).toBe(sha);
    expect(await readFile(join(dir, "backpressure.json"), "utf8")).toContain('"name":"p"');
    expect(await readFile(join(dir, "scripts/gate.sh"), "utf8")).toContain("#!/bin/sh");
  });
});
```

- [ ] **Step 4: Run it; verify it fails.** `pnpm exec vitest run test/add/fetch.test.ts` → FAIL.

- [ ] **Step 5: Implement `src/add/fetch.ts`:**

```ts
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseTarGzip } from "nanotar";
import { PackFetchError } from "../install/errors.js";
import type { PackRef } from "./ref.js";
import { safeResolve } from "./safejoin.js";

/** Network seam: resolve a ref to a SHA and download the repo tarball. */
export interface PackFetcher {
  resolveSha(ref: PackRef): Promise<string>;
  downloadTarball(ref: PackRef, sha: string): Promise<Uint8Array>;
}

/** Minimal fs seam for byte writes + temp dirs (kept separate from InstallIo). */
export interface BytesIo {
  ensureDir(p: string): Promise<void>;
  writeBytes(p: string, data: Uint8Array, mode?: number): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
}

export const nodeBytesIo: BytesIo = {
  ensureDir: async (p) => void (await mkdir(p, { recursive: true })),
  writeBytes: async (p, data, mode) => {
    await writeFile(p, data);
    if (mode !== undefined) await chmod(p, mode);
  },
  mkdtemp: (prefix) => mkdtemp(join(tmpdir(), prefix)),
};

const GH_API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";

function authHeaders(): Record<string, string> {
  const t = process.env.GITHUB_TOKEN;
  return {
    accept: "application/vnd.github+json",
    "user-agent": "backpressure-add",
    ...(t ? { authorization: `Bearer ${t}` } : {}),
  };
}

export const nodePackFetcher: PackFetcher = {
  async resolveSha(ref) {
    const r = ref.ref ?? (await defaultBranch(ref));
    const res = await fetch(`${GH_API}/repos/${ref.owner}/${ref.repo}/commits/${r}`, {
      headers: { ...authHeaders(), accept: "application/vnd.github.sha" },
    });
    if (res.status === 403) throw new PackFetchError("GitHub rate limit — set GITHUB_TOKEN.");
    if (!res.ok) throw new PackFetchError(`cannot resolve ${ref.owner}/${ref.repo}@${r} (${res.status}).`);
    return (await res.text()).trim();
  },
  async downloadTarball(ref, sha) {
    const res = await fetch(`${CODELOAD}/${ref.owner}/${ref.repo}/tar.gz/${sha}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new PackFetchError(`cannot download ${ref.owner}/${ref.repo}@${sha} (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  },
};

async function defaultBranch(ref: PackRef): Promise<string> {
  const res = await fetch(`${GH_API}/repos/${ref.owner}/${ref.repo}`, { headers: authHeaders() });
  if (!res.ok) throw new PackFetchError(`cannot read ${ref.owner}/${ref.repo} (${res.status}).`);
  return ((await res.json()) as { default_branch: string }).default_branch;
}

/**
 * Fetch + pin + extract a pack to a fresh temp dir. Resolves the ref to an
 * immutable SHA, downloads the GitHub tarball, gunzips + parses it (nanotar),
 * strips the leading `<repo>-<sha>/` wrapper, and writes each file under a temp
 * dir via {@link safeResolve} (zip-slip-safe). Honours `ref.subdir` as the pack
 * root. Returns the dir to hand to `installPack` plus the pinned SHA.
 */
export async function fetchPack(
  ref: PackRef,
  io: BytesIo,
  fetcher: PackFetcher,
): Promise<{ dir: string; sha: string }> {
  const sha = await fetcher.resolveSha(ref);
  const bytes = await fetcher.downloadTarball(ref, sha);
  const entries = await parseTarGzip(bytes);
  const root = await io.mkdtemp("bp-add-");

  // Strip GitHub's "<repo>-<sha>/" wrapper, then optional subdir.
  const stripPrefix = `${ref.repo}-${sha}/`;
  const subPrefix = ref.subdir ? `${ref.subdir.replace(/\/$/, "")}/` : "";

  let wrote = 0;
  for (const e of entries) {
    if (e.type !== "file" || !e.data) continue;
    if (!e.name.startsWith(stripPrefix)) continue;
    let rel = e.name.slice(stripPrefix.length);
    if (subPrefix) {
      if (!rel.startsWith(subPrefix)) continue;
      rel = rel.slice(subPrefix.length);
    }
    if (!rel) continue;
    const dest = safeResolve(root, rel);
    await io.ensureDir(dirname(dest));
    await io.writeBytes(dest, e.data, e.attrs?.mode);
    wrote++;
  }
  if (wrote === 0) throw new PackFetchError(`pack at ${ref.owner}/${ref.repo} is empty or subdir not found.`);
  return { dir: root, sha };
}
```

- [ ] **Step 6: Run the test; verify it passes.** `pnpm exec vitest run test/add/fetch.test.ts` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/add/fetch.ts test/add/fetch.test.ts src/install/errors.ts package.json pnpm-lock.yaml
git commit -m "feat(add): fetchPack — pin sha, download + nanotar-extract a GitHub pack"
```

---

## Task 4: `lock.ts` — the pin record

**Files:**
- Create: `src/add/lock.ts`
- Test: `test/add/lock.test.ts`

**Interfaces:**
- Produces: `PackLock = { source: string; ref: string; sha: string }`,
  `serializeLock(lock: PackLock): string`.

- [ ] **Step 1: Write the failing test.** Create `test/add/lock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serializeLock } from "../../src/add/lock.js";

describe("serializeLock", () => {
  it("serializes a trailing-newline JSON lock", () => {
    const out = serializeLock({ source: "o/r", ref: "main", sha: "a".repeat(40) });
    expect(JSON.parse(out)).toEqual({ source: "o/r", ref: "main", sha: "a".repeat(40) });
    expect(out.endsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** `pnpm exec vitest run test/add/lock.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/add/lock.ts`:**

```ts
/** The pin written to `.backpressure/backpressure.lock` after a successful add. */
export interface PackLock {
  /** `owner/repo[/subdir]` the pack came from. */
  source: string;
  /** The ref the user asked for (branch/tag/sha, or the resolved default branch). */
  ref: string;
  /** The immutable commit SHA the install was pinned to. */
  sha: string;
}

/** Serialize a {@link PackLock} to its on-disk JSON text (trailing newline). */
export function serializeLock(lock: PackLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}
```

- [ ] **Step 4: Run the test; verify it passes.** `pnpm exec vitest run test/add/lock.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/add/lock.ts test/add/lock.test.ts
git commit -m "feat(add): backpressure.lock pin record"
```

---

## Task 5: `trust.ts` — the trust summary + prompter seam

**Files:**
- Create: `src/add/trust.ts`
- Test: `test/add/trust.test.ts`

**Interfaces:**
- Consumes: `PackManifest` (existing, `src/add/manifest.ts` — has `items`, `scripts`).
- Produces:
  - `summarizeTrust(manifest: PackManifest, source: string, sha: string): string` (pure)
  - `Prompter = { confirm(summary: string): Promise<boolean>; }`
  - `confirmInstall(manifest, source, sha, prompter, opts: { yes?: boolean }): Promise<void>`
    (throws `InstallError("install declined")` when not confirmed).

- [ ] **Step 1: Write the failing test.** Create `test/add/trust.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { confirmInstall, summarizeTrust } from "../../src/add/trust.js";
import { InstallError } from "../../src/install/errors.js";

const manifest = {
  name: "loop",
  version: "1",
  targets: ["claude"],
  items: [{ type: "hook", event: "Stop", command: "./scripts/gate.sh" }],
  scripts: ["scripts/gate.sh"],
} as never;

describe("trust", () => {
  it("summary names the source@sha and every hook command + script", () => {
    const s = summarizeTrust(manifest, "o/r", "a".repeat(40));
    expect(s).toContain(`o/r@${"a".repeat(40)}`);
    expect(s).toContain("./scripts/gate.sh"); // hook command
    expect(s).toContain("scripts/gate.sh"); // executable script
  });
  it("--yes skips the prompt", async () => {
    await expect(
      confirmInstall(manifest, "o/r", "x", { confirm: async () => false }, { yes: true }),
    ).resolves.toBeUndefined();
  });
  it("throws when the prompt is declined", async () => {
    await expect(
      confirmInstall(manifest, "o/r", "x", { confirm: async () => false }, {}),
    ).rejects.toThrow(InstallError);
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** `pnpm exec vitest run test/add/trust.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/add/trust.ts`:**

```ts
import { InstallError } from "../install/errors.js";
import type { PackManifest } from "./manifest.js";

/** Prompt seam: ask the user to confirm an install. */
export interface Prompter {
  confirm(summary: string): Promise<boolean>;
}

/**
 * Build the human-readable trust summary `add` shows before writing: the pinned
 * `source@sha`, then every hook command that will fire on a gate and every
 * executable script the pack installs — the third-party code that later runs on
 * the user's machine. Pure.
 */
export function summarizeTrust(manifest: PackManifest, source: string, sha: string): string {
  const lines = [`About to install ${source}@${sha}`, `  pack: ${manifest.name}@${manifest.version}`];
  const hooks = manifest.items.filter((i) => i.type === "hook");
  if (hooks.length) {
    lines.push("  hook commands (run on the Stop gate):");
    for (const h of hooks) lines.push(`    - ${(h as { command: string }).command}`);
  }
  if (manifest.scripts.length) {
    lines.push("  executable scripts:");
    for (const s of manifest.scripts) lines.push(`    - ${s}`);
  }
  return lines.join("\n");
}

/**
 * Show {@link summarizeTrust} and require confirmation, unless `opts.yes`. Throws
 * an {@link InstallError} when the user declines, so the caller writes nothing.
 */
export async function confirmInstall(
  manifest: PackManifest,
  source: string,
  sha: string,
  prompter: Prompter,
  opts: { yes?: boolean },
): Promise<void> {
  if (opts.yes) return;
  const ok = await prompter.confirm(summarizeTrust(manifest, source, sha));
  if (!ok) throw new InstallError("install declined.");
}
```

- [ ] **Step 4: Run the test; verify it passes.** `pnpm exec vitest run test/add/trust.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/add/trust.ts test/add/trust.test.ts
git commit -m "feat(add): trust summary + prompter seam"
```

---

## Task 6: `addPack` — the orchestrator

**Files:**
- Create: `src/add/add.ts`
- Test: `test/add/add.test.ts`

**Interfaces:**
- Consumes: `parseRef` (T1), `fetchPack` + `PackFetcher` + `BytesIo` (T3),
  `serializeLock` (T4), `confirmInstall` + `Prompter` (T5), and the existing
  `installPack` (`src/add/install-pack.ts`), `parseManifest` (`src/add/manifest.ts`),
  `InstallIo`/`nodeInstallIo` (`src/install/init.ts`), `InstallChoice` (`src/add/pack.ts`).
- Produces:
  - `AddDeps = { io: InstallIo; bytesIo: BytesIo; fetcher: PackFetcher; prompter: Prompter }`
  - `AddOptions = { choice: InstallChoice; baseDir: string; yes?: boolean }`
  - `addPack(arg: string, opts: AddOptions, deps: AddDeps): Promise<{ files: string[]; sha: string; notices: string[] }>`

- [ ] **Step 1: Write the failing test.** Create `test/add/add.test.ts`. It fakes the
  network (a `nanotar` tarball) and auto-confirms, then asserts the pack installed
  and the lock was written:

```ts
import { readFile, stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTarGzip } from "nanotar";
import { describe, expect, it } from "vitest";
import { addPack } from "../../src/add/add.js";
import { nodeBytesIo } from "../../src/add/fetch.js";
import { nodeInstallIo } from "../../src/install/init.js";

const SHA = "b".repeat(40);
const manifest = JSON.stringify({
  name: "demo",
  version: "1.0.0",
  targets: ["claude"],
  items: [{ type: "command", name: "demo", path: "commands/demo.md" }],
  scripts: [],
});

describe("addPack (@acceptance)", () => {
  it("fetches, trust-gates, installs, and writes the lock", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-addbase-"));
    const files = [
      { name: `demo-${SHA}/backpressure.json`, data: manifest },
      { name: `demo-${SHA}/commands/demo.md`, data: "# Demo command\n" },
    ];
    const { files: written, sha } = await addPack(
      "o/demo",
      { choice: "claude", baseDir: base, yes: true },
      {
        io: nodeInstallIo,
        bytesIo: nodeBytesIo,
        fetcher: {
          resolveSha: async () => SHA,
          downloadTarball: async () => createTarGzip(files),
        },
        prompter: { confirm: async () => true },
      },
    );
    expect(sha).toBe(SHA);
    expect(written).toContain(".claude/commands/demo.md");
    const lock = JSON.parse(await readFile(join(base, ".backpressure/backpressure.lock"), "utf8"));
    expect(lock).toMatchObject({ source: "o/demo", sha: SHA });
    await expect(stat(join(base, ".claude/commands/demo.md"))).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** `pnpm exec vitest run test/add/add.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/add/add.ts`:**

```ts
import { join } from "node:path";
import { type InstallIo, nodeInstallIo } from "../install/init.js";
import { type BytesIo, type PackFetcher, fetchPack, nodeBytesIo } from "./fetch.js";
import { installPack } from "./install-pack.js";
import { serializeLock } from "./lock.js";
import { parseManifest } from "./manifest.js";
import type { InstallChoice } from "./pack.js";
import { parseRef } from "./ref.js";
import { type Prompter, confirmInstall } from "./trust.js";

/** Injectable side-effect seams for {@link addPack}. */
export interface AddDeps {
  io: InstallIo;
  bytesIo: BytesIo;
  fetcher: PackFetcher;
  prompter: Prompter;
}

/** Caller choices for {@link addPack}. */
export interface AddOptions {
  choice: InstallChoice;
  baseDir: string;
  yes?: boolean;
}

/**
 * Install a GitHub-hosted capability pack: parse the ref, fetch + pin it, gate it
 * behind the trust prompt, install via the Phase-1 {@link installPack}, then write
 * `.backpressure/backpressure.lock`. Returns the written files, the pinned SHA,
 * and any per-target skip notices.
 */
export async function addPack(
  arg: string,
  opts: AddOptions,
  deps: AddDeps = {
    io: nodeInstallIo,
    bytesIo: nodeBytesIo,
    fetcher: (await import("./fetch.js")).nodePackFetcher,
    prompter: { confirm: async () => false },
  },
): Promise<{ files: string[]; sha: string; notices: string[] }> {
  const ref = parseRef(arg);
  const { dir, sha } = await fetchPack(ref, deps.bytesIo, deps.fetcher);

  const manifest = parseManifest(await deps.io.readText(join(dir, "backpressure.json")));
  const source = ref.subdir ? `${ref.owner}/${ref.repo}/${ref.subdir}` : `${ref.owner}/${ref.repo}`;
  await confirmInstall(manifest, source, sha, deps.prompter, { yes: opts.yes });

  const { installed, notices } = await installPack(dir, opts.choice, opts.baseDir, deps.io);

  const lockPath = join(opts.baseDir, ".backpressure", "backpressure.lock");
  await deps.io.ensureDir(join(opts.baseDir, ".backpressure"));
  await deps.io.writeText(lockPath, serializeLock({ source, ref: ref.ref ?? "default", sha }));

  return { files: installed.files, sha, notices };
}
```

> **Note on the default `deps`:** the inline `await import` in a default parameter is
> awkward. If biome/tsc flags it, instead default `deps` to `undefined` and resolve
> `nodePackFetcher` at the top of the body:
> `const d = deps ?? { io: nodeInstallIo, bytesIo: nodeBytesIo, fetcher: nodePackFetcher, prompter: ttyPrompter };`
> with `nodePackFetcher` imported normally. Pick whichever the gate accepts; the CLI
> (Task 7) passes explicit `deps` anyway, so the default is only a convenience.

- [ ] **Step 4: Run the test; verify it passes.** `pnpm exec vitest run test/add/add.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/add/add.ts test/add/add.test.ts
git commit -m "feat(add): addPack orchestrator (ref -> fetch -> trust -> installPack -> lock)"
```

---

## Task 7: wire the `add` CLI subcommand

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts` (append)

**Interfaces:**
- Consumes: `addPack`, `AddDeps` (T6); `nodeInstallIo` (existing), `nodeBytesIo`
  + `nodePackFetcher` (T3); `parseTarget` (existing).
- Produces: an `add` command registered on the program; a TTY `Prompter` helper
  `ttyConfirm` (reads y/N from stdin).

- [ ] **Step 1: Write the failing test.** Append to `test/cli.test.ts`:

```ts
describe("add subcommand", () => {
  it("@acceptance registers add with --target/--global/--yes and is not a stub", () => {
    const add = buildProgram().commands.find((c: commander.Command) => c.name() === "add");
    expect(add).toBeDefined();
    const flags = add?.options.map((o: { long?: string }) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--target", "--global", "--yes"]));
    expect(add?.description().toLowerCase()).not.toContain("not yet implemented");
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** `pnpm exec vitest run test/cli.test.ts -t "add subcommand"` → FAIL.

- [ ] **Step 3: Implement the command in `src/cli.ts`.** Add imports near the top:

```ts
import { addPack } from "./add/add.js";
import { nodeBytesIo, nodePackFetcher } from "./add/fetch.js";
import { createInterface } from "node:readline/promises";
```

Add a TTY prompter helper above `buildProgram`:

```ts
/** Read a y/N confirmation from stdin (used by `add`'s trust gate). */
async function ttyConfirm(summary: string): Promise<boolean> {
  process.stdout.write(`${summary}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question("Proceed? [y/N] ")).trim().toLowerCase();
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}
```

Register the command inside `buildProgram` (after the `index` command):

```ts
program
  .command("add")
  .argument("<owner/repo>", "GitHub pack reference: owner/repo[/subdir][@ref]")
  .description("Install a capability pack from a GitHub repo into this repo.")
  .option("--target <target>", "Which CLI to compile for (claude or codex).", "claude")
  .option("--global", "Install into the user-level dirs (~/.claude or ~/.codex).")
  .option("--yes", "Skip the trust confirmation prompt (for CI).")
  .action(async (ref: string, options: { target: string; global?: boolean; yes?: boolean }) => {
    try {
      const choice = parseTarget(options.target);
      const baseDir = options.global ? homedir() : cwd();
      const { files, sha, notices } = await addPack(
        ref,
        { choice, baseDir, yes: options.yes },
        { io: nodeInstallIo, bytesIo: nodeBytesIo, fetcher: nodePackFetcher, prompter: { confirm: ttyConfirm } },
      );
      for (const f of files) process.stdout.write(`Wrote: ${join(baseDir, f)}\n`);
      for (const n of notices) process.stdout.write(`Note: ${n}\n`);
      process.stdout.write(`pinned ${ref}@${sha}\n`);
    } catch (e) {
      const line = cliErrorLine(e);
      if (line === null) throw e;
      process.stderr.write(`${line}\n`);
      process.exitCode = 1;
    }
  });
```

> `parseTarget` returns `"claude" | "codex"`, both valid `InstallChoice`s. `--global`
> maps to `homedir()` exactly as `init` does; the existing `cliErrorLine` catch turns
> every typed error (bad ref, 404, declined, zip-slip) into one clean line.

- [ ] **Step 4: Run the test; verify it passes.** `pnpm exec vitest run test/cli.test.ts -t "add subcommand"` → PASS.

- [ ] **Step 5: Run the whole gate.** `pnpm run check && pnpm test` → all green.

- [ ] **Step 6: Commit.**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat(cli): wire the add subcommand to addPack"
```

---

## Task 8: publish prep — scoped name, un-private, build-on-install

**Files:**
- Modify: `package.json`
- Test: `test/cli.test.ts` (append a packaging assertion) + a manual `npm pack` check

**Interfaces:**
- No code interfaces. This task makes `npx @osxsystem/backpressure@latest` resolve to
  this package and ensures a publish/`git`-install produces a runnable `dist/`.

- [ ] **Step 1: Write the failing test.** Append to `test/cli.test.ts`:

```ts
import { readFile as readPkg } from "node:fs/promises";
describe("package manifest", () => {
  it("@acceptance publishes as a scoped, public package with the pack included", async () => {
    const pkg = JSON.parse(await readPkg(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.name).toBe("@osxsystem/backpressure");
    expect(pkg.private).toBe(false);
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "skills", "packs"]));
    expect(pkg.bin.backpressure).toBe("./dist/cli.js");
  });
});
```

- [ ] **Step 2: Run it; verify it fails.** `pnpm exec vitest run test/cli.test.ts -t "package manifest"` → FAIL.

- [ ] **Step 3: Edit `package.json`:**

```jsonc
{
  "name": "@osxsystem/backpressure",
  "version": "0.1.0",
  "private": false,
  "publishConfig": { "access": "public" },
  // ... files already includes dist, skills, packs ...
  "scripts": {
    "build": "tsup",
    "prepare": "tsup",          // build on `npm install` from git + before publish
    "test": "vitest run",
    "test:acceptance": "vitest run -t @acceptance",
    "check": "biome check . && tsc --noEmit"
  }
}
```

> `bin` stays `{"backpressure": "./dist/cli.js"}` — the bin *name* is independent of
> the scoped package name, so `npx @osxsystem/backpressure add …` still invokes the
> `backpressure` binary. `publishConfig.access: public` is required to publish a
> scoped package publicly. `prepare` makes `npm i git+https://…` build `dist/`.

- [ ] **Step 4: Run the test; verify it passes.** `pnpm exec vitest run test/cli.test.ts -t "package manifest"` → PASS.

- [ ] **Step 5: Verify the publish contents include CLI + pack.**

Run: `npm pack --dry-run 2>&1 | grep -E "dist/cli.js|packs/backpressure-loop/backpressure.json|skills/"`
Expected: all three appear in the listing.

- [ ] **Step 6: Commit.**

```bash
git add package.json test/cli.test.ts
git commit -m "chore: publish as @osxsystem/backpressure (public, build-on-install)"
```

> **Human-only follow-up (NOT in the loop):** `npm login` then
> `npm publish` (or `pnpm publish --access public`). The loop never publishes.

---

## Task 9: document `add` for end users

**Files:**
- Modify: `docs/USER_GUIDE.md`, `README.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Add an `add` section to `docs/USER_GUIDE.md`** in the CLI command
  table and a subsection. Add the row to the command table:

```markdown
| `add`    | ✅ wired | Fetch and install a capability pack from a GitHub repo. |
```

And the subsection (after `### backpressure index`):

````markdown
### `backpressure add <owner/repo>[@ref]`

Fetch a capability pack from a GitHub repo and install it into the current repo.
The remote counterpart of `init --from <dir>`: it resolves the ref to an immutable
commit SHA, downloads the repo tarball, validates `backpressure.json`, shows a
trust summary (the source `@sha`, every hook command, every executable script),
and on confirmation installs via the same writer as `init --from`, recording the
pin in `.backpressure/backpressure.lock`.

```bash
npx @osxsystem/backpressure@latest add osxsystem/backpressure
```

| Option | Default | Meaning |
|--------|---------|---------|
| `<owner/repo>[/subdir][@ref]` | — | The pack's GitHub location; `@ref` is a branch/tag/SHA (default: the repo's default branch). |
| `--target <target>` | `claude` | `claude` or `codex` (must be in the pack's `targets`). |
| `--global` | off | Install into `~/.claude` / `~/.codex` instead of the repo. |
| `--yes` | off | Skip the trust prompt (for CI). |

Set `GITHUB_TOKEN` to raise the API rate limit or install from a private repo.
````

- [ ] **Step 2: Update `README.md`** — in the "Running an autonomous loop" section,
  add the one-line install above the `/backpressure-loop` description:

```markdown
Install the launcher into any repo with one line:

​```bash
npx @osxsystem/backpressure@latest add osxsystem/backpressure
​```
```

- [ ] **Step 3: Run the gate.** `pnpm run check && pnpm test` → green (docs-only, but
  confirm nothing regressed).

- [ ] **Step 4: Commit.**

```bash
git add docs/USER_GUIDE.md README.md
git commit -m "docs: document backpressure add (remote pack install)"
```

---

## Self-review notes (author's pass against the spec)

- **Spec §5 pipeline** — steps 1–8 map to Tasks 1 (parse), 3 (fetch+pin+extract),
  manifest validate (reused `parseManifest`), trust (Task 5), compile+write (reused
  `planPack`/`installPack`), lock+report (Task 6/7). ✅
- **Spec §7 modules** — `ref`/`fetch`/`safejoin`/`trust` built new; `plan.ts`/
  `write.ts` are **intentionally not** created — Phase 1's `planPack`/`installPack`
  already do that job (DRY; the spec predates Phase 1's implementation). Noted here
  so a reviewer doesn't flag the rename as a gap.
- **Spec §8 deps** — exactly `nanotar`; gzip via Node `DecompressionStream` inside
  `parseTarGzip`. ✅
- **Spec §9 errors** — `InvalidPackRefError`, `UnsafePackEntryError`, `PackFetchError`
  added; 404/403/private surfaced in `nodePackFetcher`. ✅
- **Spec §10 security** — SHA pin (Task 3/4), trust gate (Task 5), zip-slip guard
  (Task 2). ✅
- **Deferred (not in this plan, call out to the user):** idempotent re-install /
  `remove` reversal from `installed.json` (spec §9 "idempotent"), the interactive
  multi-select target picker and `--global/--local`/`--link` flags (spec §3 picker/
  link), and the `nanotar` parse of GNU/pax long-name records beyond what
  `parseTarGzip` handles. These are follow-ups; the plan ships the core
  `add owner/repo` happy path + trust + safety that the end-user command needs.
```
