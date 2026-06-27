# Backpressure — User Guide

Backpressure is a **capability pack** for agentic coding CLIs — currently
**Claude Code** and **Codex CLI**. It is *not* an agent or a runtime: it ships
configuration, prompts, and small scripts that you install *into* an existing
CLI. The agent loop, tool execution, and sandboxing stay with the CLI;
Backpressure adds the guardrails and the portable skills. (An issue tracker also
lives in the tree but is deferred post-v0 — it isn't installed yet.)

> New here? Read the [Quickstart](#quickstart) and the [CLI reference](#the-backpressure-cli).
> Building or extending the toolkit? Jump to [Components](#components) and
> [Extending Backpressure](#extending-backpressure).
> Want an autonomous build loop? See [Loop building blocks](#loop-building-blocks).

---

## Core idea: author once, compile per target

Claude Code and Codex express the *same* concepts with *different* config
formats. Backpressure keeps **one source of truth** per capability and compiles
it to each CLI's native files. Every component sorts into one of three tiers:

| Tier | Meaning | Examples |
|------|---------|----------|
| **Portable** | One artifact runs on both CLIs unchanged | Skills (`SKILL.md`), MCP servers |
| **Compiled per target** | One definition, emitted as each CLI's native config | Hooks, subagents, MCP registration |
| **External program** | CLI-agnostic by construction | Issue tracker (an MCP server), the Ralph loop (a shell harness) |

Claude Code consumes **JSON** (`.claude/settings.json`, `.mcp.json`,
`.claude/agents/*.md`); Codex consumes **TOML** (`.codex/config.toml`). You never
write those by hand — `backpressure init` emits them.

---

## Requirements

- **Node.js 20+** (developed on Node 22).
- **pnpm** (the repo ships a `pnpm-lock.yaml`; provision it via `corepack enable`).
- One or both target CLIs installed and on your `PATH` to actually *run* the
  output: `claude` (Claude Code) and/or `codex` (Codex CLI).

---

## Install & build

Backpressure is a TypeScript project. Clone it, install, and build:

```bash
pnpm install     # install dependencies
pnpm test        # run the test suite (vitest)
pnpm run check   # lint + format + typecheck (biome + tsc)
pnpm run build   # bundle to dist/ (produces dist/cli.js, executable)
```

`pnpm run build` uses **tsup** and emits an executable `dist/cli.js` — the
`backpressure` binary (declared in `package.json`'s `bin` field).

Run the CLI directly from the build:

```bash
node dist/cli.js --help
```

Or link it onto your `PATH` for development:

```bash
pnpm link --global       # makes `backpressure` available globally
backpressure --help
```

> **v0 note:** the package is `private` and not published to npm. You consume it
> from this repo (the `backpressure` bin, or the source modules — see the
> [Library API](#library-api-reference)).

---

## Quickstart

Install Backpressure's capabilities into a target repo:

```bash
# from the repo you want to equip
backpressure init --target claude     # writes .claude/
backpressure init --target codex      # writes .codex/config.toml
```

Preview without writing anything:

```bash
backpressure init --target claude --dry-run
```

`init` writes its files into the **current working directory** (the repo you're
equipping) but reads bundled skills from the **pack's own install location**, so
you can run it from any repo. To source skills from somewhere else, use the
[library API](#library-api-reference) to set `skillsSourceDir`.

---

## The `backpressure` CLI

```
backpressure <command> [options]
```

| Command  | Status | What it does |
|----------|--------|--------------|
| `init`   | ✅ wired | Compiles and installs capabilities into the current repo. |
| `remove` | ✅ wired | Removes previously-installed Backpressure skills. |
| `build`  | 🚧 stub | Prints `build: not yet implemented` (reserved for v0+). |
| `index`  | 🚧 stub | Prints `index: not yet implemented` (reserved for v0+). |

### `backpressure init`

| Option | Default | Meaning |
|--------|---------|---------|
| `--target <target>` | `claude` | Which CLI to compile for: `claude` or `codex`. |
| `--dry-run` | off | Compute the plan and print the file list **without writing**. |
| `--skill <name>` | — | Install a bundled skill **in addition** to the defaults. Repeatable (`--skill a --skill b`). An unknown name fails cleanly, listing what's available. |
| `--all-skills` | off | Install **every** bundled skill the pack ships, not just the defaults. |
| `--global` | off | Install skills only into the **user-level** skills dir (`~/.claude/skills` or `~/.codex/skills`). Hooks and agent files are **not** written. |
| `--gate <command>` | `pnpm test` | Command the installed **Stop-gate hook** runs after each turn. Point it at `./scripts/backpressure-gate.sh` to install the composite gate instead of bare tests. |

Behaviour:

- Without `--global`, writes into `process.cwd()`.
- With `--global`, writes skills into `os.homedir()` (e.g. `~/.claude/skills/<name>/`)
  and skips all project-level config (hooks, agents).
- Installs the **default capability set**: a `reviewer` subagent, a `Stop`-event
  test-gate hook (`pnpm test`), and the bundled `building-adaptive-ui` skill.
  (No MCP servers are registered in v0 — the issue tracker is deferred, so no
  `.mcp.json` is written. See [Issue tracker](#issue-tracker-external-mcp-server).)
- A skill is installed by **mirroring its whole directory** — `SKILL.md` plus any
  `scripts/`, `references/`, `assets/`, etc. Files are **byte-copied**, so binary
  assets and the executable bit on scripts are preserved.
- Before writing anything, every skill in the resolved set is **validated** (see
  [Pre-install verify gate](#pre-install-verify-gate)). The install is atomic —
  nothing is written if any skill fails validation.
- On success prints one line per file: `Wrote: <path>` (or `Planned: <path>` for
  a dry run).

```bash
$ backpressure init --target claude
Wrote: /repo/.claude/settings.json
Wrote: /repo/.claude/agents/reviewer.md
Wrote: /repo/.claude/skills/building-adaptive-ui/SKILL.md

# add a bundled meta-skill on top of the defaults
$ backpressure init --target claude --skill skill-creator

# install skills user-wide (no project-level config written)
$ backpressure init --target claude --global
Wrote: /Users/me/.claude/skills/building-adaptive-ui/SKILL.md
```

> **Adding a new bundled skill:** drop a `SKILL.md` (and any resources) under
> `skills/<name>/`. It's discovered automatically — install it on demand with
> `--skill <name>` / `--all-skills`, or add its name to `DEFAULT_CAPABILITIES`
> in `src/install/plan.ts` to make it part of the default set.

---

### `backpressure remove`

Removes previously-installed Backpressure skills, the exact inverse of
`backpressure init --skill`.

| Option | Default | Meaning |
|--------|---------|---------|
| `--target <target>` | `claude` | Which CLI's skill dir to remove from: `claude` or `codex`. |
| `--dry-run` | off | Show what would be removed **without deleting anything**. |
| `--skill <name>` | — | A skill to remove (repeatable). An unknown name fails cleanly. |
| `--all-skills` | off | Remove every bundled skill the pack ships. |
| `--global` | off | Remove from the **user-level** skills dir (`~/.claude/skills` or `~/.codex/skills`). |

Behaviour:

- A bare `backpressure remove` (no `--skill` / `--all-skills`) targets the **same
  default skill set** as a bare `backpressure init` — it is the exact inverse.
- For each skill requested, one of three outcomes is printed:
  - `Removed: <path>` — the skill dir was deleted (or `Would remove: <path>` for
    a dry run).
  - `Skipped (not installed): <skill>` — the dir was never there; nothing to do.
  - `Refused (not a skill dir): <path>` — the dir exists but contains no
    `SKILL.md`; `remove` refuses to delete it (safety guard).
- The install path is derived from `planInstall` (the same function `init` uses),
  so `remove` and `init` always agree on where skills live.
- `--global` targets `os.homedir()` instead of `cwd()`, matching `init --global`.

```bash
$ backpressure remove --target claude
Removed: /repo/.claude/skills/building-adaptive-ui

$ backpressure remove --target claude --dry-run
Would remove: /repo/.claude/skills/building-adaptive-ui

$ backpressure remove --target claude --global
Removed: /Users/me/.claude/skills/building-adaptive-ui

# remove a skill that was never installed
$ backpressure remove --target claude --skill skill-creator
Skipped (not installed): skill-creator
```

---

### Pre-install verify gate

Before `backpressure init` writes anything, every skill in the resolved set is
validated by `verifySkills`. For each skill `<name>`, the gate checks:

1. `<skillsSourceDir>/<name>/SKILL.md` is readable (ENOENT → error).
2. The file has a valid `---` frontmatter block with `name` **and** `description`
   fields (missing field → error).
3. The frontmatter `name` matches the directory name (mismatch → error).

If **any** check fails, a `SkillVerificationError` is thrown and **nothing is
written** (atomic abort). All problems across all skills are collected first, so
you can fix everything in one pass:

```
backpressure: skill verification failed:
 - my-skill: SKILL.md not found
 - another-skill: invalid frontmatter: Required
```

This gate also runs for `--dry-run`, so previewing an install accurately reflects
whether the skills are valid.

---

## What `init` installs

The same capability set, compiled to each target's native layout:

### Claude Code (`--target claude`)

```
.claude/settings.json                          # hooks
.claude/agents/reviewer.md                      # one file per subagent
.claude/skills/building-adaptive-ui/SKILL.md    # one dir per bundled skill
```

> No `.mcp.json` is written in v0: no MCP servers are registered (the issue
> tracker is deferred — see [Issue tracker](#issue-tracker-external-mcp-server)).
> When a server *is* registered, `init` emits `.mcp.json` (Claude) / an
> `[mcp_servers]` table (Codex); with none, the file/table is omitted entirely.

`.claude/settings.json` — the test-gate hook:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "pnpm test" } ] }
    ]
  }
}
```

`.claude/agents/reviewer.md` — a subagent compiled to Markdown + YAML frontmatter:

```markdown
---
name: reviewer
description: Reviews a diff for scope creep and missing tests.
tools: Read, Grep
---

You are a careful code reviewer. Report only concrete issues.
```

### Codex CLI (`--target codex`)

Codex puts hooks, MCP servers, and agents in **one** `.codex/config.toml`:

```
.codex/config.toml                              # hooks + agents (+ mcp_servers when registered)
.codex/skills/building-adaptive-ui/SKILL.md     # one dir per bundled skill
```

```toml
[[hooks]]
event = "Stop"
command = "pnpm test"

[agents.reviewer]
description = "Reviews a diff for scope creep and missing tests."
prompt = "You are a careful code reviewer. Report only concrete issues."
tools = [ "Read", "Grep" ]
```

> The `[mcp_servers.*]` table appears only when a server is registered. In v0
> none is, so `config.toml` carries just hooks + agents.

Skills are **portable** — the same `SKILL.md` is copied verbatim under each CLI's
skills directory.

---

## Components

```
src/
├─ core/task.ts            # Task schema (zod) — the unit of work
├─ tracker/
│  ├─ store.ts             # TaskStore interface + JsonFileStore
│  ├─ select.ts            # selectNextTask — dependency-aware picker
│  └─ server.ts            # buildTrackerServer — MCP server (next/create/update)
├─ seam/
│  ├─ targets.ts           # AgentTarget + per-target flag spellings
│  ├─ argv.ts              # buildArgv — pure argv builder
│  └─ run.ts               # runAgent — spawn a CLI headless
├─ adapters/
│  ├─ common/              # shared HookDefinition / SubagentDefinition / McpServerDefinition
│  ├─ claude/              # emitClaudeHooks / emitClaudeAgents / emitClaudeMcp  (JSON / Markdown)
│  └─ codex/               # emitCodexHooks / emitCodexAgents / emitCodexMcp     (TOML)
├─ skills/
│  ├─ load.ts              # loadSkills — scan + validate SKILL.md frontmatter
│  └─ verify.ts            # verifySkills — pre-install validation gate
├─ install/
│  ├─ plan.ts              # planInstall — pure per-target file plan
│  ├─ init.ts              # init — compile + write the planned files
│  ├─ remove.ts            # remove — delete previously-installed skills
│  └─ errors.ts            # InstallError hierarchy (includes SkillVerificationError)
├─ loop/
│  ├─ journal.ts           # writeJournalEntry — JSONL run log
│  └─ governor.ts          # Governor — iteration / budget / failure caps
└─ cli.ts                  # the `backpressure` bin (commander)
```

### Issue tracker (external MCP server)

> **Deferred to post-v0 — not installed.** The tracker source lives in the tree
> (`src/core/task.ts`, `src/tracker/*`) and is fully tested, but `init` does
> **not** register it: no `.mcp.json` / `[mcp_servers]` table is emitted, and the
> build does not bundle a runnable server. The section below documents the
> in-tree library for when the tracker is wired up in a later release.

The task queue and the loop's durable memory. A **Task** (`src/core/task.ts`) is:

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Stable id, e.g. `"T3"`. |
| `title` | string | Human summary. |
| `status` | `open` \| `done` \| `blocked` | Lifecycle state. |
| `acceptance` | string | The machine-checkable acceptance criterion (a test). |
| `scope` | string | What the task may touch. |
| `deps` | string[] | Ids that must be `done` first. |

- **`JsonFileStore`** persists the whole list as a JSON array in one file
  (`create` / `get` / `list` / `update`). Filesystem access is behind an
  injectable `FileIo`. SQLite is a planned post-v0 upgrade.
- **`selectNextTask(tasks)`** returns the first `open` task whose `deps` are all
  `done` (or `undefined` if none are eligible).
- **`buildTrackerServer(store)`** returns an MCP server exposing three tools:

  | Tool | Input | Returns |
  |------|-------|---------|
  | `next` | (none) | The next eligible task, or `null`. |
  | `create` | `id, title, acceptance, scope` (+ optional `status`, `deps`) | The created task. |
  | `update` | `id` (+ any fields to patch) | The updated task. |

> **Wiring it up (post-v0):** `buildTrackerServer` is a library function with no
> stdio bootstrap yet. To ship it, add a small entry that constructs a store,
> calls `buildTrackerServer`, and connects a `StdioServerTransport`; include that
> entry in the tsup `entry` list; and add the server to `DEFAULT_CAPABILITIES.mcpServers`
> so `init` registers it. See [Known limitations](#known-limitations--v0-notes).

### CLI-invocation seam

The one real CLI-specific abstraction — it normalizes the flag differences
between `claude -p` and `codex exec`.

- **`TARGET_FLAGS` / `flagsFor(target)`** — the per-target flag spellings
  (headless, permission/sandbox bypass, model, max-turns). Codex has no
  max-turns flag, so it's `null`.
- **`buildArgv(target, prompt, opts)`** — **pure**; builds the exact argv array.
- **`runAgent(target, prompt, opts)`** — spawns the target binary headless via an
  **injectable** `SpawnFn` and resolves with the exit code.

```ts
import { buildArgv } from "./src/seam/argv.js";

buildArgv("claude", "do T1", { model: "opus", maxTurns: 5 });
// ["-p", "do T1", "--dangerously-skip-permissions", "--model", "opus", "--max-turns", "5"]

buildArgv("codex", "do T1", { model: "opus", maxTurns: 5 });
// ["exec", "do T1", "--dangerously-bypass-approvals-and-sandbox", "--model", "opus"]
//  (codex has no max-turns flag, so it is dropped)
```

`headless` and `permission` default to `true` — the loop always runs
non-interactively with prompts bypassed. **Only run with permission bypass inside
a throwaway worktree or container.**

### Adapters

Each compiled capability has **one** shared definition in `adapters/common/`, and
per-target emitters derive the native config from it — no fact is duplicated.

| Shared definition | Fields | Claude emitter (JSON/MD) | Codex emitter (TOML) |
|-------------------|--------|--------------------------|----------------------|
| `HookDefinition` | `event`, `matcher?`, `command` | `emitClaudeHooks` | `emitCodexHooks` |
| `SubagentDefinition` | `name`, `description`, `prompt`, `tools?` | `emitClaudeAgents` | `emitCodexAgents` |
| `McpServerDefinition` | `name`, `command`, `args`, `env?` | `emitClaudeMcp` | `emitCodexMcp` |

### Skills (portable)

A skill is a directory with a `SKILL.md` whose YAML frontmatter has at least
`name` and `description` (`description` is **required** — a skill the CLI can't
describe can't be routed to).

- **`loadSkills(dir, io?)`** scans each subdirectory's `SKILL.md`, parses the
  frontmatter, and validates it; a skill missing `description` is rejected.
- **`listSkillDirs(dir, io?)`** returns the directory names of bundled skills
  (subdirs that actually contain a `SKILL.md`), skipping the rest. This is the
  discovery primitive behind `init`'s `--skill` / `--all-skills` flags.
- Bundled skills:
  - **`building-adaptive-ui`** (default) — guidance to use design tokens
    instead of hardcoded colors, plus `scripts/check-hardcoded-colors.sh`, which
    greps source for hex/`rgb()`/`hsl()` literals and exits non-zero if any are
    found (usable as a pre-commit or hook gate).
  - **`skill-creator`** (opt-in) — a meta-skill for authoring, evaluating, and
    improving skills; bundles Python eval/benchmark scripts, grader/comparator
    subagents, and an eval viewer. Install with `--skill skill-creator`.

### Loop building blocks

Present and tested, ready to assemble into a TypeScript loop. v0 ships **no**
bundled loop runner — drive the autonomous build loop with the CLI's own
mechanism (e.g. Claude Code's built-in `/loop`) against a throwaway git worktree,
or wire these primitives into a harness of your own. New to the autonomous-loop
idea? See the [Ralph beginner guide](RALPH_GUIDE.md) for the technique this
project is named after and a step-by-step workflow recipe.

The building blocks:

- **`writeJournalEntry(path, entry, opts?)`** appends one JSONL line per iteration:
  `{ iteration, taskId, result, duration }`. Append I/O is injectable.
- **`Governor`** is a pure cap on a run: `maxIterations`, optional `maxBudgetUsd`,
  and `maxConsecutiveFailures`. Feed it outcomes with `record("success" | "failure", costUsd?)`
  and ask `decide()` for `{ halt, reason }`.

```ts
import { Governor } from "./src/loop/governor.js";

const gov = new Governor({ maxIterations: 25, maxConsecutiveFailures: 3, maxBudgetUsd: 5 });
gov.record("failure");
gov.decide();   // { halt: false }  (until a cap is hit)
```

The headless-invocation seam (`seam/run.ts`, `seam/argv.ts`, `seam/targets.ts`)
builds the argv for one non-interactive agent run per target — the other half of
a loop you assemble yourself.

> ⚠️ Whatever harness you drive these with, run it in a container or a throwaway
> git worktree, never on your real repo: an autonomous loop runs the CLI with
> permission/approval prompts bypassed, and git is your only undo button.

---

## Extending Backpressure

The CLI installs a fixed **default** capability set. To change what gets
installed, edit the defaults (then `pnpm run build`), or call the
[library API](#library-api-reference) with your own `capabilities`.

**The defaults live in two files:**

- `src/install/init.ts` — `DEFAULT_HOOKS`.
- `src/install/plan.ts` — `DEFAULT_CAPABILITIES` (`subagents`, `mcpServers`, `skills`).

**Add a guardrail hook** — append to `DEFAULT_HOOKS`:

```ts
export const DEFAULT_HOOKS: HookDefinition[] = [
  { event: "Stop", command: "pnpm test" },
  { event: "PreToolUse", matcher: "Bash", command: "./scripts/scope-guard.sh" },
];
```

**Add a subagent** — append a `SubagentDefinition` to `DEFAULT_CAPABILITIES.subagents`
(`name`, `description`, `prompt`, optional `tools`). It compiles to
`.claude/agents/<name>.md` and a `[agents.<name>]` TOML table.

**Register an MCP server** — append an `McpServerDefinition` to
`DEFAULT_CAPABILITIES.mcpServers` (`name`, `command`, `args`, optional `env`). It
compiles to a `.mcp.json` entry (Claude) / `[mcp_servers.<name>]` table (Codex).
When the list is empty (the v0 default), `init` writes no MCP config at all.

**Add a skill** — create `skills/<name>/SKILL.md` with valid frontmatter (and any
`scripts/`), then add `"<name>"` to `DEFAULT_CAPABILITIES.skills`:

```markdown
---
name: my-skill
description: One line the CLI uses to decide when to load this skill.
---

# My skill
...guidance...
```

**Use a custom set without editing defaults** — call `init` directly:

```ts
import { init } from "./src/install/init.js";

await init("claude", "/path/to/repo", {
  capabilities: { subagents: [/* ... */], skills: ["my-skill"] },
  skillsSourceDir: "/path/to/my/skills",
  dryRun: true,
});
```

---

## Library API reference

There is no aggregated public export in v0 (`src/index.ts` is an empty barrel);
import from the source modules directly.

| Import from | Exports |
|-------------|---------|
| `core/task.ts` | `TaskSchema`, `Task`, `TaskStatus` |
| `tracker/store.ts` | `TaskStore`, `FileIo`, `nodeFileIo`, `JsonFileStore` |
| `tracker/select.ts` | `selectNextTask` |
| `tracker/server.ts` | `buildTrackerServer`, `*InputShape` |
| `seam/targets.ts` | `AgentTarget`, `TargetFlags`, `TARGET_FLAGS`, `flagsFor` |
| `seam/argv.ts` | `AgentOpts`, `buildArgv` |
| `seam/run.ts` | `runAgent`, `SpawnFn`, `nodeSpawnFn`, `SpawnedProcess`, `RunAgentOpts` |
| `adapters/common/*` | `HookDefinition`, `SubagentDefinition`, `McpServerDefinition` |
| `adapters/claude/*` | `emitClaudeHooks`, `emitClaudeAgents`, `emitClaudeMcp` |
| `adapters/codex/*` | `emitCodexHooks`, `emitCodexAgents`, `emitCodexMcp` |
| `skills/load.ts` | `loadSkills`, `parseFrontmatter`, `SkillFrontmatterSchema`, `Skill`, `SkillsIo`, `nodeSkillsIo` |
| `skills/verify.ts` | `verifySkills`, `SkillProblem` |
| `install/plan.ts` | `planInstall`, `InstallCapabilities`, `DEFAULT_CAPABILITIES`, `PlannedFile` |
| `install/init.ts` | `init`, `bundledSkillsDir`, `InitOptions`, `InitResult`, `InstallIo`, `nodeInstallIo`, `DEFAULT_HOOKS` |
| `install/remove.ts` | `remove`, `RemoveOptions`, `RemoveResult`, `RemoveAction`, `RemoveIo`, `nodeRemoveIo` |
| `install/errors.ts` | `InstallError`, `MissingSkillSourceError`, `UnknownSkillError`, `SkillVerificationError`, `isEnoent` |
| `loop/journal.ts` | `writeJournalEntry`, `JournalEntry`, `AppendFn`, `nodeAppendFn` |
| `loop/governor.ts` | `Governor`, `GovernorConfig`, `GovernorDecision`, `IterationOutcome` |

Side effects (filesystem, child processes) are isolated behind small injectable
seams (`FileIo`, `InstallIo`, `SkillsIo`, `SpawnFn`, `AppendFn`) so every unit is
testable without touching disk or spawning a process.

---

## Development

```bash
pnpm test         # vitest (run once)
pnpm run check    # biome check . && tsc --noEmit
pnpm run build    # tsup -> dist/
```

- **Language:** TypeScript (ESM, `"type": "module"`). Imports use explicit `.js`
  extensions.
- **Validation:** `zod` (one schema drives runtime validation *and* MCP JSON
  Schema).
- **MCP:** `@modelcontextprotocol/sdk`. **TOML:** `smol-toml`. **CLI:** `commander`.
- **Build/test:** `tsup` + `vitest`. **Lint/format:** `biome`.
- Tests live under `test/`, mirroring `src/`.

---

## Known limitations (v0 notes)

- **`build` and `index` CLI commands are stubs** — they print a "not yet
  implemented" line.
- **The issue tracker is deferred to post-v0 and is not installed.** Its source
  (`src/core/task.ts`, `src/tracker/*`) ships in the tree and is tested, but
  `init` registers no MCP server, so no `.mcp.json` / `[mcp_servers]` table is
  emitted and the build produces no runnable server. Wiring it up (a stdio
  bootstrap entry, a tsup entry, and an `McpServerDefinition` in
  `DEFAULT_CAPABILITIES.mcpServers`) is a post-v0 task.
- **`init` writes into the current directory** but reads bundled skills from the
  pack's own install location (`bundledSkillsDir()`), so it can run from any repo.
  There's no `--skills-dir` flag on the CLI; to source skills elsewhere, use the
  library API's `skillsSourceDir`.
- **No bundled loop runner.** The TS loop pieces (`journal`, `governor`, `seam`)
  are tested but not assembled into a runnable TypeScript loop or wired into
  `build`. Drive the autonomous build loop with the CLI's own mechanism (e.g.
  Claude Code's `/loop`) or your own harness; v0 ships no loop binary.
- **Store is a single JSON file.** SQLite (`better-sqlite3`) is a planned post-v0
  upgrade; there's no task for it yet.
