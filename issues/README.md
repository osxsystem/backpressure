# Issues

Tasks distilled from a consumer-perspective trial of Backpressure: installed per
the User Guide, then `init` run against a throwaway repo that wasn't this one. Each
file is self-contained (repro + severity + acceptance criterion + code pointers).

**Status snapshot:** 001–003 are fixed (skills now ship with the package); 004 is
moot in v0 (the tracker is deferred, so no MCP is registered); 005 is fixed
(`--gate` + package-manager auto-detection + a no-test-script warning); 006 is
fixed. See each file for details.

| # | Severity | Status | Title |
|---|----------|--------|-------|
| [001](001-init-crashes-on-missing-skills-dir.md) | High | ✅ resolved | `init` crashes with a raw stack trace when the target repo has no `skills/` |
| [002](002-init-should-bundle-its-own-skills.md) | High | ✅ resolved | `init` requires the consumer to supply `skills/`; it should bundle its own |
| [003](003-dry-run-greenlights-a-run-that-will-crash.md) | Medium | ✅ resolved | `--dry-run` plans files the real run can't produce (false green light) |
| [004](004-tracker-mcp-registration-relative-path.md) | High | ⏸️ moot in v0 | Default tracker MCP registration uses a relative path → dead in every consumer repo |
| [005](005-stop-hook-hardcodes-pnpm-test.md) | Medium | ✅ resolved | Default Stop hook hardcodes `pnpm test`, no-ops/errors in repos without it |
| [006](006-backpressure-loop-pack-assumed-source-repo.md) | High | ✅ resolved | `/backpressure-loop` pack was written for the source repo, broken when installed |

## Remaining open work
- **004** — revisit only if/when the tracker is wired up post-v0.
