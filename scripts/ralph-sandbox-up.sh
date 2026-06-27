#!/usr/bin/env bash
# scripts/ralph-sandbox-up.sh — stand up the L0 sandbox (§3.2/§3.3) and run the
# Backpressure/Ralph loop INSIDE it. Tier 1 (hardened container) posture for a
# TRUSTED repo. This is the one command that replaces the raw `docker run` line.
#
# Provide first:
#   export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"   # ephemeral; revoke after
#   # optional: export ALERT_WEBHOOK=https://hooks.…/…   (halt paging, §3.11.2)
# Then:
#   ./scripts/ralph-sandbox-up.sh
#
# >>> FIRST RUN: STAY ATTENDED (§3.12). Tune by editing the memory files
#     (PROMPT.md / specs/* / fix_plan.md / CLAUDE.md), NOT the code. <<<
#
# Flow: build the pinned image -> start as root -> remap the agent uid to the
# bind-mount owner -> raise the default-deny firewall -> drop to the
# unprivileged `agent` (gosu) -> pnpm install -> loop. `no-new-privileges` is
# honored because we only ever DROP privilege (gosu), never escalate (no sudo).
set -euo pipefail

IMAGE="${IMAGE:-ralph-loop:2.1.193}"
NET="${NET:-ralph-egress}"
NM_VOLUME="${NM_VOLUME:-ralph-node-modules}"   # Linux node_modules + pnpm store, OFF the host tree

: "${CLAUDE_CODE_OAUTH_TOKEN:?Set CLAUDE_CODE_OAUTH_TOKEN first: export CLAUDE_CODE_OAUTH_TOKEN=\"\$(claude setup-token)\"}"

# Paging only works if the firewall allowlists the webhook's host. Derive
# ALERT_HOST from ALERT_WEBHOOK so they can't silently disagree (a mismatch makes
# every halt-page vanish into the default-deny wall).
if [ -n "${ALERT_WEBHOOK:-}" ] && [ -z "${ALERT_HOST:-}" ]; then
  ALERT_HOST="$(printf '%s' "$ALERT_WEBHOOK" | sed -E 's#^[a-zA-Z]+://([^/:]+).*#\1#')"
  export ALERT_HOST
  echo "==> derived ALERT_HOST=$ALERT_HOST from ALERT_WEBHOOK"
fi

# Refuse to run on a protected branch — the loop's commits must land on a
# throwaway branch a human reviews, never directly on main.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo none)"
case "$branch" in
  main|master|HEAD|none)
    echo "refusing: check out a non-main throwaway branch first (got '$branch')."
    echo "  e.g.  git worktree add ../bp-loop -b ralph/auto && cd ../bp-loop"
    exit 1 ;;
esac

echo "==> egress network ($NET)"
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

echo "==> build $IMAGE (Dockerfile.ralph)"
docker build -f Dockerfile.ralph -t "$IMAGE" .

echo "==> run the loop inside the sandbox on branch '$branch'"
# The entrypoint runs as root: remap agent to the bind-mount owner so the
# non-root agent can write /work on any Linux host (no-op on uid-1000 / macOS),
# raise the firewall, chown the writable mounts, then drop to agent for the loop.
exec docker run --rm -it --init --user 0 \
  --cap-add NET_ADMIN --cap-add NET_RAW --security-opt no-new-privileges \
  --read-only --tmpfs /tmp --tmpfs /home/agent --tmpfs /run \
  --pids-limit 512 --memory 4g --cpus 2 \
  --network "$NET" \
  -e CLAUDE_CODE_OAUTH_TOKEN -e ALERT_WEBHOOK -e ALERT_HOST \
  -e MODEL -e BUDGET_USD -e MAX_TURNS -e MAX_ITERS -e MAX_STALLS \
  -e ITER_TIMEOUT -e CAMPAIGN_HOURS -e MIN_FREE_MB \
  -v "$PWD":/work:rw -v "$NM_VOLUME":/work/node_modules -w /work \
  "$IMAGE" \
  bash -lc '
    set -e
    work_uid="$(stat -c %u /work)"
    if [ "$work_uid" = 0 ]; then
      echo "ralph: WARNING /work is root-owned; the non-root agent cannot write it." >&2
      echo "ralph: run from a checkout owned by a non-root user, or the loop will fail." >&2
    elif [ "$work_uid" != 1000 ]; then
      usermod  -u "$work_uid" agent
      work_gid="$(stat -c %g /work)"; [ "$work_gid" != 0 ] && groupmod -g "$work_gid" agent 2>/dev/null || true
    fi
    /usr/local/bin/init-firewall.sh
    chown -R agent:agent /work/node_modules /home/agent
    exec gosu agent bash -lc "pnpm install --frozen-lockfile && exec ./scripts/ralph-loop.sh"
  '
