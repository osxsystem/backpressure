# Backpressure

A **capability pack** for agentic coding CLIs — **Claude Code** and **Codex CLI**.
It is *not* an agent or a runtime: the agent loop, tool execution, and sandboxing
stay with the CLI. Backpressure ships configuration, prompts, small scripts, and
two helper programs (an issue tracker and the Ralph loop) that you install *into*
an existing CLI to make its autonomous loop converge instead of drift.

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
| Run the autonomous build loop | [The Ralph loop](#the-ralph-loop) below |
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

## The Ralph loop

`ralph.sh` is the reference autonomous loop: it drives a CLI headless on **one**
task at a time with a fresh context, gates each iteration on tests + lint, commits,
and repeats — the test/lint gate is the backpressure. It reads its task queue from
a `PLAN.md` (a checklist of `- [ ]` tasks) and its per-iteration prompt from a
`prompt.md`; **you author both** for whatever you're building. `ralph.sh` exits if
either file is missing.

> ⚠️ **Run it in a Docker dev container or a throwaway git worktree — never on your
> real repo.** It runs the CLI with permission/approval prompts bypassed; git is
> your only undo button. As a guard, `ralph.sh` refuses to run on `main`/`master`.

```bash
# from a repo with your PLAN.md + prompt.md
git worktree add ../backpressure-loop -b ralph/auto
cd ../backpressure-loop
chmod +x ralph.sh

MAX_ITERS=2 ./ralph.sh     # attended dry run: watch 2 iterations first
./ralph.sh                 # then let it run
```

Configure via environment variables (`AGENT`, `MAX_ITERS`, `MAX_STALLS`,
`BUDGET_USD`, `TEST_CMD`, `CHECK_CMD`, `MAX_TURNS`) — full table in the
[User Guide](docs/USER_GUIDE.md#the-ralph-loop).

> Before using `BUDGET_USD`, confirm your CLI supports the flag
> (`claude --help | grep -i budget`). If it's absent, leave `BUDGET_USD` unset —
> otherwise every iteration errors out.

### Safety checklist (read before every run)

- [ ] Running in a container or a throwaway worktree/branch (not main, not your real repo).
- [ ] No production credentials reachable from here.
- [ ] Iteration cap set (`MAX_ITERS`).
- [ ] Commits happen per iteration (git is the undo button).
- [ ] First run was attended.

### Review afterward

```bash
git log --oneline          # the work, task by task
ls .ralph/                 # per-iteration JSON logs
grep BLOCKED PLAN.md       # anything the loop got stuck on
```

Every stumble is a signal the agent lacked context — feed it back into `CLAUDE.md`
or a skill, then run again. Once you understand the mechanics, you can graduate to
Claude Code's built-in `/loop` or a community control plane instead of maintaining
the bash yourself.
