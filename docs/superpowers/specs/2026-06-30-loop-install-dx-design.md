# Loop install DX — `init --with-loop` + stack-aware gate

- **Status:** draft (awaiting user review)
- **Date:** 2026-06-30
- **Source:** developer dogfooding trial (scored 7/10). PR #8 shipped three of the
  trial's friction fixes (`skills list`, a loud gate-tuning banner, a worktree-deps
  step). This spec covers the two **deferred** follow-ups the trial asked for:
  a one-step loop install, and a gate that is tuned to the project's stack instead
  of hand-edited.

## Context & motivation

Two distinct friction points from the trial:

1. **Two-step install is invisible.** Getting the autonomous loop requires
   `backpressure init` *and then* `backpressure add osxsystem/backpressure/packs/backpressure-loop`.
   A developer doesn't discover the second step on their own.
2. **The composite gate must be hand-tuned.** The loop pack ships a *static*
   `backpressure-gate.sh` hardcoded to `pnpm + biome + tsc + jscpd + vitest`. In an
   npm+jest repo (or a Rust crate) it fails with confusing "command not found" /
   wrong-runner errors until the developer edits it.

These are two independent features bundled into one "loop install DX" spec because
they ship together and share the install path.

### What we learned from topology (`AgentTools/topology/`)

We analyzed topology's `gatekeeper` to reuse a stack-aware gate. **Key finding: it
isn't one.** topology's gate is *language-agnostic* — it stores a single manual
`test_command` string and has **no language detection at all**. So there is no
turnkey gate to lift. Three pieces are worth stealing:

- **Test-pass recognition regex** (`gatekeeper/src/main.rs:2062,2075`): cargo
  `^test result: \w+\. (\d+) passed`, pytest `(\d+) passed[^\n]* in [0-9.]+s`,
  first-match-wins. (Only Rust/Python; no jest/vitest.) — *deferred; see Non-goals.*
- **The fail-closed philosophy** (`instincts/gates-not-rules.md`): "a rule you can
  silently skip is not a rule." An unknown stack must **not** silently pass.
- **The override model** (config-file per-stage commands) — *deferred; see Non-goals.*

The **stack detection + per-language command tables are net-new** in backpressure;
that is the actual feature.

## Glossary (for readers outside the Ralph/backpressure context)

- **Backpressure** — a capability pack the `backpressure` CLI installs *into* an
  agentic coding CLI (Claude Code / Codex). It is not a runtime.
- **Ralph loop** — an unattended "generate → gate → advance-or-rewind" coding loop
  (`scripts/ralph-loop.sh`) that runs in a sandbox; each iteration is amnesiac.
- **The (composite) gate** — `backpressure-gate.sh`: one fail-fast pipeline
  (format → lint → typecheck → test → build → acceptance → secret scan) with **one
  exit code**. It is the loop's only "done" signal.
- **Loop pack** — the bundled `packs/backpressure-loop/` capability pack: the
  `/backpressure-loop` slash command + `ralph-loop.sh` + the gate, installed under
  `.backpressure/` with a `Stop` hook wired to the gate.
- **Stop hook** — a Claude Code hook (in `.claude/settings.json`) that runs after
  each turn; backpressure wires it to the gate.
- **Fail-closed** — when the tool can't be sure a check passed (e.g. unknown stack),
  it must surface/err, never silently pass.

## Decision log

| # | Decision | Rationale |
| --- | --- | --- |
| A | With `--with-loop`, the **gate is the sole `Stop` hook**; `init` emits no `<pm> test` hook. | The gate is a superset of `<pm> test`; double-hooking is redundant. settings.json is **overwrite, not merge**, so omission (not merge) gives deterministic precedence. |
| B | Emit a **plain editable bash gate**; no config-file override model / test-count floor. | YAGNI for v1 — the script *is* the config. topology's regex/override model recorded for later. |
| C | Detect **Rust + Node/TS only**; everything else → `unknown` + banner. | Covers the reported friction; bounded scope. Python deferred. |
| D | Tuned gate generated **auto at install + a `backpressure gate` regen command**. | Zero-friction out of the box, recoverable after stack changes. |

## Goals

- `backpressure init --with-loop` installs the default capabilities **and** the
  loop pack in one network-free step (the loop pack already ships bundled in the
  npm package under `packs/backpressure-loop/`).
- The composite gate written during that install is **tuned to the detected stack**
  (Rust or Node/TS), so it runs out-of-the-box. Unknown stacks fall back to today's
  generic script **with the loud tune-me banner** (fail-closed).
- A `backpressure gate` command **regenerates** the tuned gate on demand.

## Non-goals (deferred / out of scope)

- **Config-file override model** + `require_test_count` test-count floor (topology's
  model). v1 emits a **plain editable bash script** — the script *is* the config.
  The regex patterns are recorded here for if/when we add a floor later.
- **Python / other languages.** v1 detects **Rust and Node/TS only**; everything
  else is `unknown` → generic template + banner.
- **`--with-loop` for codex.** The loop pack targets `claude` only; `--with-loop`
  with `--target codex` is a clean error.
- No new runtime dependencies. No new `target ===` branch outside `seam/`+`adapters/`.

## Invariants preserved

- **Author once, compile per target.** Stack detection branches on *language
  toolchain*, **not** on which CLI — so it does not live in `seam/`/`adapters/` and
  does not violate the one-seam rule.
- **Every `src/` file ships its sibling `test/` file in the same change.**
- **The gate is the done-signal** — `./scripts/backpressure-gate.sh` green before any box ticked.

---

## Feature 1 — `init --with-loop`

### Behavior

`backpressure init --with-loop [--target claude]`:

1. Runs the normal default install (reviewer agent, bundled skills) but **does not
   emit its own `Stop → <pm> test` hook** (decision A — see below).
2. Installs the **bundled** loop pack by calling the existing network-free
   `installPack()` pointed at `bundledPacksDir()/backpressure-loop` (a new
   `bundledPacksDir()` helper mirrors the existing `bundledSkillsDir()`). This
   writes `/backpressure-loop`, `ralph-loop.sh`, the gate script, and the loop
   pack's own `Stop → ./.backpressure/scripts/backpressure-gate.sh` hook.
3. Runs `writeTunedGate()` (Feature 2) to overwrite the just-installed gate with a
   stack-tuned one.

**Result:** exactly **one** `Stop` hook in `.claude/settings.json` — the composite
gate (a superset of `<pm> test`) — and a gate tuned to the project.

#### Decision A, re-scoped to the actual write model (overwrite, not merge)

`.claude/settings.json` is produced by a **whole-file overwrite**: both `init`
(`src/install/init.ts` → `emitClaudeHooks`) and the loop-pack install
(`src/add/pack.ts` → `emitClaudeHooks`) serialize a *fresh* `{ hooks: … }` object
and `writeText` it — **neither reads and merges an existing file**. The last writer
wins and replaces the whole file.

Two consequences this design relies on:

- **Decision A is implemented by omission, not merging.** When `--with-loop` is set,
  `init` simply **does not emit a `Stop` hook of its own**; the loop pack's
  settings.json (the gate hook) is the *sole* writer. There is no merge order to get
  wrong. (We do **not** depend on "the pack runs last and overwrites init" — `init`
  emits no competing hook at all.)
- **Overwrite clobbers pre-existing user hooks.** Because settings.json is replaced
  wholesale, any hooks a user had hand-added to `.claude/settings.json` are lost on
  `init`/`add` today — this is **pre-existing behavior**, not introduced here, but
  `--with-loop` inherits it. Tracked in [Idempotency & back-compat](#idempotency--back-compat).

### Constraints & errors

- `--with-loop --target codex` → `InstallError`: the loop pack supports `claude`
  only (surfaced as one clean `backpressure:` line, exit 1). Reuses the existing
  `installPack` target-mismatch error.
- `--with-loop --global` → error (the loop pack writes project-level scripts/hooks,
  incompatible with a skills-only global install).
- Stop-hook precedence is deterministic by construction: with `--with-loop`, `init`
  emits no `Stop` hook, so the loop pack's gate hook is the only one written. The
  final `settings.json` contains the gate hook and **not** `<pm> test`.

---

## Feature 2 — stack-aware gate

### `detectStack(repoDir, io) → StackProfile`

```
type StackKind = "rust" | "node" | "unknown";

interface StackProfile {
  kind: StackKind;
  // node-only:
  pm?: "pnpm" | "npm" | "yarn" | "bun"; // reuse + extend detectPackageManager()
  testRunner?: "vitest" | "jest" | "node";
  hasTsconfig?: boolean;
  hasBuildScript?: boolean;
  linter?: "biome" | "eslint" | "none";
}
```

Detection rules (first match wins, read via the injectable IO seam):

1. `Cargo.toml` present → `{ kind: "rust" }`.
2. else `package.json` present →
   `{ kind: "node", pm: detectPackageManager(), testRunner, hasTsconfig, hasBuildScript, linter }`:
   - `pm`: reuse `detectPackageManager()`, **extended to recognize `bun`** — add
     `bun.lockb` (and `bun.lock`) to its `LOCKFILES` table (`pnpm-lock.yaml`→pnpm,
     `yarn.lock`→yarn, `package-lock.json`→npm, `bun.lockb`/`bun.lock`→bun). The
     `packageManager` field (corepack) may also declare `bun@…`.
   - `testRunner`: `vitest`/`jest` if present in `devDependencies` or the `test`
     script names it; else `node` (for `node --test`).
   - `hasTsconfig`: `tsconfig.json` exists.
   - `hasBuildScript`: `scripts.build` present in `package.json`.
   - `linter`: `biome` if in devDeps; else `eslint` if in devDeps; else `none`.
3. else → `{ kind: "unknown" }`.

### `emitGate(profile) → string` (pure)

Assembles a bash script from stage snippets. **Shape is invariant across profiles**
(stolen from the existing gate): `set -euo pipefail`, fail-fast, ONE exit code, a
secret scan, and `echo "gate: GREEN"` at the end.

**Shared stages (all profiles):** stub/placeholder guard, jscpd duplicate guard,
gitleaks secret scan. (Language-agnostic — operate on source/diff, not toolchain.)

**Per-language command tables:**

| Stage | Rust | Node/TS |
| --- | --- | --- |
| format | `cargo fmt --check` | `biome check .` / `eslint .` / *(skip if `none`)* |
| typecheck | *(part of build)* | `tsc --noEmit` *(only if `hasTsconfig`)* |
| test | `cargo test` | `<pm> test` *(or `<pm> exec <runner>`)* |
| build | `cargo build` | `<pm> run build` *(only if `hasBuildScript`)* |
| acceptance | `cargo test -- --include-ignored @acceptance`† | `<pm> run test:acceptance` *(only if present)* |
| deps guard | `Cargo.lock` changed → review | `<lockfile>` changed → review |

† acceptance stage is best-effort; emitted commented-with-a-note when no convention
is detected, so the gate never blocks on a stage the project hasn't wired yet.

**`unknown` profile:** emits today's static `pnpm/biome/vitest` content **verbatim**,
prefixed with the loud TUNE-ME banner. Fail-closed: it will error on missing tools
rather than pass, and the banner tells the developer to tune or run `backpressure gate`.

> **Single source of truth (plan decision):** prefer generating the bundled
> `packs/backpressure-loop/scripts/backpressure-gate.sh` from `emitGate("unknown")`
> at build time (with a "generated — run `backpressure gate` to retune" header) so
> the static fallback can't drift from the emitter.

### `writeTunedGate(repoDir, io) → path`

`detectStack` → `emitGate` → write `.backpressure/scripts/backpressure-gate.sh`
(preserving the executable bit). Shared by:

- `init --with-loop` (after the loop pack install),
- `add` **when the installed pack wrote a `.backpressure/scripts/backpressure-gate.sh`**
  (so the documented `add …/backpressure-loop` one-liner also gets a tuned gate),
- the new `backpressure gate` command.

### `backpressure gate` command

`backpressure gate` (re)generates the tuned gate for the current repo: runs
`writeTunedGate(cwd())`, prints the detected stack and the written path, exit 0.
Clean `backpressure:` error if no `.backpressure/` exists yet (i.e. the loop pack
isn't installed) — pointing the user at `init --with-loop`.

---

## Architecture & file layout

**New modules** (+ sibling tests in the same change):

| File | Responsibility |
| --- | --- |
| `src/install/stack.ts` | `detectStack(repoDir, io)` + `StackProfile` type (pure but for the IO seam). |
| `src/install/gate.ts` | `emitGate(profile)` (pure) + the per-language command tables + `writeTunedGate(repoDir, io)`. |

**Modified:**

| File | Change |
| --- | --- |
| `src/install/init.ts` | add `withLoop?: boolean` to `InitOptions`; `bundledPacksDir()` helper; suppress default Stop hook + install bundled loop pack + `writeTunedGate` when `withLoop`. |
| `src/cli.ts` | `--with-loop` flag on `init`; new `gate` command; call `writeTunedGate` after an `add` that wrote a gate script. |
| `docs/USER_GUIDE.md` | document `--with-loop`, the `gate` command, and stack-aware behavior. |
| `packs/backpressure-loop/commands/backpressure-loop.md` | soften Phase 2 "tune the gate" → "verify the **auto-tuned** gate". |

Reuses existing pieces: `installPack` (network-free local pack install),
`detectPackageManager`, `cliErrorLine`/`InstallError`, the `SkillsIo`/`InstallIo` seams.

## Data flow (`init --with-loop`)

```
cli init --with-loop
  → init({ withLoop: true })
      → compile/write defaults  (NO default Stop hook)
      → installPack(bundledPacksDir()/backpressure-loop)  → /backpressure-loop, scripts, gate Stop hook
      → writeTunedGate(repoDir)
            → detectStack(repoDir)  →  profile
            → emitGate(profile)     →  bash string
            → write .backpressure/scripts/backpressure-gate.sh (chmod +x)
  → prints Wrote: lines + detected stack
```

## Error handling

- All expected failures are `InstallError` subclasses → one `backpressure:` line, exit 1, no stack trace (existing `cliErrorLine` wrapper).
- `--with-loop --target codex` / `--global`: clean errors (above).
- `backpressure gate` with no `.backpressure/`: clean error pointing at `init --with-loop`.
- Unknown stack: **not** an error — emits the generic gate + banner (fail-closed at *run* time, not install time).

## Idempotency & back-compat

Re-running install/regen is a first-class case (the loop itself is amnesiac and
developers will re-run freely).

- **Re-run is deterministic.** `init --with-loop` and `backpressure gate` are
  idempotent for a fixed stack: `emitGate(profile)` is pure, so re-running rewrites
  byte-identical content. Running twice changes nothing (modulo a fresh mtime).
- **Provenance header + hand-edit protection.** The emitted gate begins with a
  sentinel header — `# @generated by backpressure gate — edits are overwritten;
  re-run 'backpressure gate' to retune`. `writeTunedGate` overwrites a gate that
  carries this header freely. If the target gate is **missing the header**
  (hand-authored or hand-edited), it **refuses and warns** (clean `backpressure:`
  line) rather than clobbering the developer's work; `backpressure gate --force`
  overrides. The install-time auto-tune (`--with-loop`/`add`) only ever retunes the
  gate it *just* wrote from the bundled pack, so it never destroys prior hand edits.
- **The pre-#8 `add` route.** Repos that installed the loop pack before this feature
  (or via the bare-repo path fixed in PR #7/#8) carry the **static** gate. Those are
  fully supported: `backpressure gate` detects the stack and retunes the existing
  `.backpressure/scripts/backpressure-gate.sh` in place. No re-`add` required.
- **`settings.json` overwrite is inherited, not introduced.** `init`/`add` already
  overwrite `.claude/settings.json` wholesale (see Decision A). `--with-loop` does
  not change that; a true read-merge of user-authored hooks is **out of scope here**
  and noted as a separate future improvement.
- **`backpressure gate` without `.backpressure/`** (loop pack not installed) → clean
  error pointing at `init --with-loop`. Never scaffolds a half-install.

## Testing strategy

- `test/install/stack.test.ts` (`@acceptance`): rust (Cargo.toml), node+vitest,
  node+jest, node+npm-vs-pnpm, no-tsconfig, unknown. Fake IO.
- `test/install/gate.test.ts` (`@acceptance`): `emitGate(rust)` contains the cargo
  commands; `emitGate(node, jest)` uses `jest` + the right `<pm>`; `emitGate(node)`
  drops typecheck when no tsconfig; `emitGate(unknown)` = generic + banner; **every**
  profile keeps the shape (`set -euo pipefail`, single exit code, secret scan,
  `gate: GREEN`); output is deterministic.
- `test/install/init.test.ts`: `init({ withLoop: true })` writes the loop pack files
  and the **gate** Stop hook (not `<pm> test`); `--with-loop --target codex` errors.
- `test/cli.test.ts`: `--with-loop` flag registered on `init`; `gate` command
  registered and emits a gate (not a stub); `gate` with no `.backpressure/` →
  clean error.
- `test/install/gate.test.ts` (idempotency & protection): `writeTunedGate` run
  twice yields byte-identical output; refuses a header-less (hand-edited) gate and
  succeeds with `--force`; the emitted gate carries the `@generated` provenance
  header.
- The composite gate (`./scripts/backpressure-gate.sh`) must be green.

## Risks / open questions for the plan

- **Stop-hook via omission** (not merge): `init --with-loop` must emit no `Stop`
  hook so the pack's gate hook is the only one in the overwritten `settings.json`.
  Pin with an `@acceptance` test asserting exactly one hook = the gate.
- **Generating the bundled fallback** from `emitGate("unknown")` vs. keeping the
  hand-written static script (drift risk) — recommend generating.
- **Node linter fallback** when neither biome nor eslint is present (`linter: "none"`)
  — emit the format stage as a skip-with-note, never a hard failure.
