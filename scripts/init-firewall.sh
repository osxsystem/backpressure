#!/usr/bin/env bash
# scripts/init-firewall.sh — default-deny egress with an allowlist (L0, §3.3).
# Run as root INSIDE the sandbox container, BEFORE dropping to the agent user.
# Requires NET_ADMIN + NET_RAW. Rebuild PER RUN: CDN/GitHub IPs rotate.
#
# Ordering is load-bearing: open loopback/DNS/established FIRST (while the
# policies are still ACCEPT), build the allowlist while traffic is permitted,
# then flip the policies to DROP LAST — otherwise the script bricks its own setup.
#
# NOTE (long campaigns): the allowlist for the CDN-fronted hosts below is a
# point-in-time `dig` snapshot; their IPs rotate, so over a multi-hour run a new
# connection can hit an un-captured IP and be dropped. For long/untrusted runs
# prefer the sidecar-proxy model (§4.1.3) with a DNS-aware *domain* allowlist.
set -euo pipefail

# 1. Open the essentials FIRST, on BOTH chains, while the policies are ACCEPT.
#    Reply packets for outbound connections arrive on the INPUT chain, so INPUT
#    needs its own loopback + ESTABLISHED,RELATED accepts or the handshake dies
#    the moment INPUT is flipped to DROP (step 3).
iptables -A INPUT  -i lo -j ACCEPT
iptables -A INPUT  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT     # DNS
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# 2. Build the allowlist ipset while traffic is still permitted.
ipset create allowed-domains hash:net -exist

# GitHub (api/web/git CIDR ranges — robust against IP rotation).
curl -fsS https://api.github.com/meta | jq -r '(.web + .api + .git)[]' \
  | while read -r cidr; do ipset add allowed-domains "$cidr" -exist; done

# Inference + package registry. api.anthropic.com (Claude) and registry.npmjs.org
# (pnpm install at startup) are the load-bearing two for a Claude run; the
# OpenAI/ChatGPT hosts are harmless extras for a Codex run. `dig +short` returns
# every A record; we add them all.
for d in api.anthropic.com registry.npmjs.org api.openai.com chatgpt.com; do
  dig +short "$d" | grep -E '^[0-9.]+$' \
    | while read -r ip; do ipset add allowed-domains "$ip" -exist; done
done

# Your alert host (§3.11.2), so ralph-loop.sh's notify() can page out on a halt.
if [ -n "${ALERT_HOST:-}" ]; then
  for ip in $(dig +short "$ALERT_HOST" | grep -E '^[0-9.]+$'); do
    ipset add allowed-domains "$ip" -exist
  done
fi

# 3. Accept the allowlist, THEN flip default-deny LAST.
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -P OUTPUT DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP

# 4. Self-test — the proof the wall is up. A blocked host must FAIL; the two
#    hosts the loop actually needs (GitHub for this test, the npm registry for
#    `pnpm install`) must PASS. Any inversion = misconfigured wall → abort.
if curl --connect-timeout 5 -fsS https://example.com >/dev/null 2>&1; then
  echo "FAIL: egress open (example.com reachable)"; exit 1
fi
if ! curl --connect-timeout 5 -fsS https://api.github.com/zen >/dev/null 2>&1; then
  echo "FAIL: allowlist broke (api.github.com unreachable)"; exit 1
fi
# registry.npmjs.org returns 200 on /; -s (no -f) so a 4xx wouldn't false-fail,
# but a DROP makes curl exit non-zero on connect — that is what we catch.
if ! curl --connect-timeout 5 -s -o /dev/null https://registry.npmjs.org/; then
  echo "FAIL: npm registry unreachable — pnpm install will hang. Re-resolve IPs."; exit 1
fi
echo "firewall: default-deny egress active (github + anthropic + npm allowlisted)"
