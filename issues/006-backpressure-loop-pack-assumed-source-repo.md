# 006 — `/backpressure-loop` pack was written for the source repo, broken when installed

- **Severity:** High (the shipped launcher was non-functional in any repo that installed it)
- **Status:** ✅ **RESOLVED** in `eaeebaf` — verified by an independent second-session regression run.
- **Area:** `packs/backpressure-loop/` (`commands/backpressure-loop.md`, `scripts/`, `backpressure.json`); install layout in `src/add/pack.ts`
- **Found by:** installing the pack into a throwaway repo, then a fresh-session run of `/backpressure-loop` that had to hand-fix paths to proceed

## Root cause
The `/backpressure-loop` command was authored as if it always runs **inside the
Backpressure source repo**, where `scripts/backpressure-gate.sh` and
`scripts/ralph-loop.sh` exist and `backpressure init` wires the dev loop. But the
command is *shipped in a pack and installed into other repos*, where the installer
places scripts under **`.backpressure/scripts/`** and the pack — not `init` — wires
the Stop hook. The command and the installer disagreed about where things live.
The command text even said, verbatim, *"The gate and harness already exist in this
repo (`scripts/...`)"* — false in any consumer repo.

## Symptoms (two layered defects)
1. **Path mismatch.** Phase 2/3 referenced bare `scripts/backpressure-gate.sh` and
   `scripts/ralph-loop.sh`. The installer writes them to `.backpressure/scripts/`,
   so an agent following the command verbatim would `chmod`/repoint nonexistent
   paths and **break the gate the install had just wired correctly**.
2. **Missing harness.** The pack shipped only `backpressure-gate.sh`. The
   `ralph-loop.sh` the command hands off to (Phase 2 `chmod`, Phase 3 docker line)
   **did not exist** in any repo that installed the pack.

Secondary: the command hard-referenced `docs/RALPH_PRODUCTION_GUIDE.md` (not
shipped to target repos) and told the agent to run `backpressure init` (which would
overwrite the pack-wired Stop hook with the default `pnpm test` hook).

## Repro (before the fix)
```bash
cd /tmp/fresh-repo
node /path/to/backpressure/dist/cli.js init --from packs/backpressure-loop --target claude
ls scripts/ralph-loop.sh            # ENOENT — never installed
grep 'scripts/ralph-loop.sh' .claude/commands/backpressure-loop.md   # bare path, wrong location
```

## Resolution (what `eaeebaf` did)
- Ship `scripts/ralph-loop.sh` in the pack (added to manifest `scripts[]`), with its
  `GATE` defaulting to `./.backpressure/scripts/backpressure-gate.sh` — script
  bodies are copied verbatim (only hook commands are rewritten on install), so the
  harness must reference the installed path itself.
- Rewrite the command for the installed-pack context: `.backpressure/scripts/`
  everywhere; make the `RALPH_PRODUCTION_GUIDE.md` reference optional; stop telling
  the agent to run `backpressure init` (verify the pack-wired hook instead).
- Bump the pack to `0.2.0`.

## Acceptance criterion (now enforced)
`test/add/backpressure-loop-pack.test.ts` asserts, after a real `installPack`:
the harness installs under `.backpressure/scripts/`, is executable, and its body
points at the installed gate path; and the installed command references
`.backpressure/scripts/...` with **no** bare `scripts/{ralph-loop,backpressure-gate}.sh`
paths left.

## Lesson for future packs
**Anything a pack ships must be written for the *installed* layout, not the source
tree.** A pack item's prose/paths can't assume the source repo's directory
structure — scripts land under `.backpressure/scripts/`, the pack (not `init`)
wires hooks, and source-repo-only files (e.g. `docs/`) aren't present. Test every
pack by installing it into a throwaway repo and exercising it there, never by
reading it in place.
