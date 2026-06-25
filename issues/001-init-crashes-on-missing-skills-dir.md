# 001 — `init` crashes with a raw stack trace when the target repo has no `skills/`

- **Severity:** High (first command a new user runs; fails ugly)
- **Area:** `src/install/init.ts` (`buildWrites`), `src/cli.ts`
- **Found by:** consumer dry-run (equipping a repo that isn't this one)

## Problem
The Quickstart says to run `init` "from the repo you want to equip." A normal
target repo has no `skills/` directory, so the very first command crashes with an
unhandled Node exception instead of a friendly CLI error:

```
$ backpressure init --target claude
node:internal/fs/promises:639
Error: ENOENT: no such file or directory, open '.../my-app/skills/building-adaptive-ui/SKILL.md'
    at async open (node:internal/fs/promises:639:25)
    at async buildWrites (.../dist/cli.js:159:22)
    ...
exit 1
```

Two coupled defects:
1. The error is an uncaught `ENOENT` with a Node-internals stack trace, not a
   message like `backpressure: skill 'building-adaptive-ui' not found in ./skills`.
2. The requirement (target repo must already contain a `skills/` source dir) is
   only mentioned in a doc note, never enforced or surfaced at the failure point.

## Repro
```bash
mkdir /tmp/my-app && cd /tmp/my-app && git init -q
node /path/to/backpressure/dist/cli.js init --target claude   # crashes
```

## Acceptance criterion
A new test in `test/install/` (mirroring `init`'s existing tests, with an injected
`InstallIo` whose skill read throws `ENOENT`) asserts that `init` rejects with a
typed error carrying the missing skill name and source dir — **not** a raw fs
error — and that the CLI action catches it and exits non-zero after printing a
single `backpressure: ...` line with no stack trace.

## Notes / fix direction
Relates to #002 (init should bundle its own skills so this path rarely triggers)
and #003 (`--dry-run` should fail the same way the real run would).
