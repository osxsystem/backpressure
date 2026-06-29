# Backpressure

A capability pack for agentic coding CLIs (Claude Code and Codex CLI). It compiles
one source of truth into each CLI's native config and installs it into a target repo.

## Language

### Install

**Skill source**:
A bundled skill directory (under a *skills source dir*) — a `SKILL.md` plus any
resources (`scripts/`, `references/`, `assets/`, …) — whose *whole tree* `init`
mirrors into a target repo. It is an *input* to the install, owned by the pack —
not a file in the target. _Avoid_: skill file, bundled skill (when precision matters).

**Install error**:
An *expected*, user-facing failure of `init` — a condition the CLI is designed to
report cleanly as a single `backpressure: …` line with no stack trace. Contrasted
with an *unexpected* error (a genuine bug), which is allowed to surface its stack.
The CLI catches install errors selectively; everything else crashes loudly.

**Missing skill source**:
The install error meaning a required *skill source* was not found under its source
dir. Source-agnostic: it states "skill X is absent under dir Y," independent of
whether a read threw or a pre-flight check found it missing.
