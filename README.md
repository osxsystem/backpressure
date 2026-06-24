# Backpressure loop pack

A drop-in starter for running an autonomous Claude Code build loop that builds the
Backpressure toolkit one task at a time, with a test + lint gate as backpressure.

Files:
- `SPEC.md`   — the design the agent reads (the *what* and *why*).
- `PLAN.md`   — the ordered task queue; each task's acceptance is a passing test.
- `CLAUDE.md` — the per-task cycle and hard rules, auto-read every iteration.
- `ralph.sh`  — the loop: caps, test + lint gate, stall detection.

> **Using the built toolkit** (the `backpressure` CLI, the issue tracker, skills,
> adapters)? See **[`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)**. This README covers
> the *loop pack* that builds it.

## Run it (safely)

### 1. Isolate — do not run on your real repo
Best: a Docker dev container. Minimum: a throwaway git worktree.

```bash
# from your toolkit repo
git worktree add ../backpressure-loop -b ralph/auto
cd ../backpressure-loop
```

The worktree puts you on branch `ralph/auto`. This matters: `ralph.sh` **refuses to
run on `main`/`master`** as a safety guard. If you set up a plain folder with
`git init` instead, you'll be on `main` and the loop won't start — switch to a
throwaway branch first (`git checkout -b ralph/auto`).

Copy the four files into that directory and initialize git if needed:

```bash
cp /path/to/pack/{SPEC.md,PLAN.md,CLAUDE.md,ralph.sh} .
git init -q 2>/dev/null; git add -A && git commit -qm "seed: loop pack"
chmod +x ralph.sh
```

### 2. Attended dry run — watch 2 iterations
Never walk away on the first run. Confirm the agent picks ONE task, runs tests,
commits, and checks the box.

```bash
MAX_ITERS=2 ./ralph.sh
```

Check: `git log --oneline` shows clean per-task commits, and `PLAN.md` has boxes ticked.

> **Watch T1 especially.** The loop's gate runs `npm test` after every iteration,
> but tests can't pass until T1 has created `package.json` and the test script. A
> half-finished T1 will halt the whole loop after one iteration. If that happens,
> either split T1 into two smaller tasks (init npm + test script, then add tsup/
> tsconfig) or do T1 by hand and let the loop start at T2.

### 3. Let it run
Once two iterations look right:

```bash
./ralph.sh
# optional: add a per-iteration spend cap
BUDGET_USD=2.00 ./ralph.sh
```

> Before using `BUDGET_USD`, confirm your CLI supports the flag:
> `claude --help | grep -i budget`. If it's absent, leave `BUDGET_USD` unset
> (the default) — otherwise every iteration will error out.

### 4. Review in the morning
```bash
git log --oneline          # the work, task by task
ls .ralph/                 # per-iteration JSON logs
grep BLOCKED PLAN.md        # anything the loop got stuck on
```

Every stumble is a signal the agent lacked context — feed it back into `CLAUDE.md`
or a skill, then run again.

## Safety checklist (read before every run)
- [ ] Running in a container or a throwaway worktree/branch (not main, not your laptop's real repo).
- [ ] No production credentials reachable from here.
- [ ] Iteration cap set (`MAX_ITERS`).
- [ ] Commits happen per iteration (git is the undo button).
- [ ] First run was attended.

## Tuning
- If a task keeps failing, split it into two smaller tasks in `PLAN.md`.
- If the agent under-tests, strengthen the acceptance line for that task.
- `TEST_CMD` defaults to `npm test`; override it for your runner, e.g. `TEST_CMD="pnpm test" ./ralph.sh`.
- The loop also runs `npm run check --if-present` (lint/format) as part of the gate — a
  no-op until task T2 adds a `check` script. Override with `CHECK_CMD="..."` if needed.

## Once you understand the mechanics
You can graduate from this hand-rolled loop to Claude Code's built-in `/loop`,
or a community control plane (exit detection, rate limiting, dashboards) instead
of maintaining the bash yourself.
