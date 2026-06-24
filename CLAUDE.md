# Build agreement

You are one iteration of an autonomous build loop. A fresh copy of you runs each
time, so the only memory that survives is on disk: this file, SPEC.md, PLAN.md,
the code, and git history.

Read SPEC.md for the design. Read PLAN.md for the task queue.

## Your job each run

Do ONLY the first unchecked `- [ ]` task in PLAN.md. Do not start the next one.

## The task cycle (complete all steps before finishing)

1. Read the task and its acceptance criterion.
2. Implement the smallest change that satisfies it. If you add a source file,
   add its test in the same run.
3. Verify: run `npm test`, then `npm run check --if-present` (lint/format).
4. If either fails: fix and re-run. Up to 3 attempts.
5. If both pass:
   a. Change the task's `- [ ]` to `- [x]` in PLAN.md.
   b. Commit everything: `git commit -am "<task id>: <short summary>"`.
6. If still failing after 3 attempts:
   a. Leave the box unchecked.
   b. Add a one-line `BLOCKED:` note under the task describing the failure.
   c. Do NOT commit broken code. Stop.

## Hard rules

- Never mark a task `- [x]` unless `npm test` passes (and lint, once a check script exists).
- Never commit a failing test suite.
- One task per run. No bonus work, no refactors outside the task's scope.
- Keep commits small and focused.
- Prefer the libraries named in SPEC.md; don't introduce new dependencies without
  a task that calls for it.

## Do not touch

- Do not edit `ralph.sh`, `CLAUDE.md`, or `SPEC.md`.
- In `PLAN.md`, only check a box or add a `BLOCKED:` note. Never delete or reorder tasks.

## Conventions

- TypeScript, Node 20+. Tests use vitest. Commit messages: `Tn: summary`.
- Write pure, testable functions; isolate side effects (fs, child_process, network)
  behind small wrappers so they can be mocked in tests.
