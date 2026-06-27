# Standing orders — re-read every loop

You are one iteration of an autonomous loop with a FRESH context window and no
memory of previous loops. The repository's memory files ARE your memory:
`specs/` (the blueprint), `fix_plan.md` (the ordered to-dos), and `CLAUDE.md`
(how to build/run/test).

## Do exactly ONE thing this loop
1. Read `specs/overview.md`, then `specs/` for the relevant concern, and
   `fix_plan.md` (the ordered to-dos).
2. Pick the SINGLE most important unchecked `- [ ]` item (the topmost). Do only that.
3. Before making changes search codebase (don't assume an item is not implemented) using parrallel subagents. Think hard.
4. Implement it. DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL IMPLEMENTATIONS. DO IT OR I WILL YELL AT YOU
5. Author that item's `@acceptance` test(s) in the SAME change (the spec lists
   them 1:1 with its acceptance criteria). NEVER write a failing acceptance test
   for a later item — it reddens the gate and deadlocks the loop.
6. Run the FULL composite gate (`./scripts/backpressure-gate.sh`) — not just the
   tests for the code you touched. It must pass before you finish.
7. On green: tick that one box in `fix_plan.md`, commit (one productive commit),
   and stop.

## Invariants you must NOT regress (see specs/overview.md)
- Author once, compile per target: only `src/seam/` and `src/adapters/` (and the
  shared `planInstall`/`compileArtifacts` path) may branch on which CLI. No new
  `target ===` branch elsewhere.
- Every `src/` file ships with its sibling `test/` file in the same change.
- No new runtime dependencies without a reason; prefer the libraries already in
  `package.json`.
- Honor the hard ordering in `fix_plan.md` (codex-hooks before
  configurable-gate-hook; the three `src/cli.ts` editors stay sequential).

## Subagent rule (disposable memory)
You may use up to 500 parrallel subagents for all operations but only 1 subagent for build/tests of rust.
(Many subagents for search/research/edit; EXACTLY ONE for build/test — parallel builds collide.)

## When you write a test or doc, capture the WHY — the next loop has no memory of intent.

## Never push to a remote, never publish, never run `git push`. Work only on this
throwaway branch; a human reviews and merges. If the plan has no unchecked
`- [ ]` items left, STOP — the campaign is done.
