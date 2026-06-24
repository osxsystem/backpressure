# Backpressure — design spec

This is the design reference for the build. Read it for *what* to build and *why*.
Read PLAN.md for the ordered task list. Do not implement from this file directly —
implement the next task in PLAN.md.

## What this is

Backpressure is a **capability pack** for agentic coding CLIs (Claude Code and
Codex CLI). It is **not** an AI agent or runtime. It installs into existing CLIs.
The agent loop, tool execution, and sandboxing belong to the CLI; this project
ships configuration, prompts, small scripts, and two external programs.

## Core principle: author once, compile per target

Every component sorts into one of three portability tiers:

- **Portable** — same artifact works on both CLIs (skills as SKILL.md; MCP servers).
- **Compiled per target** — one source of truth, emit native config per CLI
  (hooks, subagents, MCP registration). Claude Code uses JSON
  (`settings.json`, `.mcp.json`, `.claude/agents/*.md`); Codex uses TOML
  (`config.toml`).
- **External program** — CLI-agnostic by construction (issue tracker = MCP server;
  Ralph loop = shell harness that invokes the CLI headless).

## Components

1. **Issue tracker** (external, MCP server) — the task queue and the loop's memory.
   Tools: `next`, `update`, `create`. Backed by a JSON file in v0. (SQLite via
   `better-sqlite3` is a planned post-v0 upgrade — there is no task for it yet.)
2. **Ralph loop** (external, shell harness) — reads the next task, invokes the CLI
   headless on ONE task with a fresh context, gates on tests, commits, repeats.
3. **CLI-invocation seam** — the one real abstraction. Wraps `claude -p` and
   `codex exec`, normalizing flags (headless, permission/sandbox, model, max-turns).
4. **Hooks** (compiled) — hard guardrails. Scope guards, a test-gate on Stop.
5. **Subagents** (compiled) — context-isolated specialists (e.g. reviewer).
6. **Skills** (portable) — soft guidance loaded on demand (SKILL.md bundles).
7. **Adapters / installer** — compile capabilities to each CLI's config; `init` writes them.

## Tech stack

- Language: TypeScript, Node 20+.
- Validation/schemas: `zod` (one schema -> runtime validation + JSON Schema for MCP).
- MCP: `@modelcontextprotocol/sdk`.
- Store: JSON file in v0. (`better-sqlite3` is a post-v0 upgrade, not in the current PLAN.)
- TOML emit: `smol-toml`.
- CLI: `commander`.
- Build/test: `tsup` + `vitest`.
- Loop harness: bash.

## The per-task cycle (how each task is done)

implement -> run tests -> if red, fix -> re-run -> when green, commit.
A task is only "done" when its acceptance check (a passing test) holds.

## Non-goals (v0)

- No custom agent loop or context manager (that's the CLI's job).
- No publishing to marketplaces yet.
- Keep everything CLI-specific behind the seam and the adapters — nowhere else.
