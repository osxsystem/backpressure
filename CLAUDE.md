# Backpressure

A **capability pack** for agentic coding CLIs (Claude Code and Codex CLI). It is
**not** an agent or runtime — the loop, tool execution, and sandboxing belong to
the CLI. This project ships configuration, prompts, and small scripts that install
into those CLIs. (An issue tracker lives in `src/tracker/` but is deferred post-v0
and **not** installed in v0.)

`backpressure-architecture.html` is the design blueprint (the *what* and *why*).
`docs/USER_GUIDE.md` documents the built CLI for end users.

## Commands

```bash
pnpm test            # vitest run — the acceptance gate
pnpm run check       # biome check . && tsc --noEmit (lint + format + types)
pnpm run build       # tsup -> dist/ (ESM, node20; dist/cli.js is the bin)
```

`pnpm test` and `pnpm run check` must both pass before any change is committed.

## The one rule that shapes the codebase: author once, compile per target

Every component sorts into one of three portability tiers:

- **Portable** — same artifact on both CLIs (skills as SKILL.md; MCP servers).
- **Compiled per target** — one source of truth, emit native config per CLI.
  Claude Code uses JSON (`settings.json`, `.mcp.json`, `.claude/agents/*.md`);
  Codex uses TOML (`config.toml`).
- **External program** — CLI-agnostic by construction (the tracker MCP server).

**Invariant:** anything that branches on "which CLI" lives in exactly two places —
`src/seam/` (launching a CLI headless) and `src/adapters/` (emitting its config).
Nowhere else in the codebase should know a target's name.

## Layout

| Path | What |
| --- | --- |
| `src/core/task.ts` | Task schema (zod) — the contract everything talks to |
| `src/tracker/` | Issue tracker: `store` (JSON file), `select` (next task), `server` (MCP) |
| `src/seam/` | CLI-invocation seam: `targets`, `argv` (per-CLI flag maps + `--json`), `run` (headless spawn + per-iteration cost capture) |
| `src/adapters/{common,claude,codex}/` | Emit hooks / agents / mcp config per target |
| `src/install/` | `plan` (the per-target file list) → `init` (write) / `remove` (uninstall) / `build` (compile + preview, no install) / `inventory` (report what's installed); `errors` (typed failures) |
| `src/loop/` | `governor` (caps/kill switch) + `journal` (per-iteration JSONL) |
| `src/skills/` | Skill loading; bundled skills live in `skills/` |
| `src/cli.ts` | `backpressure` bin — `init`, `remove`, `build`, `index` |
| `issues/` | Known bugs / feedback from trials |

## Conventions

- TypeScript, Node 20+, ESM. Tests use **vitest**; lint/format/imports via **biome**.
- Every `src/` file has a sibling test under `test/` mirroring the path. Add the
  test in the same change as the source.
- Write pure, testable functions; isolate side effects (fs, child_process,
  network) behind small wrappers so they can be mocked.
- Prefer the libraries already in `package.json` (zod, `@modelcontextprotocol/sdk`,
  commander, smol-toml). Don't add dependencies without a reason tied to the change.
- Keep commits small and focused.

## Autonomous loop discipline (when run headless via scripts/ralph-loop.sh)

When a loop iteration is driving this repo (see `PROMPT.md`, `specs/`, `fix_plan.md`):

- **One productive commit per loop.** Land exactly one unchecked `fix_plan.md`
  item, with its `@acceptance` test(s) in the same change, then commit and stop.
- **The gate is the done-signal.** `./scripts/backpressure-gate.sh` must be green
  before ticking a box. It runs biome + tsc + the stub/duplicate guards +
  `pnpm test` + `pnpm run test:acceptance` + secret/dep scans (one exit code).
- **Never push to a remote, never publish, never `git push`.** Work only on the
  throwaway branch; a human reviews and merges to `main`. The package is
  `private`/unpublished — never run a publish step.
- **Capture intent.** When something keeps going wrong, fix the memory files
  (`specs/`, tests, docs), not just the code — the next loop has amnesia.

## Non-goals (v0)

No custom agent loop or context manager (the CLI's job). No marketplace publishing.
The store is a JSON file (`better-sqlite3` is a planned post-v0 upgrade).

## Why Beads, and when to reach for it

**Why:** this is a headless-loop project — iterations have amnesia (see the loop
discipline above). Beads (`bd`) gives work a home *outside* the model's context:
an issue survives compaction, a killed loop, and a brand-new session. TodoWrite,
`TaskCreate`, and markdown TODO lists don't — they vanish with the context window
and fragment across sessions. So task state lives in `bd`, and cross-session
insight lives in `bd remember`, never in scratch files. (The detailed command
reference and session-close protocol below this line are machine-managed by `bd`;
run `bd prime` to regenerate/see them — this section is the hand-written *why*.)

**When to reach for it:**

- **Before writing code** — create and claim the issue first (`bd create …`,
  `bd update <id> --claim`) so the *intent* of a change is recorded before the
  diff exists. One unchecked item ≈ one issue ≈ one focused commit.
- **Starting a session** — `bd ready` is the entry point; `bd show <id>` for detail.
- **Finishing work** — `bd close <id>` once `./scripts/backpressure-gate.sh` is
  green; file follow-up issues for anything left over.
- **Persisting knowledge** — `bd remember "insight"` for what the next amnesiac
  loop will need; `bd memories <keyword>` to recall it. Not MEMORY.md files.

**When NOT to:** don't track work in TodoWrite/`TaskCreate`/markdown TODOs, and
don't commit, push, or `bd dolt push` without the authority the active profile
grants (see Agent Context Profiles below). The autonomous loop's "never push"
rule still wins over any Beads sync step.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
