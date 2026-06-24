# Build plan

Ordered task queue for the autonomous loop. Each task has a machine-checkable
acceptance criterion — a test that must pass. The loop does ONE unchecked task
(an empty checkbox) per iteration, top to bottom.

Tuning notes (for the human, not the agent):
- Split any task the loop keeps failing into two smaller ones.
- Delete tasks you don't want; reorder freely.
- Keep every acceptance criterion runnable (a test), or the loop can't self-verify.

## Milestone A — foundation

- [x] T1: Scaffold the TypeScript project — package.json, tsconfig.json, tsup, vitest,
  `src/` and `test/` dirs, and an npm `test` script. Accept: `npm test` runs and exits 0
  with a single passing placeholder test in `test/smoke.test.ts`.
- [x] T2: Add lint + format (eslint + prettier OR biome) and an npm `check` script.
  Accept: `npm run check` exits 0 on the current tree.

## Milestone B — task contract + issue tracker

- [x] T3: Define the Task schema with zod in `src/core/task.ts` (fields: id, title,
  status enum [open|done|blocked], acceptance, scope, deps[]). Accept: a test validates
  a well-formed task and rejects one with a bad status.
- [x] T4: Task store interface + JSON-file implementation in `src/tracker/store.ts`
  (create, get, list, update). Accept: a test does a create -> get -> update -> list
  round-trip against a temp file.
- [x] T5: Next-task selection in `src/tracker/select.ts` — return the first `open` task
  whose `deps` are all `done`. Accept: a fixture test returns the correct task and
  skips one with an unmet dependency.
- [x] T6: Issue-tracker MCP server in `src/tracker/server.ts` exposing tools `next`,
  `update`, `create` via @modelcontextprotocol/sdk. Accept: a test builds the server and
  asserts all three tools are registered with their zod input schemas.

## Milestone C — CLI-invocation seam

- [x] T7: Define `AgentTarget` and per-target flag maps for `claude` and `codex` in
  `src/seam/targets.ts`. Accept: a test asserts the headless + permission flags for each.
- [ ] T8: Pure `buildArgv(target, prompt, opts)` in `src/seam/argv.ts` (headless, sandbox/
  permission, model, maxTurns). Accept: a test asserts the exact argv for both `claude`
  and `codex` given identical opts.
- [ ] T9: `runAgent(target, prompt, opts)` in `src/seam/run.ts` wrapping child_process with
  an injectable spawn. Accept: a test with a fake spawn asserts the command + argv and
  parses the exit code.

## Milestone D — adapters (compile per target)

- [ ] T10: Hook definition type + `emitClaudeHooks()` -> settings.json fragment in
  `src/adapters/claude/hooks.ts`. Accept: a test asserts the emitted JSON for a sample hook.
- [ ] T11: `emitCodexHooks()` -> config.toml fragment using smol-toml in
  `src/adapters/codex/hooks.ts`. Accept: a test round-trips (emit -> parse) and asserts fields.
- [ ] T12: Subagent definition type + `emitClaudeAgents()` (markdown) and
  `emitCodexAgents()` ([agents] TOML) in `src/adapters/*/agents.ts`. Accept: tests assert
  both outputs from one shared definition.
- [ ] T13: MCP config emitters — `emitClaudeMcp()` (.mcp.json) and `emitCodexMcp()`
  (config.toml [mcp_servers]). Accept: tests assert both outputs from one server definition.

## Milestone E — skills (portable)

- [ ] T14: Skills loader in `src/skills/load.ts` — scan a skills dir and parse each
  SKILL.md YAML frontmatter (name, description). Accept: a test parses a fixture skill and
  returns name+description, and rejects a skill missing `description`.
- [ ] T15: Bundle the `building-adaptive-ui` skill under `skills/building-adaptive-ui/`
  (SKILL.md + scripts/check-hardcoded-colors.sh). Accept: a test asserts the loader finds
  it and its frontmatter is valid.

## Milestone F — installer / CLI

- [ ] T16: Pure `planInstall(target, repoPath)` in `src/install/plan.ts` — compute the list
  of files to write (skills dir, agents, hooks, mcp config) for the target. Accept: a test
  asserts the planned file list for `claude` and for `codex`.
- [ ] T17: `init` command writes the planned files, supports `--dry-run`. Accept: a dry-run
  test against a temp dir writes nothing and returns the plan; a real-run test asserts the
  files exist on disk.
- [ ] T18: Wire the commander CLI bin (`backpressure init|build|index`) in `src/cli.ts` and
  add the `bin` field to package.json. Accept: a test invokes the entry with `--help` and
  asserts the subcommands are listed.

## Milestone G — loop + governor

- [ ] T19: Journal writer in `src/loop/journal.ts` — append one JSONL line per iteration
  (iteration, task id, result, duration). Accept: a test writes two entries and reads them back.
- [ ] T20: Iteration/budget governor in `src/loop/governor.ts` (maxIterations, optional
  maxBudgetUsd, stop after N consecutive failures). Accept: a test asserts it halts at the
  iteration cap and after N consecutive failures.

## Milestone H — packaging + smoke

- [ ] T21: `npm run build` (tsup) produces `dist/` with an executable `dist/cli.js`.
  Accept: a test runs the build and asserts `dist/cli.js` exists.
- [ ] T22: End-to-end smoke — `init` into a temp repo, assert both `.claude/` and `.codex/`
  artifacts are present and parse. Accept: the e2e test passes.
