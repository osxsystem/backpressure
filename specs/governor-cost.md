# Feed real per-iteration cost into the Governor

## What to build

The `Governor` is already fully cost-aware: it keeps `private spentUsd = 0`
(`src/loop/governor.ts:35`), accumulates it in `record(outcome, costUsd = 0)`
(`src/loop/governor.ts:44-48`), and halts on the budget cap in `decide()`
(`src/loop/governor.ts:66-68`, last in the fixed `iterations -> consecutiveFailures
-> budget` precedence chain). The defect is upstream: **nothing ever feeds it a
real cost.** `maxBudgetUsd` is therefore permanently inert in any real loop — the
production guide states this outright (`docs/RALPH_PRODUCTION_GUIDE.md:992,1002`:
"INERT unless you feed real costUsd to record()" / "maxBudgetUsd does nothing
unless you feed real costUsd").

The reason is that the seam that actually runs a CLI throws the cost away:

- `src/seam/run.ts:29-30` (`nodeSpawnFn`) spawns with `stdio: "inherit"`, so the
  agent's stdout goes straight to the terminal and is never captured.
- `runAgent` resolves `Promise<number | null>` — the exit code only
  (`src/seam/run.ts:46-60`); there is no field for cost.
- The injectable `SpawnedProcess` interface (`src/seam/run.ts:16-19`) models only
  `on("close")` / `on("error")` — there is no `stdout` stream to read.
- There is no JSON-output knob anywhere: `AgentOpts` (`src/seam/argv.ts:8-20`) has
  no `json`, `buildArgv` (`src/seam/argv.ts:36-54`) emits no `--output-format`, and
  `TargetFlags` (`src/seam/targets.ts:17-32`, values at `40-53`) has neither a
  JSON-output flag nor a cost-field name. So `claude -p --output-format json`
  (which carries `total_cost_usd`, per `docs/RALPH_PRODUCTION_GUIDE.md:292` and the
  §3.8 snippet at `980-984`) is never requested and never parsed.

Build the missing capture link **entirely inside `src/seam/`** and surface cost as
a field on `runAgent`'s result. The Governor is left untouched — the wiring is the
caller passing the captured number into `gov.record(outcome, result.costUsd)`.
Concretely:

1. **`src/seam/targets.ts`** — extend `TargetFlags` with two per-CLI concepts:
   - `jsonOutput: readonly string[] | null` — claude: `["--output-format", "json"]`;
     codex: `["--json"]`.
   - `costPath: string | null` — the JSON field that carries USD spend. claude:
     `"total_cost_usd"`; codex: `null` (Codex emits a JSONL stream with no single
     per-call USD figure, per §2.6/§3.8, `docs/RALPH_PRODUCTION_GUIDE.md:976,981`).

   These two fields are the **only** place in the codebase that branches on which
   CLI for cost capture.

2. **`src/seam/argv.ts`** — add `json?: boolean` to `AgentOpts`. When `json` is
   truthy **and** `flags.jsonOutput !== null`, append those tokens in a pinned,
   deterministic position: **after** `--max-turns` (last in the argv). Stays pure /
   no-I/O. When `json` is omitted/false the tokens never appear, so the existing
   argv tables (`docs/RALPH_PRODUCTION_GUIDE.md:335-339`) are unchanged.

3. **`src/seam/run.ts`** —
   - (a) widen `SpawnedProcess` to optionally expose
     `stdout?: { on(event: "data", cb: (chunk: unknown) => void): void } | null`;
   - (b) widen `SpawnFn` with an optional capture hint
     (`(command, args, opts?: { captureStdout?: boolean }) => SpawnedProcess`) and
     make `nodeSpawnFn` capture stdout when asked
     (`stdio: ["inherit", "pipe", "inherit"]`), else keep `"inherit"`;
   - (c) add a pure helper `parseCostUsd(stdout: string, target: AgentTarget):
     number | undefined` that reads `flagsFor(target).costPath` and pulls that
     numeric field from the parsed JSON, returning `undefined` when the path is
     `null`, the output is unparseable, or the field is missing/non-numeric;
   - (d) change `runAgent` to resolve a small
     `RunResult { exitCode: number | null; costUsd?: number }`, accumulating stdout
     chunks and populating `costUsd` only when `opts.json` is set and a cost was
     parsed.

4. **`src/loop/governor.ts`** — **NO change.** It already accepts
   `record(outcome, costUsd)` and accumulates into `spentUsd`. The "feed real cost"
   wiring is purely at the call site: `gov.record(outcome, result.costUsd)`. The
   doc harness line (`docs/RALPH_PRODUCTION_GUIDE.md:1127`) is updated to that form.

The `IterationOutcome` union (`"success" | "failure"`) and every existing Governor
test stay exactly as-is.

## Acceptance criteria

1. `buildArgv("claude", "do it", { json: true })` appends
   `["--output-format", "json"]` **after** the existing flags, and
   `buildArgv("codex", "do it", { json: true })` appends `["--json"]`; with `json`
   omitted or `false`, neither token sequence appears and the argv equals today's
   output for the same opts.
2. `flagsFor("claude").costPath === "total_cost_usd"` and
   `flagsFor("codex").costPath === null`; `flagsFor("claude").jsonOutput` deep-equals
   `["--output-format", "json"]` and `flagsFor("codex").jsonOutput` deep-equals
   `["--json"]`. The cost-specific spellings `"total_cost_usd"` and `"--output-format"`
   appear **nowhere** in `src/` outside `src/seam/` (proving the compile-per-target
   invariant). `"--json"` is **exempt** from the scan — `index` reuses it as a generic
   CLI flag (`src/cli.ts`), so it is not a reliable cost-leak signal.
3. Given a fake spawn whose stdout emits `{"total_cost_usd":0.6}` then closes `0`,
   `runAgent("claude", prompt, { json: true, spawn })` resolves
   `{ exitCode: 0, costUsd: 0.6 }`. For `codex` (costPath `null`) the same stdout +
   close flow resolves `costUsd === undefined` even though `--json` was passed.
4. `parseCostUsd` returns `undefined` (not `0`, not `NaN`, no throw) for each of:
   non-JSON stdout (`"not json"`), empty stdout (`""`), valid JSON missing the field
   (`'{"x":1}'` for claude), and any target whose `costPath` is `null` (codex, even
   with `'{"total_cost_usd":0.6}'`).
5. End-to-end: two `claude` iterations of `0.6` USD captured via `runAgent({ json:
   true })` and fed to `gov.record("success", result.costUsd)` on a
   `Governor({ maxIterations: 10, maxConsecutiveFailures: 10, maxBudgetUsd: 1 })`
   produce `decide().halt === true` with a `reason` containing `"budget"`; the same
   two iterations run with `json` omitted (so `result.costUsd` is `undefined` and
   `record` defaults the spend to `0`) keep `decide().halt === false` — proving the
   cap is armed by real captured cost, not by literals.
6. With `json` off, `runAgent("claude", ...)` resolves a `RunResult` whose
   `exitCode` carries the process exit code for both the `0` and a non-zero (`2`)
   case, and whose `costUsd` is `undefined` — the existing exit-code semantics
   survive the `number | null` -> `RunResult` return-type migration (the prior
   bare-number `.toBe(0)`/`.toBe(2)` assertions become `result.exitCode` reads, with
   no behavioral test deleted).

Standing repo gate (not a per-test criterion): `pnpm test` and `pnpm run check` both
pass; `src/loop/governor.ts` and `test/loop/governor.test.ts` are **byte-unchanged**;
no behavioral test in `test/seam/run.test.ts` is deleted (only its exit-code
assertions are rewritten to read `result.exitCode`).

## Acceptance tests

1. `@acceptance buildArgv appends per-target json-output tokens only when json is requested`
   — asserts criterion 1 (`test/seam/argv.test.ts`).
2. `@acceptance TargetFlags carries jsonOutput + costPath per target and no cost spelling leaks outside src/seam`
   — asserts criterion 2 (`test/seam/targets.test.ts`); the leak check reads every
   `src/**` file outside `src/seam/` and asserts the two cost-specific literals
   (`"total_cost_usd"`, `"--output-format"`) are absent (`"--json"` exempt — see criterion 2).
3. `@acceptance runAgent surfaces costUsd from claude json stdout and undefined for codex`
   — asserts criterion 3 (`test/seam/run.test.ts`).
4. `@acceptance parseCostUsd returns undefined for garbage, empty, missing-field, and null-costPath`
   — asserts criterion 4 (`test/seam/run.test.ts`).
5. `@acceptance governor halts on real captured cost fed through the seam`
   — asserts criterion 5 (`test/loop/governor-cost.test.ts`, new file).
6. `@acceptance runAgent's RunResult preserves exit-code semantics with json off`
   — asserts criterion 6 (`test/seam/run.test.ts`).

## Files to touch

- `/Users/hugues_mini/Codes/AgentTools/backpressure/src/seam/targets.ts`
  — add `jsonOutput` + `costPath` to `TargetFlags` and to both `TARGET_FLAGS`
  entries.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/src/seam/argv.ts`
  — add `json?: boolean` to `AgentOpts`; append `flags.jsonOutput` tokens last when
  requested and non-null.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/src/seam/run.ts`
  — widen `SpawnedProcess` (optional `stdout`) and `SpawnFn` (capture hint); make
  `nodeSpawnFn` pipe stdout when capturing; add pure `parseCostUsd`; change
  `runAgent` to resolve `RunResult { exitCode; costUsd? }`.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/test/seam/targets.test.ts`
  — assert `jsonOutput` + `costPath` values (criterion 2) and the
  no-leak-outside-seam scan.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/test/seam/argv.test.ts`
  — assert json tokens appended/dropped per target (criterion 1).
- `/Users/hugues_mini/Codes/AgentTools/backpressure/test/seam/run.test.ts`
  — add the capture test (criterion 3) and `parseCostUsd` robustness test
  (criterion 4); rewrite the existing `.toBe(0)`/`.toBe(2)` exit-code assertions to
  `result.exitCode` (criterion 6). Delete no behavioral test.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/test/loop/governor-cost.test.ts`
  — **new** end-to-end `@acceptance` test wiring the real seam (via fake spawn) to
  the real `Governor` (criterion 5), mirroring the e2e style of
  `test/e2e/smoke.test.ts`.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/docs/RALPH_PRODUCTION_GUIDE.md`
  — update the §3.11.1 harness wiring line (`:1127`) to
  `gov.record(outcome, result.costUsd)` and add a note that `maxBudgetUsd` is
  Claude-only in v0 and requires `json: true`.

Not touched (intentionally): `src/loop/governor.ts`, `test/loop/governor.test.ts`.

## Why these choices

- **The Governor stays untouched on purpose; the bug is upstream.** The cost-aware
  accumulation and the budget halt already exist and already have passing tests. The
  only missing link is *capturing* spend and *handing it to* `record`. Putting the
  fix in the seam (capture) plus the call site (one argument) keeps the deep,
  already-correct module unchanged and avoids duplicating spend bookkeeping in two
  places. A future loop that "consolidates" by moving accumulation into the seam, or
  that edits `governor.ts` to re-derive cost, is re-introducing the split this spec
  forbids — hence criterion 5 proves the cap arms *through the existing
  `gov.record`*, and the standing gate pins `governor.ts` byte-unchanged.

- **The per-CLI cost spelling lives ONLY in `src/seam`.** `total_cost_usd` and
  `--output-format json` are exactly the kind of "which CLI" knowledge the project
  invariant (CLAUDE.md: *anything that branches on which CLI lives in exactly two
  places — `src/seam/` and `src/adapters/`*) confines to the seam. Criterion 2's
  source-tree scan is a tripwire: if a future change inlines `total_cost_usd` into a
  loop runner or the CLI, the scan fails. (`--json` is **not** scanned — `index` reuses
  it as a generic output flag, so it is not a reliable cost-leak signal; the two
  cost-specific literals are the load-bearing ones.) Without that tripwire the literal
  could quietly leak and the "author once, compile per target" rule would erode invisibly.

- **`RunResult` struct over a callback / parallel `runAgentCaptured`.** The task asks
  for cost "surfaced as a field on `runAgent`'s result", and the only non-test caller
  is the doc harness, so widening the return type to
  `{ exitCode; costUsd? }` is the cleaner deep-module shape (one function, one
  result) and costs only a mechanical rewrite of three exit-code assertions. A
  callback/`onCost` or a second `runAgentCaptured` would duplicate the spawn seam and
  leave two run paths to keep in sync. Criterion 6 exists so that migration cannot
  silently drop the exit-code contract while changing the return type.

- **`costUsd` is `undefined` (not `0`, not `NaN`) when nothing is captured — this is
  load-bearing.** `undefined` lets `gov.record(outcome, undefined)` fall back to its
  default `0` *without arming the cap*, and crucially it is **not** `NaN`: a `NaN`
  cost would poison `spentUsd` (`NaN >= maxBudgetUsd` is always `false`), silently
  disarming the budget forever. `parseCostUsd` therefore returns `undefined` on every
  failure path (criterion 4) rather than coercing. `undefined` is also the typed
  signal at the call site that Codex has no per-call cost, so a reader sees
  immediately that the budget cap does not apply there.

- **`json` is opt-in (default `false`), not auto-enabled when a budget is set.**
  Capturing stdout changes terminal UX: `--output-format json` replaces streamed,
  human-readable text with one end-of-run blob. Forcing it whenever `maxBudgetUsd`
  is set would surprise operators and couple two unrelated knobs. The risk — a caller
  who forgets `json: true` gets a silently inert cap — is real and is documented (the
  guide note), and a loud guard (warn/throw when `maxBudgetUsd` is set but no cost was
  captured) belongs in the *harness*, not in the pure `Governor`. Criterion 5's second
  half (`json` omitted -> `halt === false`) pins this opt-in behavior so it is not
  "helpfully" flipped to always-on.

- **Codex `costPath` is `null` because Codex genuinely has no single per-call USD
  figure** (`docs/RALPH_PRODUCTION_GUIDE.md:976,981`). This is not an unfinished
  TODO to be "filled in later" with a guessed field name — inventing one would feed
  the Governor a wrong number. v0's honest contract is: budget on Codex is governed by
  `maxIterations` + timeout, and `maxBudgetUsd` is Claude-only. Criterion 3's codex
  branch (`undefined` even though `--json` was passed) locks this in.

- **JSON tokens are appended last, in fixed order.** Determinism keeps `buildArgv`'s
  contract exact and unit-testable (the existing argv tests assert full arrays), and
  appending after `--max-turns` means the existing `json`-off outputs are byte-for-byte
  unchanged (criterion 1, and the guide's argv tables at `:335-339`).

## Out of scope / non-goals

- **Any change to `src/loop/governor.ts`** — its accumulation and budget halt are
  already correct and already tested; this concern only feeds it real data.
- **A production loop runner in `src/`.** There is none today (only `governor.ts` +
  `journal.ts` under `src/loop/`), and the loop harness lives in docs (§3.11.1). This
  spec wires capture into `runAgent` and proves the arming end-to-end in a test; it
  does not build the unattended runner or call `runAgent` from `src/cli.ts`.
- **Parsing a real Codex JSONL cost stream / deriving a per-call USD for Codex.**
  `costPath: null` is the deliberate v0 answer; a future concern may sum JSONL token
  usage into a cost, but not here.
- **A loud "budget set but no cost captured" guard.** Worth adding to the harness
  later, but it must not live in the pure `Governor`; out of scope for this change.
- **Teeing the captured JSON blob back to `process.stdout` for observability.** v0
  captures silently and relies on §3.9's external `| tee logs/iter-n.json`; whether
  `runAgent` should also echo the blob is a separate, compatible decision.
- **Defaulting `json` to `true`, or coupling it to `maxBudgetUsd`.** Opt-in only (see
  "Why these choices").
