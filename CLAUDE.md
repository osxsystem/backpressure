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
| `src/seam/` | CLI-invocation seam: `targets`, `argv` (per-CLI flag maps), `run` |
| `src/adapters/{common,claude,codex}/` | Emit hooks / agents / mcp config per target |
| `src/install/` | `init` installer + `plan` (what files `init` writes) |
| `src/loop/` | `governor` (caps/kill switch) + `journal` (per-iteration JSONL) |
| `src/skills/` | Skill loading; bundled skills live in `skills/` |
| `src/cli.ts` | `backpressure` bin — `init`, `build`*, `index`* (*stubs in v0) |
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

## Non-goals (v0)

No custom agent loop or context manager (the CLI's job). No marketplace publishing.
The store is a JSON file (`better-sqlite3` is a planned post-v0 upgrade).
