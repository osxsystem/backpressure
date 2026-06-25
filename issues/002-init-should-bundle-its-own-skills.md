# 002 — `init` requires the *consumer* to supply `skills/`; it should bundle its own

- **Severity:** High (makes the default install unusable without copying repo internals)
- **Area:** `src/install/init.ts`, `src/install/plan.ts` (`skillsSourceDir`)
- **Found by:** consumer install (the only documented fix was `cp -R backpressure/skills ./skills`)

## Problem
`init` reads bundled skills from `<cwd>/skills/`. When equipping a real project,
that directory belongs to *this* toolkit, not the consumer's repo, so the only way
to make `init` succeed today is to copy this repo's `skills/` into the target —
backwards. A capability pack should install *its own* bundled capabilities.

## Acceptance criterion
`init` (and `planInstall`) resolve the default skills source from the installed
package location (e.g. a `skills/` dir shipped alongside `dist/`, resolved via
`import.meta.url`), falling back to `<cwd>/skills` only when explicitly overridden
via `skillsSourceDir`. A test asserts that, with no `skills/` in the target cwd and
no `skillsSourceDir` override, the default `building-adaptive-ui` skill is still
planned/written from the package's bundled location.

## Notes / fix direction
- Ensure the build copies `skills/` into the publishable output so the resolved
  path exists at runtime (tsup `publicDir` or a copy step).
- A `--skills-dir` CLI flag (currently only available via the library API) would
  also help; see USER_GUIDE "Known limitations".
- Fixes the common case behind #001.
