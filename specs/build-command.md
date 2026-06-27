# backpressure build (real) — a read-only "compile per target" preview/stage command

## What to build

Turn the `backpressure build` subcommand from a no-op stub
(`src/cli.ts:174-179`, which prints `build: not yet implemented`) into a real,
read-only **"compile per target"** command. Its job is to surface the
*compiled per-target config artifacts* — the literal text of
`.claude/settings.json`, `.claude/agents/<name>.md`, and `.codex/config.toml` —
produced from the single source of truth (`InstallCapabilities` /
`DEFAULT_CAPABILITIES`), **without** running `init` and writing into a live
target repo.

Concretely:

- New module `src/install/build.ts` exports
  `build(target: AgentTarget, opts?: BuildOptions): Promise<WriteOp[]>`.
  It computes the per-target file layout with the existing pure planner
  `planInstall` (`src/install/plan.ts:86`) and derives each artifact's contents
  with the existing compile core factored out of `init.ts` (see below) plus the
  existing adapter emitters (`emitClaudeHooks` / `emitClaudeMcp` /
  `emitClaudeAgents` / `emitCodexHooks` / `emitCodexMcp` / `emitCodexAgents`).
  `BuildOptions` = `{ capabilities?, skillsSourceDir?, io?, out? }`, defaulting
  to `DEFAULT_CAPABILITIES`, `bundledSkillsDir()`, and `nodeInstallIo`.
- The currently-private `buildWrites` in `src/install/init.ts:157-235` is
  factored into a shared, **exported** `compileArtifacts(...)` (identical logic,
  no behavior change) and the `WriteOp` union (`src/install/init.ts:147-149`) is
  exported. Both `init()` and `build()` call `compileArtifacts`, so the
  per-target emit branching exists in exactly one place.
- `build()` with **no `out`** returns the compiled `WriteOp[]` and writes
  nothing (it never calls `io.ensureDir` / `io.writeText` / `io.copyFile`).
- `build()` with **`out: <dir>`** stages the compiled **config** artifacts
  (the `op:"write"` entries) under `<dir>` through the injected `InstallIo`,
  then returns the ops. `<dir>` is a scratch/staging dir, never a live target
  repo.
- An exported pure renderer `formatArtifacts(ops: WriteOp[]): string` formats the
  ops for stdout: each `op:"write"` artifact is preceded by a `// <relpath>`
  header line and followed by its raw contents; each `op:"copy"` (portable skill
  file) is surfaced as a `// copy <relpath>` reference line only (bytes are NOT
  dumped — skills are tier "portable", installed verbatim by `init`, not
  "compiled per target").
- `src/cli.ts` wires the `build` subcommand to this logic: `--target
  <claude|codex>` (default `claude`, validated through the existing
  `parseTarget`) and `--out <dir>`. With no `--out` it prints
  `formatArtifacts(await build(target))` to stdout and exits 0, writing nothing.
  With `--out` it stages via `build(target, { out })` and prints the staged
  paths. The help string is reworded off "Build the distributable artifacts
  (stub)." so it does not read as "bundle the npm package".

`build` is entirely independent of `pnpm run build` (tsup): it never invokes
tsup and never writes `dist/`.

## Acceptance criteria

1. `backpressure build` with the default `--target claude` exits 0 and prints to
   stdout the compiled `.claude/settings.json` contents (parseable JSON whose
   `hooks.Stop` carries the `pnpm test` command) and a `.claude/agents/reviewer.md`
   artifact; the literal string `not yet implemented` is never emitted by `build`.
2. `backpressure build --target codex` exits 0 and yields exactly one
   `.codex/config.toml` write artifact whose text matches `event = "Stop"` and
   `command = "pnpm test"` and contains an `[agents.reviewer]` table.
3. Run without `--out`, `build` is read-only: `build(target, …)` never calls the
   mutating `InstallIo` methods (`ensureDir` / `writeText` / `copyFile`), and a
   fresh `mkdtemp` cwd stays empty after a `backpressure build` invocation.
4. With `--out <dir>`, the compiled config artifacts appear under `<dir>` at
   their per-target relative paths (`<dir>/.claude/settings.json`,
   `<dir>/.claude/agents/reviewer.md`, or `<dir>/.codex/config.toml`) and nowhere
   outside `<dir>`; re-running into a clean `<dir>` produces byte-identical files
   (deterministic).
5. Under the v0 default (no MCP servers) `build` emits NO `.mcp.json` artifact
   (Claude) and NO `[mcp_servers]` table in `.codex/config.toml` (Codex),
   matching `planInstall` / `init` parity.
6. `build`'s compiled config bytes are identical to what `init` would write for
   the same capabilities (both routed through the single exported
   `compileArtifacts`), and `src/install/build.ts` introduces no new per-target
   branch (no `target ===` / `if (target` substring): the only `which-CLI`
   branching remains in `src/seam`, `src/adapters`, and the shared
   `compileArtifacts` / `planInstall` path.
7. `backpressure build` does not run tsup and creates no `dist/` directory; it is
   independent of `pnpm run build`, and the existing registration/help assertions
   in `test/cli.test.ts` still pass.
8. `src/install/build.ts` ships together with its sibling
   `test/install/build.test.ts` in the same change (repo's source+test convention).

## Acceptance tests

1. `@acceptance build --target claude prints compiled .claude/settings.json (Stop=pnpm test) and reviewer agent, never "not yet implemented"`
2. `@acceptance build --target codex yields a single .codex/config.toml with the Stop hook and [agents.reviewer]`
3. `@acceptance build without --out is read-only (mutating InstallIo never called; fresh cwd stays empty)`
4. `@acceptance build --out <dir> stages config artifacts only under <dir>, deterministically on rerun`
5. `@acceptance build emits no .mcp.json and no [mcp_servers] table under the v0 default (no MCP servers)`
6. `@acceptance build's config bytes equal init's and build.ts adds no per-target branch (shared compileArtifacts)`
7. `@acceptance build writes no dist/ and is independent of pnpm run build (tsup)`
8. `@acceptance src/install/build.ts ships with its sibling test/install/build.test.ts`

## Files to touch

- `src/install/init.ts` — factor private `buildWrites` (`:157-235`) into an
  exported `compileArtifacts`; export the `WriteOp` type (`:147-149`); have
  `init()` call the shared function (no behavior change).
- `src/install/build.ts` — **new**: `build()`, `BuildOptions`, and the pure
  `formatArtifacts()` renderer; reuses `planInstall` + `compileArtifacts` +
  adapter emitters.
- `src/cli.ts` — replace the `build` stub action (`:174-179`) with `--target` /
  `--out` wiring; reword the help description off "distributable artifacts
  (stub)". Leave the `index` stub (`:181-186`) untouched.
- `test/install/build.test.ts` — **new** sibling test covering criteria 1-8
  (modeled on `test/install/init.test.ts`: `mkdtemp` + real `bundledSkillsDir()`,
  or an injected `InstallIo` to assert read-only / staging).
- `test/cli.test.ts` — add a CLI-level assertion that `build` produces the
  compiled output (and no longer prints "not yet implemented"); keep the existing
  registration/help assertions green.
- `docs/USER_GUIDE.md` — document `backpressure build` as a real compile/preview
  command (`--target`, `--out`).
- `docs/RALPH_PRODUCTION_GUIDE.md` — drop `build` from the "v0 stub / not yet
  implemented" list (`:380-381`, `:1574`).

## Why these choices

Recorded so a future amnesiac loop cannot "simplify" the behavior back into the
stub or fold it into `init`/tsup:

- **`build` is the project's missing first-class verb.** The architecture
  (`backpressure-architecture.html:282-283`) and `CLAUDE.md` frame the whole
  project as "author once, compile per target". Today the only code that
  *compiles* also *installs* (`init`), and `init --dry-run` previews planned
  *paths* but never the compiled *contents* (`src/install/init.ts:274-276`).
  There is deliberately a standalone, read-only surface that shows the actual
  emitted config text. Do not delete `build` as "redundant with init/dry-run" —
  preview-of-contents-without-install is the whole point.
- **Single compile core, reused — not re-implemented.** `build` MUST route
  through the exported `compileArtifacts` (the factored `buildWrites`) and
  `planInstall`. Criterion 6 (byte-parity with `init` + no `target ===` branch in
  `build.ts`) is the guard: if a later loop hand-rolls a second emit path or a
  third `which-CLI` branch, that test fails. The CLAUDE.md invariant — only
  `src/seam` and `src/adapters` may know a target's name — is preserved.
  (Pre-existing note: `src/install/plan.ts:94` already branches on
  `target === "claude"`; `build` reuses that path and adds no new branch site. We
  are NOT relocating plan.ts's branch as part of this concern.)
- **Read-only by default; `--out` opts into staging.** A preview command that
  silently wrote files would be a footgun and would collide with `init`. The
  default prints to stdout and touches nothing (criterion 3); `--out` stages into
  an explicit scratch dir (criterion 4). The read-only guarantee is asserted at
  the `InstallIo` boundary (mutating methods never called) so it cannot regress
  to "write into cwd".
- **Config-only artifacts; skills shown as references.** Skills are tier
  "portable" (identical bytes on both CLIs) — they are copied verbatim by `init`,
  not "compiled per target". `build`'s materialized/printed output is the
  genuinely compiled config (settings.json / config.toml / agents/*.md); skill
  trees appear only as `// copy <path>` reference lines. This keeps `build`
  deterministic and keeps `init` the sole installer of skill bytes. (Because
  `compileArtifacts` enumerates skill source trees, a missing skill source still
  surfaces as `MissingSkillSourceError`, so `build` inherits that honesty without
  a separate `verifySkills` write-gate.)
- **v0 MCP omission is load-bearing parity.** With no MCP servers (the v0
  default, `DEFAULT_CAPABILITIES.mcpServers: []`), `planInstall` omits `.mcp.json`
  and the Codex `[mcp_servers]` table entirely (`src/install/plan.ts:96-98`,
  `src/install/init.ts:225-231`). Criterion 5 pins `build` to the same omission
  so the preview never implies a config the installer would not write.
- **`build` ≠ `pnpm run build` (tsup).** The verb collides with the bundler
  script (`package.json` `scripts.build` = `tsup`) and with the stub's old help
  text. The task fixes the subcommand name as `build`, so the disambiguation is
  carried by (a) reworded help and (b) criterion 7 asserting no `dist/` is
  written — `backpressure build` compiles *target config*, it does not bundle the
  package.
- **Single-target, like `init`.** `--target` takes one CLI (default `claude`),
  not `all`/repeatable, to match `init`'s shape and keep the command predictable.
- **Source + test in one change.** The repo requires every `src/` file to land
  with its sibling test (CLAUDE.md conventions); criterion 8 makes that explicit
  so the new module cannot ship untested.

## Out of scope / non-goals

- The `index` subcommand (`src/cli.ts:181-186`) stays a stub — separate concern.
- No change to `pnpm run build` / tsup, `dist/`, or `test/build.test.ts` (that
  test exercises the bundler, not this subcommand).
- `build` does not byte-copy skill trees and is not a second installer; `init`
  remains the only command that writes skills into a repo.
- No MCP servers are introduced; the v0 MCP omission is preserved, not revisited.
- No `--target all`, no multi-target side-by-side diffing, no JSON-manifest output
  format (deferrable; the human-readable `// <relpath>` preview is the v0 surface).
- No new runtime dependencies; reuse zod/commander/smol-toml already in
  `package.json`.
