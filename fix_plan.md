# fix_plan — v0→v1 CLI hardening

Ordered, smallest-shippable-first. Each loop: pick the **single topmost
unchecked `- [ ]`**, do only that, run `./scripts/backpressure-gate.sh`, and on
green tick the box + commit. Each item is one shippable change traceable to one
spec in `specs/`. Author each item's `@acceptance` test(s) **in the same change**
(never pre-author a failing test for a later item — it reddens the gate).

**Hard ordering (do not reorder):** `codex-hooks` lands before
`configurable-gate-hook`; the `init.ts` `buildWrites` refactor (build item 1)
lands after the gate-command threading; the three `src/cli.ts` editors —
`--gate` on init, `build`, `index` — land **sequentially, never interleaved**, in
that order.

## codex-hooks (specs/codex-hooks.md)

- [x] Rewrite `emitCodexHooks` in `src/adapters/codex/hooks.ts` to group `HookDefinition`s by event and emit the nested shape `{ hooks: { [event]: [{ matcher?, hooks: [{ type:'command', command }] }] } }` (`[[hooks.<Event>]]` + `[[hooks.<Event>.hooks]]`), replacing the flat `CodexHookTable`; in the SAME change replace the flat round-trip assertions in `test/adapters/codex/hooks.test.ts` with the four nested `@acceptance` tests (criteria 1-4), including the `Array.isArray(parsed.hooks) === false` tripwire.
- [x] Add an `@acceptance` end-to-end test in `test/install/init.test.ts` that, after `init('codex', dir)`, parses the written `.codex/config.toml` and asserts `parsed.hooks.Stop[0].hooks[0].command === 'pnpm test'` (criterion 5). No source edit — proves the on-disk file Codex loads is nested.
- [x] Update the "what init writes" Codex examples in `docs/RALPH_PRODUCTION_GUIDE.md` §2.7 and §3.4 from the flat `[[hooks]]` shape to the nested `[[hooks.Stop]]` + `[[hooks.Stop.hooks]]` shape so the docs match the emitter.

## configurable-gate-hook (specs/configurable-gate-hook.md) — after codex-hooks

- [x] Thread an optional `gateCommand` (default `'pnpm test'`) from `init()` into `buildWrites` via a pure `stopGateHooks(cmd)` helper; redefine `DEFAULT_HOOKS = stopGateHooks('pnpm test')`; add `gateCommand?: string` to `InitOptions`; consume `stopGateHooks(gateCommand)` in BOTH the Claude and Codex branches of `buildWrites`; add the four init-side `@acceptance` tests + the `DEFAULT_HOOKS` guard in `test/install/init.test.ts` (criteria 1-4, 6).
- [x] Register `--gate <command>` (default `'pnpm test'`) on the **init** subcommand in `src/cli.ts` and pass `options.gate` as `gateCommand` into `init()`; add the `--gate` flag + defaultValue assertion in `test/cli.test.ts` (criterion 5). *(First `cli.ts` editor — must precede the build/index `cli.ts` edits.)*
- [x] Document the `--gate` flag in `docs/USER_GUIDE.md` (default `pnpm test`; point at `./scripts/backpressure-gate.sh` for the composite gate).

## build-command (specs/build-command.md) — init.ts refactor after gate threading

- [x] Factor the private `buildWrites` (`src/install/init.ts`) into an exported `compileArtifacts` with identical logic and export the `WriteOp` union; `init()` calls the shared function so existing init tests stay green (pure refactor, no behavior change — must land after the gate-command threading so `compileArtifacts` inherits the `gateCommand` default).
- [x] Add `src/install/build.ts` exporting `build(target, opts)` (reuses `planInstall` + `compileArtifacts` + adapter emitters; returns `WriteOp[]`, writes nothing when `opts.out` is unset; stages config-only write ops under `<dir>` via injected `InstallIo` when set) and the pure `formatArtifacts(ops)` renderer; add sibling `test/install/build.test.ts` covering criteria 1-6, 8 (claude/codex artifacts, read-only default, `--out` staging + determinism, v0 no-MCP omission, init byte-parity, no per-target branch).
- [x] Wire the `src/cli.ts` **build** subcommand to the real logic: `--target` (via `parseTarget`, default claude) and `--out <dir>`; print `formatArtifacts` to stdout by default or stage to `--out`, exit 0; reword the help off "Build the distributable artifacts (stub)."; add a `test/cli.test.ts` assertion that build emits compiled output and never prints "not yet implemented" (criterion 7). *(Second `cli.ts` editor — after `--gate`, before `index`.)*
- [x] Update `docs/USER_GUIDE.md` to document `backpressure build` (`--target`/`--out`) and remove `build` from the v0 "not yet implemented" stub list in `docs/RALPH_PRODUCTION_GUIDE.md`.

## index-command (specs/index-command.md) — cli.ts edit after build

- [x] Add `src/install/inventory.ts` exporting `inventory(target, opts)` (reuses `planInstall` for candidate paths; checks each for existence via an injected `ExistsIo`; returns `CapabilityEntry[]`; no per-target branch) and the pure `formatInventory(entries)` renderer; add sibling `test/install/inventory.test.ts` covering criteria 1-4, 6 (clean-repo all-absent, present-after-init + `.mcp.json` omission, read-only, codex via planInstall, mixed state).
- [x] Wire the `src/cli.ts` **index** subcommand to the real logic: `--target` (via `parseTarget`, default claude) and `--json`; print `formatInventory` to stdout (or JSON with `--json`), exit 0; reword the help off "Index the installed capabilities (stub)."; add a `test/cli.test.ts` assertion that index emits an inventory and never prints "not yet implemented" (criteria 5, 7). *(Third `cli.ts` editor — after build.)*
- [x] Update `docs/USER_GUIDE.md` to document `backpressure index` (`--target`/`--json`) and remove `index` from the v0 "not yet implemented" stub list in `docs/RALPH_PRODUCTION_GUIDE.md`.

## governor-cost (specs/governor-cost.md) — independent (touches only src/seam + loop test + docs)

- [ ] Extend `TargetFlags` and both `TARGET_FLAGS` entries in `src/seam/targets.ts` with `jsonOutput` (claude `['--output-format','json']`, codex `['--json']`) and `costPath` (claude `'total_cost_usd'`, codex `null`); assert the values **and** the no-leak source-tree scan (`'total_cost_usd'`, `'--output-format'`, `'--json'` absent in `src/` outside `src/seam/`) in `test/seam/targets.test.ts` (criterion 2).
- [ ] Add `json?: boolean` to `AgentOpts` in `src/seam/argv.ts` and append `flags.jsonOutput` tokens last (after `--max-turns`) only when `json` is truthy and `jsonOutput !== null`; assert claude/codex tokens appended and json-off argv byte-unchanged in `test/seam/argv.test.ts` (criterion 1).
- [ ] In `src/seam/run.ts` add pure `parseCostUsd(stdout, target)` (returns `undefined` on null `costPath`/unparseable/missing/non-numeric — never `0`/`NaN`/throw); widen `SpawnedProcess` (optional stdout) and `SpawnFn` (capture hint), make `nodeSpawnFn` pipe stdout when capturing; migrate `runAgent` to resolve `RunResult { exitCode: number|null; costUsd?: number }`, wiring `opts.json` + stdout accumulation; rewrite the existing `.toBe(0)`/`.toBe(2)` exit-code assertions to `result.exitCode` and add the claude-0.6 / codex-undefined capture test + the `parseCostUsd` robustness test in `test/seam/run.test.ts` (criteria 3, 4, 6). Delete no behavioral test.
- [ ] Add `test/loop/governor-cost.test.ts`: an end-to-end `@acceptance` test wiring `runAgent` (fake spawn emitting `total_cost_usd`) into a real `Governor({ maxIterations:10, maxConsecutiveFailures:10, maxBudgetUsd:1 })`, asserting two 0.6 claude iterations fed via `gov.record('success', result.costUsd)` yield `decide().halt === true` with reason containing "budget", and that json-omitted (costUsd `undefined` → defaults 0) keeps `halt === false` (criterion 5). `src/loop/governor.ts` stays byte-unchanged.
- [ ] Update the `docs/RALPH_PRODUCTION_GUIDE.md` §3.11.1 harness line to `gov.record(outcome, result.costUsd)` and add a note that `maxBudgetUsd` is Claude-only in v0 and requires `json: true`.
