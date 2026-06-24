#!/usr/bin/env bash
# Backpressure bootstrap loop.
# Runs Claude Code one task at a time, fresh context each iteration.
#
#   >>> RUN THIS IN A CONTAINER OR A THROWAWAY GIT WORKTREE. <<<
#   Never on your main repo or a machine with production credentials.
#   --dangerously-skip-permissions lets the agent run shell commands with no
#   human approval. git is your only undo button.
#
# Usage:
#   chmod +x ralph.sh
#   ./ralph.sh                 # drive Claude Code (default)
#   AGENT=codex ./ralph.sh     # drive Codex instead
#   MAX_ITERS=2 ./ralph.sh     # attended dry run: watch 2 iterations
#   BUDGET_USD=2.00 ./ralph.sh # add a per-iteration spend cap (Claude only)
#   TEST_CMD="pnpm test" ./ralph.sh

set -uo pipefail

AGENT="${AGENT:-claude}"          # which CLI to command: claude | codex
MAX_ITERS="${MAX_ITERS:-25}"      # hard ceiling on iterations
MAX_STALLS="${MAX_STALLS:-3}"     # stop after N iterations with no new commit
BUDGET_USD="${BUDGET_USD:-}"      # optional per-iteration USD cap, e.g. 2.00
TEST_CMD="${TEST_CMD:-npm test}"                      # tests (hard gate)
CHECK_CMD="${CHECK_CMD:-npm run check --if-present}"  # lint/format; no-op until T2 adds a check script
MAX_TURNS="${MAX_TURNS:-40}"                          # cap actions per iteration

# --- preflight safety: refuse to run on a primary branch -------------------
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo none)"
case "$branch" in
  main|master|none)
    echo "Refusing to run on branch '$branch'. Create a throwaway worktree first:"
    echo "  git worktree add ../backpressure-loop -b ralph/auto && cd ../backpressure-loop"
    exit 1 ;;
esac

# --- pick the CLI to command -----------------------------------------------
case "$AGENT" in
  claude)
    bin="claude"
    run_agent() {
      claude -p "$(cat prompt.md)" \
        --dangerously-skip-permissions \
        --max-turns "$MAX_TURNS" \
        "${budget_flag[@]}" \
        --output-format json
    } ;;
  codex)
    bin="codex"
    run_agent() {
      codex exec "$(cat prompt.md)" \
        --dangerously-bypass-approvals-and-sandbox \
        --json
    } ;;
  *) echo "Unknown AGENT '$AGENT'. Use: claude | codex"; exit 1 ;;
esac

if ! command -v "$bin" >/dev/null 2>&1; then
  echo "$bin CLI not found on PATH."; exit 1
fi

for f in prompt.md PLAN.md; do
  [ -f "$f" ] || { echo "Missing required file: $f"; exit 1; }
done

mkdir -p .ralph
n=0; stalls=0

budget_flag=()
[ -n "$BUDGET_USD" ] && budget_flag=(--max-budget-usd "$BUDGET_USD")

echo "Starting loop: AGENT=$AGENT  branch='$branch'  MAX_ITERS=$MAX_ITERS  TEST_CMD='$TEST_CMD'"

while grep -qE '^- \[ \]' PLAN.md; do
  if [ "$n" -ge "$MAX_ITERS" ]; then
    echo "Reached MAX_ITERS=$MAX_ITERS. Stopping."; break
  fi
  n=$((n+1))
  before="$(git rev-parse HEAD 2>/dev/null || echo none)"
  echo "=== iteration $n  $(date '+%F %T') ==="

  run_agent >> ".ralph/iter-$n.json" 2>&1 \
    || echo "($AGENT exited non-zero this iteration — see .ralph/iter-$n.json)"

  # --- hard backpressure: tests AND lint must pass to continue ---
  # (CHECK_CMD is a no-op until task T2 adds an npm "check" script)
  if ! { $TEST_CMD && $CHECK_CMD; } >/dev/null 2>&1; then
    echo "Verify FAILED (tests or lint) after iteration $n. Stopping for human review."; break
  fi

  # --- stall detection: a productive iteration produces a commit ---
  after="$(git rev-parse HEAD 2>/dev/null || echo none)"
  if [ "$after" = "$before" ]; then
    stalls=$((stalls+1))
    echo "No commit this iteration (stall ${stalls}/${MAX_STALLS})."
    if [ "$stalls" -ge "$MAX_STALLS" ]; then
      echo "Too many stalls in a row. Stopping — a task is likely stuck."; break
    fi
  else
    stalls=0
  fi
done

remaining="$(grep -cE '^- \[ \]' PLAN.md 2>/dev/null || echo 0)"
echo "Loop ended after ${n} iteration(s). Open tasks remaining: ${remaining}."
echo "Review: git log --oneline   and   .ralph/iter-*.json"
