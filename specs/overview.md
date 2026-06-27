# Campaign overview — v0→v1 CLI hardening

This `specs/` directory is the **blueprint** for an unattended Backpressure/Ralph
loop. Each loop is a fresh context window with amnesia; these files (plus
`fix_plan.md`, `PROMPT.md`, `CLAUDE.md`) are its entire memory. Read this file
first to get your bearings, then `fix_plan.md` for the one item to do.

## Goal

Close the five v0 code gaps the production guide documents (§2.7, §4.5), turning
Backpressure's own CLI from "shipped but with known holes" into a hardened v1.
**This campaign touches `src/` features only** — not the container/firewall/CI
operational assets (those are a separate effort).

## The five concerns (one spec each)

| Spec | Concern | One-line gap |
| --- | --- | --- |
| [`codex-hooks.md`](codex-hooks.md) | Codex Stop-hook TOML shape | adapter emits a flat `[[hooks]]` array Codex 0.137.0 ignores → the Codex gate never loads |
| [`configurable-gate-hook.md`](configurable-gate-hook.md) | Configurable Stop-hook command | the Stop hook is hardcoded to `pnpm test`; can't point it at `./scripts/backpressure-gate.sh` without hand-editing |
| [`build-command.md`](build-command.md) | `backpressure build` (real) | `build` is a `not yet implemented` stub; make it a read-only "compile per target" preview |
| [`index-command.md`](index-command.md) | `backpressure index` (real) | `index` is a stub; make it a read-only installed-capability inventory |
| [`governor-cost.md`](governor-cost.md) | Feed real cost into the Governor | the `maxBudgetUsd` cap exists but nothing feeds real spend into `decide()` |

Ordering and dependencies live in `fix_plan.md`. The load-bearing one:
**`codex-hooks` lands before `configurable-gate-hook`**, and the three
`src/cli.ts` editors (`configurable-gate-hook`'s `--gate`, `build`, `index`) land
**sequentially, never interleaved**.

## Invariants every loop must preserve (do not regress these)

1. **Author once, compile per target.** Anything that branches on *which CLI*
   lives only in `src/seam/` and `src/adapters/` (and the shared
   `planInstall`/`compileArtifacts` path). No new `target ===` branch anywhere
   else. (`CLAUDE.md` "the one rule".)
2. **Every `src/` file ships with its sibling `test/` file in the same change.**
3. **The gate is the only done-signal.** `./scripts/backpressure-gate.sh` must be
   green before you tick a box. Each item's `@acceptance` tests land *with* its
   implementation — never author a failing acceptance test for a future item (it
   would redden the gate and deadlock the one-thing-per-loop rule).
4. **No new runtime dependencies** without a reason tied to the change; prefer
   zod, commander, smol-toml, `@modelcontextprotocol/sdk` (already present).
5. **Defaults stay byte-identical.** Existing installs/tests must not change
   behavior unless a spec explicitly says so (e.g. the Stop-hook default stays
   `pnpm test`).

## Acceptance discipline

Every spec has a numbered **Acceptance criteria** list and a 1:1 **Acceptance
tests** list (tagged `@acceptance`). The gate's positive stage runs
`pnpm run test:acceptance` (`vitest run -t @acceptance`). When you implement a
fix_plan item, write that item's `@acceptance` test(s) in the same change so the
suite grows green, item by item.

## Why these choices

Captured so a future amnesiac loop can't undo the intent:

- The campaign is scoped to **code**, deliberately excluding the ops/infra assets,
  so the loop converges on a reviewable set of `src/` PRs rather than wandering
  into Docker/CI work that needs a human and a host.
- Each concern is its own spec + its own fix_plan items so a single loop lands
  exactly one shippable change and the gate stays green between items.
- The hard ordering (codex-hooks → configurable-gate-hook; serialized `cli.ts`
  edits) exists because two concerns refactor the same `init.ts` region and three
  touch `src/cli.ts`; interleaving them would cause merge collisions a fresh-context
  loop can't reason about.
