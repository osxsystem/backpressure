---
description: Plan + scaffold a Ralph/Backpressure loop from a one-line goal, then hand off to the sandboxed harness. Launcher only — it does NOT run the unattended loop on your host.
argument-hint: "<one-line goal>"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task, WebFetch
---

# Backpressure loop launcher

Campaign goal: **$ARGUMENTS**

You are the **planning lead** for a Backpressure/Ralph loop. The full design is in
`docs/RALPH_PRODUCTION_GUIDE.md` (read the referenced sections as needed — do NOT
load the whole file). A slash command runs in THIS live session, so it is **not**
the unattended loop (§2.6, §3.11.3): your job is the **Planning plane** (§3.6) plus
wiring the rails, then HAND OFF to `scripts/ralph-loop.sh`. Work the phases in
order. If a safety check fails, STOP and tell me.

## Phase 0 — Safety floor (L0, §3.2.1)
- Run `git rev-parse --abbrev-ref HEAD`. If it is `main`/`master`/`HEAD`, STOP and
  tell me to create a throwaway worktree first:
  `git worktree add ../bp-loop -b ralph/auto && cd ../bp-loop`.
- Check `git status --porcelain`; refuse to scaffold over uncommitted work without
  my explicit OK.

## Phase 1 — Planning plane, run ONCE (L1, §3.5–§3.6)
Derive the four memory files from the goal **$ARGUMENTS**. Use MANY parallel
subagents (Task) for research/search; EXACTLY ONE for any build/test (§2.8).
1. Ask me at most 2–3 clarifying questions, and only if the goal is ambiguous.
2. `specs/*.md` — one file per concern (overview/api/storage/…); each states what
   to build, explicit **acceptance criteria**, and a "Why these choices" section
   so a future amnesiac loop can't simplify the intent away (§3.5.3).
3. `fix_plan.md` — an ORDERED `- [ ]` checklist, smallest-shippable-first, each
   item traceable to a spec; no item bundling two concerns (§3.5.2).
4. `PROMPT.md` — standing orders. Reproduce Huntley's directives VERBATIM (keep
   `parrallel`, lowercase `rust`, and the ALL-CAPS emphasis); point the gate step
   at `./scripts/backpressure-gate.sh` (§3.5.1). Immediately BENEATH the verbatim
   line, add this stack-neutral **Fan-out discipline** block verbatim (it turns
   the ceiling into a safe procedure — read-fan-out, single-writer,
   orchestrator-only gate; §2.8):

   ```markdown
   ## Fan-out discipline — how to actually use those subagents
   The line above is a CEILING, not a quota. Fan-out is a throughput trick for the
   ONE item you picked this loop — it does NOT change the one-item-per-loop rule.
   Never work more than one `- [ ]` item per loop, even in parallel: cross-item
   fan-out reintroduces write-collisions and breaks one-commit-per-loop and the
   `fix_plan.md` hard ordering. Do exactly one thing (see the top of this file).

   - READ / RESEARCH — fan out freely. Dispatch parallel subagents to search the
     codebase, locate call-sites, and read independent files. Spawn them READ-ONLY
     (Read/Grep/Glob tools only, like the bundled `researcher` agent) — a read-only
     subagent cannot collide with anything. This is where the speed comes from.
   - WRITES — single-writer by DEFAULT. There is NO structural lock on edits: an
     edit-subagent inherits Write/Edit and nothing stops two of them clobbering the
     same file. So by default, subagents RETURN a proposed diff and YOU, the
     orchestrator, apply every write yourself, serially. One hand on the pen.
   - PARALLEL EDITS — opt-in, only when PROVABLY disjoint. You MAY fan out edits
     ONLY if you first name a non-overlapping file set (each subagent owns paths no
     other subagent touches). If you cannot list the disjoint paths up front, or
     you're unsure, fall back to the single-writer funnel. When in doubt, funnel.
   - BUILD / TEST — orchestrator-only, once, at the end. No subagent runs the gate.
     When every subagent has returned and all writes are applied, YOU run the full
     composite gate (`./scripts/backpressure-gate.sh`) exactly once, alone. Never
     run build/test while any subagent is live (the gate's `flock` mutex is a
     backstop, not a license — concurrent builds collide on shared build dirs,
     lockfiles, and ports).

   Sequence every loop: fan out to READ → collect → apply WRITES serially →
   let subagents quiesce → run the gate once.
   ```
5. `CLAUDE.md` — the Claude-side AGENT.md: how to build/run/test, "one productive
   commit per loop", "never push to main / never publish" (§3.5.4).
6. Commit the baseline:
   `git add specs fix_plan.md PROMPT.md CLAUDE.md && git commit -m "plan: specs + fix_plan baseline"`.

## Phase 2 — Wire the rails (L3, §3.4 + §3.7)
The gate and harness already exist in this repo (`scripts/backpressure-gate.sh`,
`scripts/ralph-loop.sh`). Make them live for THIS project:
- `chmod +x scripts/backpressure-gate.sh scripts/ralph-loop.sh`.
- **Tune `scripts/backpressure-gate.sh` to the project's stack.** It ships
  TypeScript/Node stages (biome / tsc / jscpd / vitest / gitleaks). If the goal
  implies another language (e.g. Rust → `cargo fmt --check` / `clippy -D warnings`
  / `cargo test` / `cargo build`), edit the stages but KEEP the shape: fail-fast,
  one exit code, flock-wrapped build, a positive acceptance stage (§3.7.2).
- Run `backpressure init --target claude --dry-run`, show me the plan, then
  `backpressure init --target claude` (installs the Stop hook + `reviewer` + skill).
- Repoint the Stop hook in `.claude/settings.json` from `pnpm test` to
  `./scripts/backpressure-gate.sh` (§3.7.3).
- Add a `"test:acceptance"` script to `package.json` (e.g. `vitest run -t @acceptance`)
  so the gate's positive acceptance stage is real, and author the `@acceptance`
  suite 1:1 from each spec's acceptance criteria.
- Commit the rails.

## Phase 3 — Hand off (DO NOT run the loop on the host)
The unattended loop runs INSIDE the container (§1.4, §3.2). PRINT this launch line
for me — do **not** execute it — then stop:

    docker run --rm -it \
      --cap-add NET_ADMIN --cap-add NET_RAW --security-opt no-new-privileges \
      --read-only --tmpfs /tmp --pids-limit 512 --memory 4g --cpus 2 \
      --network ralph-egress \
      -e CLAUDE_CODE_OAUTH_TOKEN -e ALERT_WEBHOOK \
      -v "$PWD":/work -w /work ralph-loop:2.1.193 \
      bash -lc 'sudo /usr/local/bin/init-firewall.sh && exec gosu agent ./scripts/ralph-loop.sh'

Then summarize what was written and walk me through the go/no-go checklist (§3.12),
reminding me the **first run must be attended**.
