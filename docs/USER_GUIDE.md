# Backpressure — User Guide

Backpressure is a **capability pack** for agentic coding CLIs — currently
**Claude Code** and **Codex CLI**. It is *not* an agent or a runtime: it ships
configuration, prompts, small scripts, and two helper programs that you install
*into* an existing CLI. The agent loop, tool execution, and sandboxing stay with
the CLI; Backpressure adds the guardrails, the task tracker, the portable skills,
and the autonomous build loop that drives it all.

> New here? Read the [Quickstart](#quickstart) and the [CLI reference](#the-backpressure-cli).
> Building or extending the toolkit? Jump to [Components](#components) and
> [Extending Backpressure](#extending-backpressure).
> Want the autonomous build loop? See [The Ralph loop](#the-ralph-loop).

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
# from the repo you want to equip (must contain a `skills/` dir — see note below)
backpressure init --target claude     # writes .claude/ + .mcp.json
backpressure init --target codex      # writes .codex/config.toml
```

Preview without writing anything:

```bash
backpressure init --target claude --dry-run
```

`init` writes its files into the **current working directory** and reads bundled
skills from **`<cwd>/skills/`**. Run it from a repo that has a `skills/` directory
(this repo does); or use the [library API](#library-api-reference) to point
`skillsSourceDir` elsewhere.

---

## The `backpressure` CLI

```
backpressure <command> [options]
```

| Command | Status | What it does |
|---------|--------|--------------|
| `init`  | ✅ wired | Compiles and installs capabilities into the current repo. |
| `build` | 🚧 stub | Prints `build: not yet implemented` (reserved for v0+). |
| `index` | 🚧 stub | Prints `index: not yet implemented` (reserved for v0+). |

### `backpressure init`

| Option | Default | Meaning |
|--------|---------|---------|
| `--target <target>` | `claude` | Which CLI to compile for: `claude` or `codex`. |
| `--dry-run` | off | Compute the plan and print the file list **without writing**. |

Behaviour:

- Writes into `process.cwd()`.
- Installs the **default capability set**: a `reviewer` subagent, a `Stop`-event
  test-gate hook (`pnpm test`), the `tracker` MCP server registration, and the
  bundled `building-adaptive-ui` skill.
- On success prints one line per file: `Wrote: <path>` (or `Planned: <path>` for
  a dry run).

```bash
$ backpressure init --target claude
Wrote: /repo/.claude/settings.json
Wrote: /repo/.mcp.json
Wrote: /repo/.claude/agents/reviewer.md
Wrote: /repo/.claude/skills/building-adaptive-ui/SKILL.md
```

---

## What `init` installs

The same capability set, compiled to each target's native layout:

### Claude Code (`--target claude`)

```
.claude/settings.json                          # hooks
.mcp.json                                       # MCP server registrations
.claude/agents/reviewer.md                      # one file per subagent
.claude/skills/building-adaptive-ui/SKILL.md    # one dir per bundled skill
```

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

`.mcp.json` — the issue-tracker server registration:

```json
{
  "mcpServers": {
    "tracker": { "command": "node", "args": [ "dist/tracker/server.js" ] }
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
.codex/config.toml                              # hooks + mcp_servers + agents
.codex/skills/building-adaptive-ui/SKILL.md     # one dir per bundled skill
```

```toml
[[hooks]]
event = "Stop"
command = "pnpm test"

[mcp_servers.tracker]
command = "node"
args = [ "dist/tracker/server.js" ]

[agents.reviewer]
description = "Reviews a diff for scope creep and missing tests."
prompt = "You are a careful code reviewer. Report only concrete issues."
tools = [ "Read", "Grep" ]
```

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
├─ skills/load.ts          # loadSkills — scan + validate SKILL.md frontmatter
├─ install/
│  ├─ plan.ts              # planInstall — pure per-target file plan
│  └─ init.ts              # init — compile + write the planned files
├─ loop/
│  ├─ journal.ts           # writeJournalEntry — JSONL run log
│  └─ governor.ts          # Governor — iteration / budget / failure caps
└─ cli.ts                  # the `backpressure` bin (commander)
```

### Issue tracker (external MCP server)

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

> **v0 gap:** the emitted MCP config points at `dist/tracker/server.js`, but the
> build only bundles `dist/index.js` and `dist/cli.js`. `buildTrackerServer` is a
> library function with no stdio bootstrap yet, so the registered server isn't
> runnable out of the box. To use it, add a small entry that constructs a store,
> calls `buildTrackerServer`, connects a `StdioServerTransport`, and include it in
> the tsup `entry` list. See [Known limitations](#known-limitations--v0-notes).

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
- Bundled skill: **`building-adaptive-ui`** — guidance to use design tokens
  instead of hardcoded colors, plus `scripts/check-hardcoded-colors.sh`, which
  greps source for hex/`rgb()`/`hsl()` literals and exits non-zero if any are
  found (usable as a pre-commit or hook gate).

### Loop building blocks

Present and tested, ready to assemble into a TypeScript loop (the working
autonomous loop today is `ralph.sh` — see below):

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

---

## The Ralph loop

`ralph.sh` is the **working** autonomous build loop: it reads the next task,
invokes a CLI headless on **one** task with fresh context, gates on tests, and
repeats — with backpressure (a hard test/lint gate) between iterations.

> ⚠️ **Run it in a container or a throwaway git worktree, never on your real
> repo.** It runs the CLI with permission/approval prompts bypassed; git is your
> only undo button. `ralph.sh` refuses to run on `main`/`master`.

```bash
git worktree add ../backpressure-loop -b ralph/auto
cd ../backpressure-loop
chmod +x ralph.sh

MAX_ITERS=2 ./ralph.sh      # attended dry run: watch 2 iterations first
./ralph.sh                  # then let it run
```

Configuration is via environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT` | `claude` | Which CLI to drive: `claude` or `codex`. |
| `MAX_ITERS` | `25` | Hard ceiling on iterations. |
| `MAX_STALLS` | `3` | Stop after N iterations with no new commit. |
| `BUDGET_USD` | (unset) | Per-iteration USD cap (Claude only; needs `--max-budget-usd` support). |
| `TEST_CMD` | `pnpm test` | The hard test gate. |
| `CHECK_CMD` | `pnpm run check --if-present` | Lint/format gate. |
| `MAX_TURNS` | `40` | Cap on actions per iteration. |

Per-iteration JSON logs land in `.ralph/`. Review with `git log --oneline`,
`ls .ralph/`, and `grep BLOCKED PLAN.md`. See the repo
[`README.md`](../README.md) for the full safety checklist and tuning notes.

---

## Extending Backpressure

The CLI installs a fixed **default** capability set. To change what gets
installed, edit the defaults (then `pnpm run build`), or call the
[library API](#library-api-reference) with your own `capabilities`.

**The defaults live in two files:**

- `src/install/init.ts` — `DEFAULT_HOOKS`, `DEFAULT_MCP_SERVERS`.
- `src/install/plan.ts` — `DEFAULT_CAPABILITIES` (`subagents`, `skills`).

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
`DEFAULT_MCP_SERVERS` (`name`, `command`, `args`, optional `env`).

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
| `install/plan.ts` | `planInstall`, `InstallCapabilities`, `DEFAULT_CAPABILITIES`, `PlannedFile` |
| `install/init.ts` | `init`, `InitOptions`, `InitResult`, `InstallIo`, `nodeInstallIo`, `DEFAULT_HOOKS`, `DEFAULT_MCP_SERVERS` |
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
- **The tracker MCP server isn't runnable out of the box.** The emitted config
  references `dist/tracker/server.js`, but the build doesn't produce it and
  `buildTrackerServer` has no stdio bootstrap yet. Add an entry + tsup entry to
  wire it.
- **`init` writes into the current directory** and reads skills from
  `<cwd>/skills`; there's no `--skills-dir` flag on the CLI (use the library API's
  `skillsSourceDir`).
- **The TS loop pieces (`journal`, `governor`, `seam`) are not yet assembled**
  into a runnable TypeScript loop or wired into `build`. The autonomous loop that
  works today is `ralph.sh`.
- **Store is a single JSON file.** SQLite (`better-sqlite3`) is a planned post-v0
  upgrade; there's no task for it yet.
- **`BUDGET_USD` in `ralph.sh`** only works if your CLI supports
  `--max-budget-usd`; otherwise leave it unset.
