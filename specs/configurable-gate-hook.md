# Configurable Stop-hook command (composite gate)

Concern key: `configurable-gate-hook`

## What to build

Thread an optional, target-agnostic gate command from the CLI down through the
installer into the (already-parameterized) per-target hook adapters, so a repo
can point its `Stop` hook at a composite gate script
(`./scripts/backpressure-gate.sh`) without editing source or hand-editing the
emitted config.

Today the gate command is a literal: `src/install/init.ts:24` exports
`DEFAULT_HOOKS = [{ event: "Stop", command: "pnpm test" }]`, and `buildWrites`
passes that constant straight into `emitClaudeHooks(DEFAULT_HOOKS)`
(`init.ts:206`) and `emitCodexHooks(DEFAULT_HOOKS)` (`init.ts:227`). The adapters
are *already* generic over `HookDefinition.command` — the only missing seam is a
command string the caller can supply.

End state:

1. **`InitOptions` gains `gateCommand?: string`** (default `"pnpm test"`).
   `init()` destructures `gateCommand = "pnpm test"` and forwards it to
   `buildWrites`.
2. **`buildWrites` derives the Stop gate from `gateCommand`**, not from the
   literal constant. Introduce a tiny pure helper
   `stopGateHooks(cmd: string): HookDefinition[] => [{ event: "Stop", command: cmd }]`,
   keep `export const DEFAULT_HOOKS = stopGateHooks("pnpm test")` as the exported
   default, and have both the Claude branch (`init.ts:206`) and the Codex branch
   (`init.ts:227`) consume the same derived `HookDefinition[]`
   (`stopGateHooks(gateCommand)`). The helper may live in `src/install/init.ts`
   (recommended; no new test file) or in `src/adapters/common/hooks.ts` (only if
   placed there, add `test/adapters/common/hooks.test.ts` in the same change).
3. **`src/cli.ts` `init` registers `--gate <command>`** with default
   `"pnpm test"` and a description such as "Command the Stop-hook gate runs;
   point at ./scripts/backpressure-gate.sh for the composite gate." The action
   passes `options.gate` as `gateCommand` into `init(...)`.
4. **The command stays a plain string everywhere outside the adapters.** No new
   file branches on which CLI; the existing `emitClaudeHooks` /`emitCodexHooks`
   compile the same string per target, honoring author-once / compile-per-target.
5. **Codex assertions stay shape-agnostic** (substring match on the command), so
   this concern composes with — and does not bake in — the separate
   `codex-hooks` nested-schema fix. Whatever TOML shape the Codex adapter emits,
   the same `gateCommand` flows through `HookDefinition.command` unchanged.

The recommended home is `InitOptions` (localized to content emission). It does
**not** belong on `InstallCapabilities`: `planInstall` is pure path-joining and
never reads hook contents, so a `gateCommand` field there would be dead.

## Acceptance criteria

1. Calling `init("claude", dir, { skillsSourceDir })` with **no** `gateCommand`
   emits `.claude/settings.json` whose `hooks.Stop[0].hooks[0].command` equals
   `"pnpm test"` (existing default preserved).
2. Calling `init("codex", dir, { skillsSourceDir })` with **no** `gateCommand`
   emits `.codex/config.toml` whose text contains `"pnpm test"` (existing
   default preserved).
3. Calling `init("claude", dir, { gateCommand: "./scripts/backpressure-gate.sh", skillsSourceDir })`
   emits `.claude/settings.json` whose `hooks.Stop[0].hooks[0].command` equals
   `"./scripts/backpressure-gate.sh"`.
4. Calling `init("codex", dir, { gateCommand: "./scripts/backpressure-gate.sh", skillsSourceDir })`
   emits `.codex/config.toml` whose text **contains**
   `"./scripts/backpressure-gate.sh"` (substring assertion — shape-agnostic so it
   survives the `codex-hooks` nested-schema fix).
5. `buildProgram()`'s `init` subcommand registers a `--gate` option whose
   `defaultValue` is `"pnpm test"`.
6. The exported `DEFAULT_HOOKS` still equals
   `[{ event: "Stop", command: "pnpm test" }]`, anchoring the default after the
   refactor to a derived helper.

## Acceptance tests

(1:1 with the criteria above; all `@acceptance`-tagged vitest tests.)

1. `@acceptance init('claude') with no gate keeps the Stop hook command at pnpm test`
   — in `test/install/init.test.ts`.
2. `@acceptance init('codex') with no gate keeps the Stop gate command at pnpm test`
   — in `test/install/init.test.ts`.
3. `@acceptance init('claude', { gateCommand }) points the Stop hook at the configured command`
   — in `test/install/init.test.ts`.
4. `@acceptance init('codex', { gateCommand }) points the Stop gate at the configured command (shape-agnostic)`
   — in `test/install/init.test.ts`.
5. `@acceptance init subcommand registers --gate defaulting to pnpm test`
   — in `test/cli.test.ts`.
6. `@acceptance DEFAULT_HOOKS still exports the pnpm test Stop gate`
   — in `test/install/init.test.ts`.

Sketch (init side):

```ts
it("@acceptance init('claude', { gateCommand }) points the Stop hook at the configured command", async () => {
  await init("claude", dir, { gateCommand: "./scripts/backpressure-gate.sh", skillsSourceDir });
  const s = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
  expect(s.hooks.Stop[0].hooks[0].command).toBe("./scripts/backpressure-gate.sh");
});

it("@acceptance init('codex', { gateCommand }) points the Stop gate at the configured command (shape-agnostic)", async () => {
  await init("codex", dir, { gateCommand: "./scripts/backpressure-gate.sh", skillsSourceDir });
  const toml = await readFile(join(dir, ".codex", "config.toml"), "utf8");
  expect(toml).toContain("./scripts/backpressure-gate.sh");
});
```

Sketch (cli side, mirroring the existing flag tests):

```ts
it("@acceptance init subcommand registers --gate defaulting to pnpm test", () => {
  const program = buildProgram();
  const initCmd = program.commands.find((c) => c.name() === "init");
  const gate = initCmd?.options.find((o) => o.long === "--gate");
  expect(gate).toBeDefined();
  expect(gate?.defaultValue).toBe("pnpm test");
});
```

## Files to touch

- `src/install/init.ts` — add `gateCommand?: string` to `InitOptions`; add the
  `stopGateHooks(cmd)` helper; redefine `DEFAULT_HOOKS = stopGateHooks("pnpm test")`;
  thread `gateCommand` from `init()` into `buildWrites`, and consume
  `stopGateHooks(gateCommand)` in both the Claude and Codex branches.
- `test/install/init.test.ts` — add the four init-side `@acceptance` tests
  (criteria 1–4) plus the `DEFAULT_HOOKS` guard (criterion 6).
- `src/cli.ts` — register `--gate <command>` (default `"pnpm test"`) on the
  `init` subcommand; widen the action's options type and pass `options.gate` as
  `gateCommand` into `init(...)`.
- `test/cli.test.ts` — add the `--gate` flag + default assertion (criterion 5).
- `docs/USER_GUIDE.md` — document the `--gate` flag (default `pnpm test`; point
  it at `./scripts/backpressure-gate.sh` for the composite gate).
- `src/adapters/common/hooks.ts` (+ `test/adapters/common/hooks.test.ts`) — ONLY
  if `stopGateHooks` is placed in `common/hooks.ts` instead of `init.ts`. If the
  helper stays in `init.ts`, leave these untouched (the file is type-only today
  and has no sibling test).

## Why these choices

- **The command string is the only missing seam; the adapters are already ready.**
  `emitClaudeHooks(defs)` (`src/adapters/claude/hooks.ts:28`) and
  `emitCodexHooks(defs)` (`src/adapters/codex/hooks.ts:20`) already emit whatever
  `command` each `HookDefinition` carries. The hardcoding is purely upstream: the
  literal `DEFAULT_HOOKS` and `buildWrites` passing it unconditionally. A future
  loop must NOT "simplify" by re-inlining `"pnpm test"` into `buildWrites` — that
  re-welds the seam shut and reintroduces the exact gap (a repo could no longer
  point the gate at its script without editing source). The default still lives
  in exactly one place (`stopGateHooks("pnpm test")` / `DEFAULT_HOOKS`), so the
  refactor adds a parameter, not duplication.
- **`gateCommand` lives on `InitOptions`, not `InstallCapabilities`.** It is a
  content-emission detail. `planInstall` is pure path-joining and never reads
  hook bodies, so a field on `InstallCapabilities` would be dead weight that the
  next reader would (rightly) delete. Keeping it on `InitOptions` keeps it where
  it is actually consumed.
- **It defaults to `"pnpm test"` so every existing test and install is byte-for-byte
  unchanged.** This is why criteria 1, 2, and 6 exist: they pin the default so
  the new knob can never silently change the out-of-the-box gate. The claude/codex
  hooks adapter tests must keep passing untouched.
- **The value stays a plain string until the existing per-target adapters consume
  it — no new file branches on a target name.** This is the codebase's load-bearing
  invariant ("anything that branches on which CLI lives in exactly two places:
  `src/seam/` and `src/adapters/`"). The gate command must flow through `init` and
  `buildWrites` as an opaque string; only `emitClaudeHooks` / `emitCodexHooks` know
  how to render it. A future loop must not add a per-target `if (target === …)`
  around the gate command anywhere outside the adapters.
- **The Codex acceptance assertion is a substring match on purpose.** This concern
  is sequenced with the separate `codex-hooks` nested-schema fix (§3.7.4). Asserting
  `hooks.Stop[0]...` against the Codex TOML would bake in the currently-broken flat
  `[[hooks]]` shape and break when `codex-hooks` lands. A substring match on the
  command keeps the two concerns decoupled: the same `gateCommand` flows into
  whatever shape Codex emits, because both adapters consume `HookDefinition.command`.
- **Why a named `stopGateHooks(cmd)` helper rather than an inline literal in
  `buildWrites`.** It gives the default exactly one definition, keeps `DEFAULT_HOOKS`
  meaningful for the guard test (criterion 6), and makes the Claude and Codex
  branches provably consume the *same* derived definition rather than two
  hand-copied literals that could drift.

## Out of scope / non-goals

- **Authoring or installing `./scripts/backpressure-gate.sh` itself.** Writing the
  composite gate script is the operator's job (per RALPH_PRODUCTION_GUIDE §3.7.2);
  this concern only lets the installed hook *point* at it. The default stays
  `pnpm test` regardless.
- **The Codex flat-vs-nested TOML hook schema** (`[[hooks.Stop]]` /
  `[[hooks.Stop.hooks]]`). That is the separate `codex-hooks` concern. This change
  must compose with it (shape-agnostic Codex assertion), not fix it.
- **Validation / normalization of the gate command** (rejecting empty or
  whitespace strings). v0 trusts the operator and lets commander's default fill
  the absent case; add validation only if a later concern calls for it.
- **Any `InstallCapabilities` / `planInstall` change.** Plan stays pure
  path-joining; it does not gain a `gateCommand` field.
- **A `--global` interaction.** `--global` installs skills only (`skillsOnly`), so
  no hook file is written and `--gate` is simply inert there; no special-casing
  is required.
