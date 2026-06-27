# Backpressure

A **capability pack** for agentic coding CLIs — **Claude Code** and **Codex CLI**.
It is *not* an agent or a runtime: the agent loop, tool execution, and sandboxing
stay with the CLI. Backpressure ships configuration, prompts, and small scripts
that you install *into* an existing CLI to make its autonomous loop converge
instead of drift. (An issue tracker also lives in the tree but is deferred
post-v0 — it isn't installed yet.)

Author each capability **once** and compile it to each CLI's native config
(`backpressure init` does the emitting). See
[`backpressure-architecture.html`](backpressure-architecture.html) for the design
blueprint and rationale.

## Where to go

| You want to… | Read |
|--------------|------|
| Use or extend the toolkit (the `backpressure` CLI, tracker, skills, adapters) | **[`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)** |
| Understand the design (*what* and *why*) | [`backpressure-architecture.html`](backpressure-architecture.html) |
| Work on this codebase (layout, conventions, the one seam) | [`CLAUDE.md`](CLAUDE.md) |
| Learn the Ralph technique this project is named after (beginner guide) | [`docs/RALPH_GUIDE.md`](docs/RALPH_GUIDE.md) |
| See known bugs / trial feedback | [`issues/`](issues/) |

## Quickstart

TypeScript project, Node 20+, pnpm (`corepack enable`).

```bash
pnpm install
pnpm test            # vitest — the acceptance gate
pnpm run check       # biome check . && tsc --noEmit
pnpm run build       # tsup -> dist/ (produces the executable dist/cli.js)

# install the capabilities into the current repo
node dist/cli.js init --target claude --dry-run   # preview the file plan
node dist/cli.js init --target claude             # writes .claude/ + .mcp.json
node dist/cli.js init --target codex              # writes .codex/config.toml
```

Full CLI reference, what `init` installs, and the library API are in the
[User Guide](docs/USER_GUIDE.md).

## Running an autonomous loop

Backpressure no longer ships a bundled loop runner. The loop, context management,
and sandboxing are the CLI's job — drive the autonomous build loop with Claude
Code's built-in `/loop` (or your own harness) against a throwaway git worktree.
The tested TypeScript building blocks (`loop/governor.ts`, `loop/journal.ts`) and
the headless-invocation seam (`seam/run.ts`) remain for assembling your own; see
the [User Guide](docs/USER_GUIDE.md#loop-building-blocks).
