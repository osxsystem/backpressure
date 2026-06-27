# backpressure index (real) — a read-only installed-capability inventory

## What to build

Turn the `backpressure index` subcommand from a no-op stub
(`src/cli.ts:181-186`, which prints `index: not yet implemented`) into a real,
read-only **inventory** command. Its job is the inverse of `init`/`build`: given
a target and a repo, report which of the capabilities an install *would* write
(per `planInstall`) are actually **present on disk** — a manifest of "is
Backpressure installed here, and how completely?".

> **Definition note (intent — read before changing).** The design blueprint
> (`backpressure-architecture.html`) does **not** define `index`; only the stub's
> own description ("Index the installed capabilities") does. This spec *defines*
> `index` as a read-only inventory of the install footprint. A future loop must
> not silently redefine it as a search index, a build step, or a repair/doctor
> command — see "Why these choices".

Concretely:

- New module `src/install/inventory.ts` exports
  `inventory(target: AgentTarget, opts?: InventoryOptions): Promise<CapabilityEntry[]>`.
  `CapabilityEntry = { kind: "hooks" | "mcp" | "agent" | "skill"; path: string; present: boolean }`.
  `InventoryOptions = { capabilities?: InstallCapabilities; baseDir?: string; io?: ExistsIo }`,
  defaulting to `DEFAULT_CAPABILITIES`, `cwd()`, and a real `fs`-backed
  existence checker.
- `inventory` derives the candidate file list with the **existing pure planner**
  `planInstall(target, baseDir, capabilities)` (`src/install/plan.ts:86`), then
  checks each planned path for existence and returns one `CapabilityEntry` per
  planned file (same order as `planInstall`). It performs only existence checks —
  no reads of file *contents*, no writes.
- An exported pure renderer `formatInventory(entries: CapabilityEntry[]): string`
  formats the report: one line per entry — a present/absent marker (`[x]` /
  `[ ]`), the `kind`, and the path — followed by a summary line
  (`N/M capabilities installed`).
- `src/cli.ts` wires the `index` subcommand to this logic: `--target
  <claude|codex>` (default `claude`, validated through the existing
  `parseTarget`) and `--json`. With no `--json` it prints
  `formatInventory(await inventory(target, { baseDir: cwd() }))` to stdout and
  exits 0. With `--json` it prints `JSON.stringify(entries)` (an array of
  `{ kind, path, present }`). The help string is reworded off "Index the
  installed capabilities (stub)." `index` never writes anything and always
  exits 0 — it is a report, not a gate.

`index` is read-only and pairs with `build`: `build` shows what *would* be
compiled; `index` shows what is *actually installed*.

## Acceptance criteria

1. In a fresh repo with nothing installed, `inventory("claude", { baseDir })`
   returns an entry for every file `planInstall("claude", baseDir)` plans
   (`.claude/settings.json`, each `.claude/agents/<name>.md`, each
   `.claude/skills/<skill>/SKILL.md`), each with `present: false`; the result
   length equals `planInstall("claude", baseDir).length`.
2. After `init("claude", baseDir, …)` with the default capabilities,
   `inventory("claude", { baseDir })` marks the hooks file
   (`.claude/settings.json`), the `reviewer` agent, and the `building-adaptive-ui`
   skill all `present: true`, and lists **no** `.mcp.json` entry (v0 has no MCP
   servers, so `planInstall` omits it — the inventory matches that omission).
3. `inventory` is read-only: a fresh `mkdtemp` `baseDir` is byte-for-byte empty
   after the call (no file or directory is created), and the injected `io`'s only
   method invoked is the existence check (never a write/mkdir).
4. `inventory("codex", { baseDir })` returns entries for `.codex/config.toml`
   (`kind: "hooks"`) and each `.codex/skills/<skill>/SKILL.md` and **no** Claude
   paths — routed entirely through `planInstall`; `src/install/inventory.ts`
   contains no per-target branch (no `target ===` / `if (target` substring).
5. `formatInventory` renders exactly one line per entry, each carrying a
   present/absent marker (`[x]`/`[ ]`) and the entry's path, plus a final
   `N/M capabilities installed` summary line where `N` = count of `present`
   entries and `M` = total; with `--json` the CLI instead emits a JSON array that
   `JSON.parse`s to `[{ kind, path, present }, …]` equal to `inventory(...)`.
6. A partially-installed repo (only `.claude/settings.json` present) reports
   `present: true` for the hooks entry and `present: false` for the agent and
   skill entries — mixed state is reported per-file, never collapsed to a single
   boolean.
7. `src/install/inventory.ts` ships together with its sibling
   `test/install/inventory.test.ts` in the same change; `backpressure index`
   never prints `not yet implemented`, and the existing registration/help
   assertions in `test/cli.test.ts` still pass (help no longer says "stub").

## Acceptance tests

1. `@acceptance index on a clean repo lists every planned capability as absent (length == planInstall length)`
2. `@acceptance inventory marks hooks+reviewer+skill present after init('claude') and omits .mcp.json (v0)`
3. `@acceptance inventory is read-only (fresh baseDir stays empty; only existence checks run)`
4. `@acceptance inventory('codex') lists config.toml + skills via planInstall with no per-target branch in inventory.ts`
5. `@acceptance formatInventory renders [x]/[ ] markers + summary; --json emits {kind,path,present}[]`
6. `@acceptance inventory reports mixed install state (hooks present, agent+skill absent)`
7. `@acceptance src/install/inventory.ts ships with test/install/inventory.test.ts and index drops "not yet implemented"`

## Files to touch

- `src/install/inventory.ts` — **new**: `inventory()`, `InventoryOptions`,
  `CapabilityEntry`, `ExistsIo`, and the pure `formatInventory()` renderer.
  Reuses `planInstall` for the candidate paths; the only side effect is the
  injected existence check.
- `src/cli.ts` — replace the `index` stub action (`:181-186`) with `--target` /
  `--json` wiring; reword the help description off "Index the installed
  capabilities (stub)". Leave the `build` subcommand untouched (separate concern).
- `test/install/inventory.test.ts` — **new** sibling test covering criteria 1-7
  (modeled on `test/install/init.test.ts`: `mkdtemp` + real `init()` to create a
  footprint, plus an injected `ExistsIo` to assert read-only behavior).
- `test/cli.test.ts` — add a CLI-level assertion that `index` produces an
  inventory report (and no longer prints "not yet implemented"); keep the
  existing registration/help assertions green.
- `docs/USER_GUIDE.md` — document `backpressure index` (`--target`, `--json`).
- `docs/RALPH_PRODUCTION_GUIDE.md` — drop `index` from the "v0 stub / not yet
  implemented" list.

## Why these choices

Recorded so a future amnesiac loop cannot "simplify" `index` away or redefine it:

- **`index` is defined here, not in the blueprint.** The architecture doc never
  specifies `index`; the only intent signal is the stub's description, "Index the
  installed capabilities." This spec fixes that meaning as **a read-only
  inventory of the install footprint** — the inverse of `init`/`build`. Do not
  reinterpret it as a content/search index, a packaging step, or a doctor that
  edits files: those are different commands. Presence-of-install reporting is the
  v0 surface.
- **Reuse `planInstall`, add no per-CLI branch.** The set of files that
  constitute an install is already owned, per target, by `planInstall`
  (`plan.ts:86-114`, which is the single place that branches `target === "claude"`).
  `inventory` consumes that list and only stats it, so it adds **no** new
  `which-CLI` branch — criterion 4 (no `target ===` in `inventory.ts`) guards the
  CLAUDE.md invariant that only `src/seam`/`src/adapters` (and the shared
  plan path) know a target's name.
- **Read-only by construction.** An inventory that wrote or repaired anything
  would be a footgun and would overlap `init`. The only side effect is an
  injected existence check (criterion 3 asserts a fresh `baseDir` stays empty),
  so the read-only guarantee cannot silently regress.
- **Presence, not content-correctness.** v0 reports whether each planned file
  exists, not whether its bytes are the ones Backpressure would emit. This keeps
  the command small, deterministic, and free of a second copy of the emitters.
  Content/drift validation (does `.claude/settings.json` actually carry the Stop
  gate?) is a deliberately separate, later concern — noted so a future loop does
  not bolt it on and call it "the same thing".
- **Inventoried against the capability set, not a raw dir scan.** `inventory`
  reports the *known* capability set (`DEFAULT_CAPABILITIES` by default), mirroring
  `planInstall`. Discovering arbitrary, unplanned skill dirs under `.claude/skills/`
  is richer but would diverge from the planner and re-introduce a per-target
  branch; it is out of scope for v0.
- **`--json` because `index` is fundamentally a manifest.** Unlike `build`
  (whose v0 surface is a human-readable preview), an *index* is a thing other
  tools consume, so a machine-readable `--json` belongs in its v0 surface.
- **Module named `inventory.ts`, not `index.ts`.** A file named `index.ts` inside
  `src/install/` reads as a barrel/re-export and invites accidental
  auto-importing; `inventory.ts` names the behavior and avoids that collision.
- **Source + test in one change** (CLAUDE.md convention); criterion 7 makes it
  explicit so the new module cannot ship untested.

## Out of scope / non-goals

- No content/drift validation (presence only); no checking that a present file
  holds the bytes `init` would write.
- No repair, install, or removal — `index` never mutates the repo (that is `init`
  / `remove`).
- No raw-directory discovery of unplanned skills/agents; the inventory is the
  known capability set mapped through `planInstall`.
- No `--global` (`~/.claude`) scanning in v0; the inventory targets `baseDir`
  (cwd). Noted as a future enhancement, not built now.
- No new runtime dependencies; reuse `commander` + `node:fs` already present.
- No change to the `build` subcommand (separate concern) beyond sharing
  `src/cli.ts`.
