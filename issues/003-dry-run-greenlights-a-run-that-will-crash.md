# 003 — `--dry-run` plans files the real run can't produce (false green light)

- **Severity:** Medium (erodes trust in the safest-looking command)
- **Area:** `src/install/plan.ts` (`planInstall`), `src/install/init.ts`
- **Found by:** consumer dry-run vs real run on the same repo
- **Status:** ✅ **RESOLVED** — the common path no longer crashes (see #002), and the
  pre-install verify gate (`verifySkills`) runs for `--dry-run` too, so dry-run and
  the real run agree on success/failure. See USER_GUIDE "Pre-install verify gate".

## Problem
`init --target claude --dry-run` happily prints
`Planned: .../skills/building-adaptive-ui/SKILL.md`, but the real run then crashes
because the skill source doesn't exist (see #001). The dry run is supposed to be
the "look before you leap" command; here it green-lights a run that immediately
fails.

## Repro
```bash
cd /tmp/my-app   # no skills/ dir
node /path/to/backpressure/dist/cli.js init --target claude --dry-run   # "Planned: ...SKILL.md"
node /path/to/backpressure/dist/cli.js init --target claude             # ENOENT crash
```

## Acceptance criterion
A test asserts that when a planned skill source is missing, `--dry-run` reports the
same failure the real run would (typed error / non-zero exit), so dry-run and real
run agree on success vs failure for identical inputs.

## Notes / fix direction
Have the planning/validation step stat each skill source (behind the injectable
`SkillsIo`/`InstallIo`) so dry-run verifies sources exist rather than assuming them.
Best fixed together with #002 — once skills resolve from the package, the common
path stops failing, but dry-run should still validate any `skillsSourceDir` override.
