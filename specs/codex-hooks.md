# Codex Stop-hook TOML shape

## What to build

The Codex adapter must emit a Stop gate in the **nested** hooks schema that Codex
CLI 0.137.0 actually loads, instead of the flat `[[hooks]]` array it emits today.

Today `emitCodexHooks` (`src/adapters/codex/hooks.ts:20-28`) maps each
`HookDefinition` to a flat row `{ event, matcher?, command }` and calls
`stringify({ hooks })`, producing a **top-level** array-of-tables:

```toml
[[hooks]]
event = "Stop"
command = "pnpm test"
```

Codex 0.137.0 does not recognize that shape. It requires the hook nested under
its event as `[[hooks.<Event>]]` whose inner `hooks` array carries entries typed
`type = "command"` (production guide §3.7.4, `docs/RALPH_PRODUCTION_GUIDE.md:927-935`;
§5.2 lines 1676-1683). The corrected emitter must produce:

```toml
[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = "pnpm test"
```

Concretely, the rewritten `emitCodexHooks` groups definitions by `event` (exactly
like the Claude adapter at `src/adapters/claude/hooks.ts:28-45`) and stringifies an
object shaped:

```ts
{ hooks: { [event]: [ { matcher?: string; hooks: [{ type: "command"; command: string }] } ] } }
```

- Definitions sharing an `event` collapse into one `hooks.<Event>` array (one entry
  per definition), mirroring the Claude grouping.
- Each inner hook entry is typed `{ type: "command", command }` — the `type` field
  is mandatory; Codex ignores untyped inner entries.
- When a definition has no `matcher`, no `matcher` key is emitted on its outer
  group; when it has one, it is preserved on the outer `[[hooks.<Event>]]` group
  (the same placement the Claude adapter uses for its matcher group). See
  "Why these choices" for the unverified-placement caveat.
- The flat `CodexHookTable` interface (`src/adapters/codex/hooks.ts:4-9`) is replaced
  by the nested type above.

The shared `HookDefinition` (`src/adapters/common/hooks.ts:13-20`) and the
`DEFAULT_HOOKS` input (`src/install/init.ts:24`,
`[{ event: "Stop", command: "pnpm test" }]`) are unchanged: this is an emitter-shape
fix, authored once and compiled per target. The installer call site
(`src/install/init.ts:227`, `emitCodexHooks(DEFAULT_HOOKS)`) is unchanged but now
writes a loadable nested gate into `.codex/config.toml`.

The sibling test `test/adapters/codex/hooks.test.ts:7-29` currently asserts the
**wrong** flat shape (it expects `parse(toml).hooks` to deep-equal an array of
`{ event, ..., command }` rows). Those assertions are removed in the same change and
replaced by the nested-shape `@acceptance` tests below — no test may continue to
assert that `parsed.hooks` is a flat array of `{ event, command }` rows.

## Acceptance criteria

1. `parse(emitCodexHooks([{ event: "Stop", command: "pnpm test" }]))` (smol-toml)
   yields an object where `Array.isArray(parsed.hooks)` is `false` and
   `Array.isArray(parsed.hooks.Stop)` is `true` — the gate is nested under its
   event, not a top-level array-of-tables.
2. For that same parse, `parsed.hooks.Stop[0].hooks[0]` deep-equals
   `{ type: "command", command: "pnpm test" }` — every inner hook entry carries
   `type = "command"`.
3. `emitCodexHooks([{ event: "Stop", command: "a" }, { event: "Stop", command: "b" }])`
   parses to a single `parsed.hooks.Stop` array of length 2 (same-event definitions
   group under one event array, parallel to the Claude grouping at
   `test/adapters/claude/hooks.test.ts:42`).
4. A definition with no `matcher` produces an outer group with no `matcher` key
   (`parsed.hooks.Stop[0]` has no `matcher` property); a definition with a `matcher`
   (e.g. `{ event: "PreToolUse", matcher: "Bash", command: "./scope-guard.sh" }`)
   preserves it as `parsed.hooks.PreToolUse[0].matcher === "Bash"`.
5. After `init("codex", dir)`, the written `.codex/config.toml` parses such that
   `parsed.hooks.Stop[0].hooks[0].command === "pnpm test"` — the installed file (not
   only the emitter) carries the loadable nested gate end-to-end.

Standing repo gate (not a per-test criterion): `pnpm test` and `pnpm run check` both
pass, and `test/adapters/codex/hooks.test.ts` contains no surviving assertion that
`parsed.hooks` is a flat array of `{ event, command }` rows (criterion 1 mechanically
fails if such an assertion remains).

## Acceptance tests

1. `@acceptance emitCodexHooks emits hooks.Stop nested, not a flat top-level hooks array`
   — asserts criterion 1 (`test/adapters/codex/hooks.test.ts`).
2. `@acceptance emitCodexHooks types every inner Stop hook as type=command`
   — asserts criterion 2 (`test/adapters/codex/hooks.test.ts`).
3. `@acceptance emitCodexHooks groups two same-event definitions under one hooks.Stop array`
   — asserts criterion 3 (`test/adapters/codex/hooks.test.ts`).
4. `@acceptance emitCodexHooks omits matcher when absent and preserves it on the outer group`
   — asserts criterion 4 (`test/adapters/codex/hooks.test.ts`).
5. `@acceptance init writes a .codex/config.toml whose nested Stop gate command is pnpm test`
   — asserts criterion 5 (`test/install/init.test.ts`).

## Files to touch

- `/Users/hugues_mini/Codes/AgentTools/backpressure/src/adapters/codex/hooks.ts`
  — rewrite `emitCodexHooks` to emit the nested shape; replace `CodexHookTable`.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/test/adapters/codex/hooks.test.ts`
  — remove the flat-shape round-trip assertions; add the `@acceptance` nested-shape
  tests (criteria 1-4).
- `/Users/hugues_mini/Codes/AgentTools/backpressure/test/install/init.test.ts`
  — add the `@acceptance` end-to-end test that parses the written
  `.codex/config.toml` (criterion 5); the existing checks at lines 83-91 only assert
  file existence.
- `/Users/hugues_mini/Codes/AgentTools/backpressure/docs/RALPH_PRODUCTION_GUIDE.md`
  — update the "what init writes" examples in §2.7 (lines 366-368) and §3.4 (lines
  665-667) from the flat shape to the corrected nested shape so the docs match the
  emitter. (§3.7.4 and §5.2 already document the nested shape and need no change.)

## Why these choices

- **The flat shape is silent failure, not a cosmetic difference.** Codex 0.137.0 does
  not parse a top-level `[[hooks]]` array; it skips it with no error. The Stop gate
  therefore never fires, so a Codex iteration can end with failing/bad code completely
  unchecked. The gate looks installed but provides **zero backpressure** — the exact
  defect flagged in the production guide §2.7, §3.4, §3.7.4, and §5.2. This spec exists
  because the bug is invisible at runtime; a future loop that "simplifies" the emitter
  back toward the flatter array would silently re-break the gate. The `@acceptance`
  test asserting `Array.isArray(parsed.hooks) === false` is the tripwire that keeps it
  nested.
- **`type = "command"` on each inner entry is load-bearing, not boilerplate.** Codex
  keys hook dispatch on the inner `type`; an untyped inner entry is ignored. Criterion 2
  pins it so it cannot be dropped as "redundant."
- **Grouping by event mirrors the Claude adapter on purpose.** Both adapters compile the
  one shared `HookDefinition` source of truth (CLAUDE.md: author once, compile per
  target). Keeping the grouping logic parallel (`src/adapters/claude/hooks.ts` groups by
  event into matcher groups) means the two emitters stay in lock-step and a reader can
  reason about both from one mental model. Criterion 3 locks the grouping so it is not
  flattened to one-table-per-definition.
- **The existing test asserted the wrong shape and must be deleted, not kept.** Leaving
  it would lock in the broken flat schema as if correct and make the bug "tested." The
  spec deliberately requires its removal in the same change so the suite's green state
  means "loadable gate," not "matches a wrong fixture."
- **End-to-end init test (criterion 5) proves the *installed file*, not just the pure
  function.** The emitter could be correct while a serialization or write step mangles
  it; reading back the on-disk `.codex/config.toml` closes that gap and is the only
  check that the real artifact Codex loads is nested.
- **Omit `timeout` for v0 (surgical).** Guide §3.7.4 line 934 shows `timeout = 600` on
  the inner hook, but the shared `HookDefinition` has no `timeout` and `DEFAULT_HOOKS`
  omits it. Adding it would ripple into `src/adapters/common/hooks.ts` and the Claude
  adapter for no v0 behavior change. v0 omits `timeout` to keep the fix confined to the
  Codex emitter and its tests; adding a configurable timeout is a separate concern.
- **Matcher placement is chosen but flagged unverified.** v0's only installed Codex hook
  is `Stop` (no matcher), so matcher placement is not load-bearing for v0. The emitter
  still has to put `matcher` *somewhere* for matchered definitions; it places it on the
  outer `[[hooks.<Event>]]` group to parallel the Claude matcher-group placement.
  Whether Codex 0.137.0 expects the matcher on the outer group versus inside
  `[[hooks.<Event>.hooks]]` is unverified against the live CLI and must be revisited
  before any matchered Codex hook (e.g. a PreToolUse scope guard) is actually installed.

## Out of scope / non-goals

- Adding a `timeout` field to `HookDefinition`, the Codex emitter, or the Claude
  emitter (deferred; see "Why these choices").
- Changing `DEFAULT_HOOKS`, the shared `HookDefinition` shape, the Claude adapter, or
  the `emitCodexHooks` call site in `src/install/init.ts:227`.
- Installing any matchered Codex hook (e.g. a PreToolUse scope guard). v0 installs only
  the `Stop` gate; the matcher path exists in the emitter but is not exercised by an
  installed hook and its placement remains unverified.
- Codex's hook-**trust** behavior and the exit-code/backpressure contract (guide §3.7.4(b)
  and the L3 exit-code note). Those are real Codex gating facts but are separate concerns
  from the TOML *shape* this spec fixes.
- Confirming the nested shape against a live `codex` 0.137.0 (`codex doctor`/load check).
  This spec relies on the guide as the cited source; smol-toml output was verified to
  match the guide byte-for-byte. A live-CLI confirmation would close the loop but is not
  required to land the shape fix.
