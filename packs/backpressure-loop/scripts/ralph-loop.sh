#!/usr/bin/env bash
# .backpressure/scripts/ralph-loop.sh — the Backpressure/Ralph loop harness,
# shipped by the /backpressure-loop pack and installed into a TARGET repo under
# .backpressure/scripts/. Brings L1–L6 together (RALPH_PRODUCTION_GUIDE §3.11.2).
#
#   >>> RUN INSIDE the §3.2 sandbox container, behind the §3.3 firewall. <<<
#   Never on your main repo or a host with production credentials. The agent runs
#   with --dangerously-skip-permissions (no approval prompts); git is your only
#   in-repo undo, and it cannot undo a leaked secret or a deleted external file.
#
# Tunable via env: MAX_ITERS, MAX_STALLS, ITER_TIMEOUT, CAMPAIGN_HOURS,
# MIN_FREE_MB, MODEL, BUDGET_USD, MAX_TURNS, GATE, ALERT_WEBHOOK.
set -euo pipefail

# --- Paging / escalation (wired to every halt branch) ---------------------------
notify() {  # $1 = message
  [ -n "${ALERT_WEBHOOK:-}" ] && curl -fsS -X POST "$ALERT_WEBHOOK" \
    -H 'content-type: application/json' -d "{\"text\":\"ralph: $1\"}" || true
}

# --- SAFETY: refuse to run anywhere but a throwaway branch ----------------------
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo none)"
case "$branch" in
  main|master|HEAD|none) echo "refusing to run on '$branch'"; exit 1 ;;
esac

# --- Required memory files (the loop reads NOTHING without these) ---------------
for f in PROMPT.md fix_plan.md; do
  [ -f "$f" ] || { echo "missing required file: $f"; exit 1; }
done

# --- Caps / config --------------------------------------------------------------
MAX_ITERS="${MAX_ITERS:-40}"
MAX_STALLS="${MAX_STALLS:-3}"
ITER_TIMEOUT="${ITER_TIMEOUT:-1800}"                       # per-iteration wall-clock secs
DEADLINE=$(( $(date +%s) + ${CAMPAIGN_HOURS:-8} * 3600 )) # campaign wall-clock
MIN_FREE_MB="${MIN_FREE_MB:-1024}"                         # disk-guard floor
MODEL="${MODEL:-opus}"
BUDGET_USD="${BUDGET_USD:-2.00}"
MAX_TURNS="${MAX_TURNS:-40}"
# The gate the /backpressure-loop pack installs. Override with GATE=... if you
# keep the gate elsewhere.
GATE="${GATE:-./.backpressure/scripts/backpressure-gate.sh}"

child=""
trap 'echo "interrupted"; notify "interrupted"; [ -n "$child" ] && kill "$child" 2>/dev/null; exit 130' INT TERM

stalls=0
for ((i = 1; i <= MAX_ITERS; i++)); do
  [ -f STOP ] && { echo "STOP file present"; notify "STOP file"; break; }
  [ "$(date +%s)" -ge "$DEADLINE" ] && { echo "campaign deadline"; notify "deadline reached"; break; }
  free_mb=$(df -Pm . | awk 'NR==2{print $4}')
  (( free_mb < MIN_FREE_MB )) && { echo "low disk (${free_mb}MB)"; notify "low disk"; break; }
  echo "=== loop $i/$MAX_ITERS ($(date -u +%FT%TZ)) ==="

  before="$(git rev-parse HEAD)"

  # --- GENERATE: one headless pass (Stop hook runs the gate INSIDE the CLI) -----
  timeout "$ITER_TIMEOUT" \
    claude -p "$(cat PROMPT.md)" \
      --dangerously-skip-permissions \
      --model "$MODEL" \
      --max-budget-usd "$BUDGET_USD" \
      --max-turns "$MAX_TURNS" \
    & child=$!; wait "$child" || echo "agent exited non-zero ($?)"
  child=""

  # --- BACKPRESSURE: re-run the gate in-harness for a deterministic verdict -----
  if ! "$GATE"; then
    echo "RED gate on loop $i"
    if git rev-parse --verify -q refs/green >/dev/null; then
      git reset --hard refs/green        # recover to last known-green (§3.10)
    else
      git reset --hard "$before"         # no green yet: undo this iteration
    fi
    stalls=$((stalls + 1))
    (( stalls >= MAX_STALLS )) && { echo "halt: $MAX_STALLS red gates"; notify "halt: $MAX_STALLS red gates — page a human"; break; }
    continue
  fi
  git update-ref refs/green HEAD         # gate is green => advance the checkpoint

  # --- STALL DETECTION: commit SHA unchanged => no progress this loop -----------
  after="$(git rev-parse HEAD)"
  if [ "$before" = "$after" ]; then
    stalls=$((stalls + 1))
    echo "no new commit (stall $stalls/$MAX_STALLS)"
    (( stalls >= MAX_STALLS )) && { echo "halt: stalled"; notify "halt: stalled — regenerate plan (§4.3.4)"; break; }
  else
    stalls=0
  fi

  # --- LOOP BACK: stop when the plan has no unchecked items left ----------------
  grep -q '^- \[ \]' fix_plan.md || { echo "plan complete"; notify "plan complete"; break; }
done
