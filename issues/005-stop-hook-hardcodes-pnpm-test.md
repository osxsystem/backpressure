# 005 — Default Stop hook hardcodes `pnpm test`, silently no-ops/errors in repos without it

- **Severity:** Medium (undercuts the core "the gate must gate" thesis)
- **Area:** `src/install/init.ts` (`DEFAULT_HOOKS`)
- **Found by:** consumer install into a plain repo (no `packageManager`, no `test` script)

## Problem
The test-gate is the whole point of "backpressure," so installing a Stop hook by
default is right — but it hardcodes `pnpm test`. In a target repo that uses npm/yarn
or has no `test` script, the gate either errors or no-ops on every Stop. A gate that
doesn't actually run in the consumer's project quietly defeats the premise.

## Repro
```bash
cd /tmp/my-app     # package.json has no "scripts.test"
node /path/to/backpressure/dist/cli.js init --target claude
# .claude/settings.json Stop hook runs `pnpm test` → no real gate in this repo
```

## Acceptance criterion
`init` chooses (or warns about) the test command appropriately. Minimum viable:
a test asserts that when the target repo's `package.json` has no `test` script,
`init` emits a warning line (e.g. `backpressure: no 'test' script found — Stop gate
will not run`). Stretch: detect the package manager (pnpm/npm/yarn lockfile) and
emit the matching `<pm> test` command; a test asserts the emitted hook command
matches the detected manager.

## Notes / fix direction
Keep the side effect (reading the target's `package.json` / lockfiles) behind the
existing injectable `InstallIo` so it stays unit-testable.
