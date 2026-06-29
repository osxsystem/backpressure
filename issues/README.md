# Issues

Tasks distilled from a consumer-perspective trial of Backpressure: installed per
the User Guide, then `init` run against a throwaway repo that wasn't this one. Each
file is self-contained (repro + severity + acceptance criterion + code pointers).

| # | Severity | Title |
|---|----------|-------|
| [001](001-init-crashes-on-missing-skills-dir.md) | High | `init` crashes with a raw stack trace when the target repo has no `skills/` |
| [002](002-init-should-bundle-its-own-skills.md) | High | `init` requires the consumer to supply `skills/`; it should bundle its own |
| [003](003-dry-run-greenlights-a-run-that-will-crash.md) | Medium | `--dry-run` plans files the real run can't produce (false green light) |
| [004](004-tracker-mcp-registration-relative-path.md) | High | Default tracker MCP registration uses a relative path → dead in every consumer repo |
| [005](005-stop-hook-hardcodes-pnpm-test.md) | Medium | Default Stop hook hardcodes `pnpm test`, no-ops/errors in repos without it |
| [006](006-backpressure-loop-pack-assumed-source-repo.md) | High ✅ resolved | `/backpressure-loop` pack was written for the source repo, broken when installed |

## Suggested order
002 → 001 → 003 (the skills install path: bundle, then fail cleanly, then make
dry-run honest), then 004 and 005 (the two default-capability defects) in parallel.
006 is already fixed (`eaeebaf`); kept as a record of the root cause for future packs.
