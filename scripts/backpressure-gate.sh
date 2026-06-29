#!/usr/bin/env bash
# scripts/backpressure-gate.sh — the composite backpressure gate. ONE exit code.
# Fail-fast: the first red stage stops the loop. This is L3 from
# docs/RALPH_PRODUCTION_GUIDE.md §3.7. It is wired as the Stop hook AND re-run by
# the harness (scripts/ralph-loop.sh) and by CI, so local and CI never drift.
#
# TUNE PER PROJECT. The stages below assume a TypeScript/Node project
# (biome + tsc + jscpd + vitest + gitleaks). For a Rust loop, swap stages 1–5 for
# `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `cargo build` —
# the honest compiler is your strongest backpressure (§1.5). Keep the SHAPE:
# fail-fast, one exit code, flock-wrapped build, a positive acceptance stage.
# The loop image (§3.2.2) is where jscpd/gitleaks/flock get installed.
set -euo pipefail

echo "== 1. format + lint (biome) =="
pnpm exec biome check .

echo "== 2. typecheck =="
pnpm exec tsc --noEmit

echo "== 3. stub / placeholder guard (§5.1) =="
# Scope to changed PROJECT SOURCE only (src/*.ts). Docs/specs/PROMPT.md and the
# bundled skills/ scaffolds legitimately contain TODO / "is not implemented"
# prose (e.g. the verbatim Ralph directive in PROMPT.md), so scanning them would
# fail the gate on intent, not on stub code. The build/index stubs print "not
# yet implemented" — the `\bnot implemented\b` pattern deliberately does NOT
# match that (the "yet" breaks it); the loop removes those stubs as it lands the
# build/index items.
#
# Carve-out: annotated forward-references of the form `TODO(phase-N)` are working
# code with a tracked future-phase note (e.g. the phase-2 safe-join hardening in
# src/add/), NOT stub code. They are filtered out so the guard fails on intent,
# not on deliberate roadmap markers. A bare `TODO` still fails.
if git rev-parse --verify -q main >/dev/null; then
  changed="$(git diff --name-only --diff-filter=d main... -- src | grep -E '\.ts$' || true)"
  if [ -n "$changed" ]; then
    hits="$(printf '%s\n' "$changed" | xargs -r grep -nE 'TODO|FIXME|unimplemented!|\bnot implemented\b' | grep -vE 'TODO\(phase-[0-9]+\)' || true)"
    if [ -n "$hits" ]; then
      printf '%s\n' "$hits"
      echo "gate: placeholder/stub code in changed src/"; exit 1
    fi
  fi
fi

echo "== 4. duplicate-symbol guard (§5.1) =="
# A small budget, NOT zero-tolerance: src/ already carries ~2% legitimate minor
# duplication, so --threshold 0 would be deterministically RED before the loop
# does anything. The budget still trips on gross copy-paste (the failure mode
# this guards). jscpd is the v5 native build (pinned in Dockerfile.ralph).
pnpm exec jscpd --min-tokens 50 --threshold 3 --silent src/ \
  || { echo "gate: duplicate code over budget (3%)"; exit 1; }

echo "== 5. build + tests — EXACTLY ONE at a time (flock mutex, §3.7.1) =="
# -w 600 (wait up to 10 min) not -n: the gate runs BOTH as the Claude Stop hook
# and again in-harness (ralph-loop.sh), so a non-blocking lock would make the
# second caller a false RED ("busy"). Waiting serializes them instead.
flock -w 600 /tmp/ralph-build.lock -c 'pnpm test && pnpm run build' \
  || { echo "gate: build/test failed (or lock wait timed out)"; exit 1; }

echo "== 6. spec-level acceptance — the only POSITIVE done signal (§4.3.5) =="
pnpm run test:acceptance          # vitest run -t @acceptance (wire this in package.json)

echo "== 7. secret scan (secrets = backpressure, §4.1.5) =="
gitleaks detect --no-banner --redact

echo "== 8. dependency guard (§4.1.6) — no unreviewed new deps =="
git diff --quiet -- pnpm-lock.yaml \
  || { echo "gate: pnpm-lock.yaml changed — new deps need review"; exit 1; }
# NOTE: `pnpm audit` (CVE scan) intentionally runs in CI (L7, §3.13), NOT here.
# It needs live network egress every iteration, and a freshly-published advisory
# would flip this per-iteration gate RED with no code change — the harness would
# then `git reset --hard` and discard good work. Keep the inner gate hermetic;
# audit dependencies at the merge gate where a human is present.

echo "gate: GREEN"
