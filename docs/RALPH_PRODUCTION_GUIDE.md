# The new Ralph loop guide.

## 1. Executive Summary & Context

### 1.1 What this guide is, who it's for, and what it is not

> [!NOTE]
> **Audience (stated assumption).** This guide is written for **senior and intermediate software engineers and platform/DevOps engineers** who already use **Claude Code** or **Codex CLI** *interactively* and now want to stand up an **unattended, production-grade** build loop. You are fluent in bash, git, containers, and CI. You are **not** assumed to know the Ralph technique — §1.2 introduces it — but you are assumed to want hardening, not hand-holding.

This guide spends its page-weight on **hardening** — sandboxing, secrets, egress, cost governance, observability, recovery, and CI — and on the **concrete Backpressure wiring** that installs those guardrails. It does not re-teach basics.

> [!NOTE]
> **How this differs from the existing docs.** `docs/RALPH_GUIDE.md` is the **beginner** guide (the first loop, a pre-flight checklist, a starter bash harness). `docs/USER_GUIDE.md` is the **toolkit reference** for the built CLI. This guide is strictly **more production-oriented** than both: it cross-references them and goes deep where they stop. It does **not** restate them.

**One-sentence thesis:** *Backpressure-style guardrails are the technique that makes the Ralph loop safe and repeatable.*

### 1.2 The Ralph technique in 90 seconds

**Ralph is a technique, not a tool.** The entire idea is one bash line that restarts a headless agent forever, doing **ONE thing per loop**:

```bash
while :; do cat PROMPT.md | claude -p ; done
```

`claude -p` is **print/headless mode**: it reads the piped prompt, runs once, and exits — so the `while` loop re-invokes it from scratch every pass.

> [!NOTE]
> **Provenance (fidelity note).** Geoffrey Huntley's original post (ghuntley.com/ralph) pipes into `claude-code`: `while :; do cat PROMPT.md | claude-code ; done`. This guide uses the modern runnable form `claude -p` and treats it as canonical; we do **not** claim the post literally wrote `claude -p`.

The name comes from Ralph Wiggum: the technique is *"deterministically bad in an undeterministic world."* It is not clever — it simply never stops, and that **convergence** is the point.

**Mental model: each loop is a fresh context window with amnesia.** The agent never remembers the previous pass. All state lives in a handful of **memory files** that every loop re-reads to rebuild its bearings (detailed in §2.5). The guide's own image for this: *a relay race where every runner has amnesia but reads the same clipboard.* (This analogy is ours, not a Huntley quote.)

**The four principles:**

| # | Principle | What it means |
| --- | --- | --- |
| 1 | **One thing per loop** | Each pass picks the single most important item, lands it, and stops. |
| 2 | **Faith in eventual consistency** | "Gardening, not engineering" — many small passes converge; don't over-steer a single loop. |
| 3 | **Your skill shows up in the output** | Vague specs ⇒ garbage. The quality of the result tracks the quality of your specs and examples. |
| 4 | **Monolithic beats multi-agent** | One process, one repo, one loop. Resist orchestration sprawl. |

### 1.3 The three-phase model this guide uses — and why "Backpressure" is the load-bearing one

```text
        ┌─────────────┐
        │  GENERATE   │  write code (steered by specs + examples)
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │ BACKPRESSURE│  THE GATE: tests + linter/compiler + scanners MUST pass
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │  LOOP BACK  │  tick the plan, reset context, restart
        └──────┬──────┘
               └────────── the wheel turns ───────────┐
                                                       ▲
               (fresh context every revolution) ───────┘
```

> [!NOTE]
> **Framing (fidelity note).** Huntley formally names only **phase one: generate** and **phase two: backpressure**. The third "loop back" label and the named triad are **this guide's editorial synthesis** — present them as "the model this guide uses," not three labels lifted from the post.

- **Generate** — the agent writes code; quality is steered by the specs and examples you wrote up front.
- **Backpressure** — **the GATE.** Run the tests, the linter/compiler, and the security scanners; the loop **MUST** pass them before proceeding. This is the *"are you sure?"* wall that stops bad code from flowing downstream — **the concept this repo is named after.**
- **Loop back** — the agent verifies its own change, notes what's left in the plan, and restarts with a clean context.

> *the wheel has got to turn fast.* (companion: *The speed of the wheel turning that matters, balanced against the axis of correctness.*)

### 1.4 The central risk thesis (the spine of this guide)

The one-liner only runs unattended because it passes a **bypass flag** that **turns OFF the CLI's own sandbox** to buy autonomy. The moment you do that, **all isolation, cost, observability, and recovery burden shifts OUTWARD** — onto machinery you must build. **This guide is that machinery.**

| | Claude Code | Codex CLI |
| --- | --- | --- |
| **Bypass flag** | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |
| **Equivalent to** | `--permission-mode bypassPermissions` | `--sandbox danger-full-access` |
| **What it disables** | the permission prompts (**no OS sandbox exists either way**) | the approvals **and** a real OS sandbox (Seatbelt/Landlock) |
| **Net effect** | unrestricted host shell — external isolation **required** | unrestricted host shell — but Codex *can* instead run sandboxed (§2.6) |

The #1 production failure is **bypassing the in-CLI sandbox and not replacing it** with an external one.

> [!IMPORTANT]
> **Load-bearing.** A git worktree is **version-control isolation, NOT a security sandbox.** `git reset --hard` only undoes file changes *inside the repo* — it cannot undo a deleted file elsewhere, a leaked secret, or an exfiltrated `~/.claude` token.

The bare loop lacks four things this guide installs:

| Missing in the bare loop | Hardened in |
| --- | --- |
| **Isolation** (container/VM, egress control) | §3.2, §3.3, §4.1 |
| **An honest composite gate** (tests + lint + scanners, one exit code) | §3.7, §4.3.3 |
| **Kill switches & recovery** (caps, timeouts, known-green rollback) | §3.8, §3.10, §4.3 |
| **Observability** (journal, audit trail, metrics) | §3.9, §4.4 |

### 1.5 When Ralph works, when it fails, and the receipts

| ✅ WORKS | ❌ FAILS / HURTS |
| --- | --- |
| **Greenfield** projects | **Existing/legacy** codebases |
| Clear, testable outputs (compilers, libraries, well-specced services) | Vague or untestable goals |
| Typed/fast-compiling languages where the compiler is **honest backpressure** (`rust` favoured) | Dynamic/untyped languages with **no static analyzer wired in** as backpressure |
| A strong test gate that bad code cannot cross | Any time the test gate is **weak** (bad code flows straight through) |

> *There's no way in heck would I use Ralph in an existing code base.*
>
> *If you do not, then you will run into a bonfire of outcomes.* (context: failing to wire static analysers into dynamically-typed projects).

> [!NOTE]
> **Receipts (attributed claims from Huntley's writing/talks, not independently verified here).** A **$50,000** contract delivered as a tested MVP for **$297** of AI spend; **CURSED** — a real compiler for an esoteric, zero-training-data language, built by Ralph loops and now self-hosting; *"6 repos shipped overnight"* at a Y Combinator hackathon.

> [!IMPORTANT]
> **The senior caveat.** Ralph **multiplies a senior engineer; it does not replace one.** Claims that engineers are no longer required are, in Huntley's words, *peddling horseshit.* The human merge gate is non-negotiable — see §3.13 and §4.6.

### 1.6 What Backpressure (this repo) provides — and deliberately does not

**Backpressure is a capability pack for Claude Code + Codex — NOT an agent or runtime.** The loop, tool execution, and sandboxing belong to the CLI. By design, **it ships no loop runner.** Its one rule: **author once, compile per target** — one source of truth emits each CLI's native config.

`backpressure init --target claude|codex` gives you:

- a **Stop-event test-gate hook** that runs `pnpm test` — **the** backpressure gate (widened in §3.7);
- a **`reviewer`** subagent (tools: `Read`, `Grep`) that reviews a diff for scope creep and missing tests;
- the portable **`building-adaptive-ui`** skill (`SKILL.md` copied verbatim per CLI);
- plus tested **loop primitives** — the `Governor`, `writeJournalEntry`, and the invocation seam (`buildArgv`/`runAgent`) — that **you assemble yourself**.

> [!CAUTION]
> **v0 scope — promise nothing undelivered.** The tracker MCP server is built but **not installed** (no `.mcp.json` / `[mcp_servers]` is written); `backpressure build` and `backpressure index` are **stubs**; the store is a JSON file; and the Stop hook is **hardcoded to `pnpm test`**. Widening the gate, feeding real cost into the Governor, and assembling the harness are **edits you make**, not installed v0 behavior. See §2.7 and §4.5.

### 1.7 How to read this guide: the L0–L7 injection-point model

This guide hangs every control on a **single skeleton**: the **L0–L7 injection points** of one loop iteration — from the outer sandbox (**L0**) through the memory files, invoke, gate, governor, journal, recovery, and CI/merge (**L7**). §2.3 defines the taxonomy and gives the master cross-reference index; **§3 installs the points in order** and **§4 hardens them cross-cuttingly.**

---

## 2. Technical Prerequisites & Architecture

This is the reference section the implementation steps (§3) and the production controls (§4) cross-link back to. It establishes the full structural model — the two planes, the loop anatomy, the memory-file contract, the CLI capability matrix, and the Backpressure seam — **before any command runs**. Read it once; treat the §2.6 matrix and §2.2 versions as version-sensitive (re-verify per §5.4).

### 2.1 Prerequisites & host requirements

The running examples assume a **greenfield, typed/fast-compiling project** (the technique's sweet spot, §1.5) where the compiler is honest backpressure. You need the following on the host that launches the loop:

| Requirement | Why it is load-bearing | Notes |
| --- | --- | --- |
| **Node 20+** (ESM) | Backpressure is Node 20+/ESM; the seam and loop primitives import as `node:`-prefixed modules. | `node --version` ≥ v20. |
| **pnpm** (via corepack) | The installed Stop-hook gate is hardcoded to `pnpm test` (§2.7); non-pnpm repos must hand-edit it (§5.2). | `corepack enable pnpm`. |
| **git** with worktree support | The throwaway-branch floor (§3.2.1) and commit-per-loop audit trail (§3.9) depend on it. A worktree is **not** a sandbox (§2.3). | `git worktree --help`. |
| **A container runtime** | The bypass flag (§1.4) removes the CLI's own isolation; you replace it with a container/microVM (§3.2). | Rootless Docker / devcontainer baseline; gVisor or Firecracker/Kata for untrusted runs. |
| **`claude` and/or `codex` on PATH** | The loop invokes one (or both) headless. | Pin versions (§2.2). |
| **A CI provider** | The human merge gate and required-status-check parity (§3.13). | GitHub Actions for the concrete examples; `gh` + branch protection. |
| **`iptables`/`ipset`** | Default-deny egress allowlist (§3.3). | Linux; requires `NET_ADMIN`+`NET_RAW`. |
| **`gitleaks`, `jscpd`** | Secret + duplicate-code stages of the composite gate (§3.7). | Installed inside the loop image. |
| **Backpressure, built from source** | The package is `private` and **unpublished** — consume it from source (`src/`) or the built bin `dist/cli.js`. | `pnpm install && pnpm run build`. |

> [!NOTE]
> **Host-OS isolation differs and it bites.** macOS uses **Apple Seatbelt**; Linux uses **Landlock + seccomp**. This matters most for Codex, whose OS sandbox is built on these primitives (§2.6) — and whose macOS Seatbelt path silently ignores one network toggle (§3.3).

### 2.2 Toolchain & version pinning

Everything in §2.6 is observed behavior of specific binaries. Pin them.

| Component | Verified version | As of |
| --- | --- | --- |
| Claude Code | **2.1.193** | 2026-06-26, macOS |
| Codex CLI | **0.137.0** (`codex doctor`: 0.142.2 available) | 2026-06-26, macOS |

> [!WARNING]
> **Flags move between releases.** Claude's `--max-turns` has already **silently vanished from `claude --help`** in 2.1.193 while remaining functional (a live `--max-turnzzz` returns `error: unknown option`; `--max-turns 3` parses). Treat undocumented flags as fragile, prefer documented ones (`--max-budget-usd`), and pin the CLI so the loop does not auto-update under you:
> ```bash
> DISABLE_AUTOUPDATER=1 npm install -g @anthropic-ai/claude-code@2.1.193
> ```
> Re-run `claude --help` / `codex exec --help` whenever you bump a version (§5.4).

### 2.3 Loop anatomy: the L0–L7 injection-point model

The bare Ralph line (§1.2) is one box. A production loop is the same box wrapped in seven controls. Every step in §3 installs at one of these points; every control in §4 hardens one. This taxonomy is the spine of the guide.

```text
                              ┌──────────────────────────────────────────────┐
   L0  OUTER WRAPPER / SANDBOX │  container | microVM  +  default-deny egress  │  (built ONCE, §3.2/§3.3)
                              │   +  throwaway non-main git branch            │
                              └───────────────────────┬──────────────────────┘
                                                      │   one iteration ↓ (repeats)
        ┌─────────────────────────────────────────────┴─────────────────────────────────────────┐
        │                                                                                         │
        │  L1  MEMORY FILES   ──read──▶  PROMPT.md · AGENT.md(→CLAUDE.md/AGENTS.md) · specs/* ·    │
        │      (re-read every loop)                                  fix_plan.md   (state lives here)│
        │                                   │                                                      │
        │                                   ▼                                                      │
        │  L2  INVOKE  ──▶  claude -p "<prompt>"  /  codex exec "<prompt>"   (fresh context window) │
        │                                   │                                                      │
        │                                   ▼                                                      │
        │  L3  GATE / BACKPRESSURE  ──▶  Stop hook → composite gate (tests+lint+compile+scanners)  │
        │                                   │   exit 0 = green ──▶ tick one - [ ] , commit         │
        │                                   │   exit ≠0 = red   ──▶ L6                              │
        │                                   ▼                                                      │
        │  L4  GOVERNOR  ──▶  decide(): iterations → consecutiveFailures → budget   (halt?)         │
        │                                   │                                                      │
        │                                   ▼                                                      │
        │  L5  JOURNAL / AUDIT  ──▶  one JSONL line + git commit  (git log IS the trail)            │
        │                                   │                                                      │
        │  L6  RECOVERY (on red/signal) ──▶ git reset --hard <last-green>  | bounded recovery prompt│
        └─────────────────────────────────────────────────────────────────────────────────────────┘
                                                      │
                                                      ▼
   L7  CI / MERGE  ──▶  throwaway branch → PR → CI re-runs the SAME gate → human approval → main
```

**Master cross-reference index** — find any control by its L-id:

| ID | Injection point | When it runs | §3 step that installs it | §4 control that hardens it |
| --- | --- | --- | --- | --- |
| **L0** | Outer wrapper / sandbox | once | §3.2, §3.3 | §4.1 |
| **L1** | Memory files (`PROMPT.md`/`AGENT.md`/`specs`/`fix_plan`) | every loop | §3.5, §3.6 | §4.3 |
| **L2** | INVOKE (`claude -p` / `codex exec`) | every loop | §3.8 | §4.1.5, §4.2 |
| **L3** | GATE (Stop hook / backpressure) | every loop | §3.7 | §4.3.3 |
| **L4** | GOVERNOR (between iterations) | every loop | §3.8 | §4.3.1 |
| **L5** | JOURNAL / AUDIT (after each loop) | every loop | §3.9 | §4.4 |
| **L6** | RECOVERY (on red gate/signal) | on failure | §3.10 | §4.3.2 |
| **L7** | CI / MERGE (per PR) | per PR | §3.13 | §4.6 |

> [!IMPORTANT]
> **L0 is not optional and it is not a worktree.** The §1.4 thesis in one line: the loop only runs headless because a **bypass flag turns OFF the CLI's own sandbox** to buy autonomy, so all isolation, cost, observability, and recovery burden shifts **outward** to L0–L7. A git worktree/branch is **version-control isolation, not a security sandbox** — `git reset --hard` undoes in-repo file changes only, never a deleted external file, a leaked secret, or an exfiltrated `~/.claude` token. Define the isolation boundary (§3.2) before the agent is ever invoked.

### 2.4 The two planes: Planning vs Implementation

Ralph has two distinct modes of operation. Newcomers skip planning and the loop wanders; the production discipline is to run planning **once** and let the loop allocate context **identically** every pass.

```text
  PLANNING PLANE  (run ONCE · human-steered · single agent + disposable subagents)
  ─────────────────────────────────────────────────────────────────────────────
   REQUIREMENTS  ──▶  subagents load URLs / papers / release notes
                       write specs, ONE FILE PER CONCERN
                                    │
                                    ▼   produces
                              ┌───────────┐
                              │  specs/*  │  ← WHAT to build (the blueprint)
                              └─────┬─────┘
                                    ▼
   TODO  ──▶  study specs · fan many subagents across existing src/ in parallel
              ("up to 500") · write the ordered plan
                                    │
                                    ▼   produces
                            ┌───────────────┐
                            │  fix_plan.md  │  ← ordered - [ ] to-dos
                            └───────┬───────┘
  ─────────────────────────────────┼─────────────────────────────────────────────
                                    │  feeds
                                    ▼
  IMPLEMENTATION PLANE  (the LOOP · driven by PROMPT.md + AGENT.md · same context shape every pass)
  ─────────────────────────────────────────────────────────────────────────────
     study specs + plan ─▶ pick the ONE most important - [ ] ─▶ research & edit (MANY subagents)
        ─▶ build & test (EXACTLY ONE subagent) ─▶ on green: tick it off, commit ─▶ fresh context ─▶ repeat
```

| Plane | Cadence | Who drives | Context shaping | Output |
| --- | --- | --- | --- | --- |
| **Planning** | run **once** (regenerate on drift, §4.3.4) | human-steered, single agent + disposable subagents | manual, exploratory; "manual context up front" | `specs/*.md` + `fix_plan.md` |
| **Implementation** | the loop, N iterations | `PROMPT.md` + `AGENT.md`, no human per loop | identical every pass; "automatic context in the loop" | code + ticked `- [ ]` + commits |

Planning is detailed in §3.6 (and walked through in `docs/RALPH_GUIDE.md` — this guide adds only production discipline). The loop is assembled in §3.11.

### 2.5 The memory-file contract (the amnesia architecture)

Each loop is a **fresh context window with amnesia** (§1.2). The agent is stateless; **the files hold all the state.** This is the contract the loop re-reads on every pass.

| Abstract file | Role | **Real per-CLI name** |
| --- | --- | --- |
| `PROMPT.md` | Standing orders, piped/passed in **every loop** | `PROMPT.md` (same on both) |
| `fix_plan.md` / `IMPLEMENTATION_PLAN.md` | Prioritized to-do list with `- [ ]` checkboxes | same on both |
| `specs/*` | Precise specifications = **what to build** (the blueprint) | same on both |
| `AGENT.md` | **How to build/run/test** the repo | **`CLAUDE.md`** for Claude Code · **`AGENTS.md`** for Codex |

> [!WARNING]
> **Map the abstract `AGENT.md` to the concrete per-CLI filename or the loop reads nothing.** Claude Code auto-discovers `CLAUDE.md`; Codex auto-discovers `AGENTS.md`. A file named `AGENT.md` is invisible to both.

> [!IMPORTANT]
> **When something keeps going wrong, fix THESE FILES, not the code.** The next amnesiac loop has no memory of intent, so "capture the why" in tests and docs — otherwise the next pass deletes the very thing it can't see the reason for. Keep all four memory files in **git** so the contract is versioned, auditable, and revertable.

### 2.6 The CLI capability matrix: Claude Code vs Codex headless

This is the full side-by-side. Backpressure's seam (§2.7) normalizes the first four rows; everything else you wire yourself. **Verified on Claude Code 2.1.193 / Codex CLI 0.137.0, 2026-06-26 — treat as version-sensitive.**

| Concept | Claude Code 2.1.193 | Codex CLI 0.137.0 | Backpressure seam name |
| --- | --- | --- | --- |
| Headless entry | `claude -p` / `--print` (prompt arg or piped stdin) | `codex exec` (alias `e`); prompt arg or piped stdin | `headless` (`-p` / `exec`) |
| Permission/sandbox bypass | `--dangerously-skip-permissions` (= `--permission-mode bypassPermissions`) | `--dangerously-bypass-approvals-and-sandbox` (= `--sandbox danger-full-access`) | `permission` |
| Graduated autonomy (no full bypass) | `--permission-mode {dontAsk,acceptEdits,auto,plan,bypassPermissions,default}` + `--allowedTools`/`--disallowedTools` | `-s/--sandbox {read-only,workspace-write,danger-full-access}` + `-a/--ask-for-approval {untrusted,on-request,never}` | not modeled (CLI divergence) |
| Model | `--model <alias\|full>` | `-m/--model <MODEL>` | `model` (`--model`) |
| Turn cap | `--max-turns <n>` — **works but hidden** from `--help` | **none** | `maxTurns` (`--max-turns` / `null`) |
| Cost cap (USD) | `--max-budget-usd <amount>` (print mode only) | **none** | not in seam |
| JSON / streaming output | `--output-format {text,json,stream-json}` (`json` carries `total_cost_usd`) | `--json` (JSONL); `-o/--output-last-message <FILE>` | not in seam |
| Hook config location | `.claude/settings.json` (`hooks` keyed by event) | `~/.codex/hooks.json` **or** inline `[[hooks.<Event>]]` in `config.toml` | adapters/{claude,codex}/hooks.ts |
| Hook events (both have **Stop**) | PreToolUse, PostToolUse, UserPromptSubmit, **Stop**, SubagentStop, PreCompact, SessionStart, SessionEnd, Notification | SessionStart, SubagentStart, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStop, **Stop** | event string (`Stop`) |
| Hook **trust gate** | none | **yes** — new/changed command hooks skipped until trusted | not modeled |
| MCP | client (`--mcp-config`, `claude mcp`) | client (`codex mcp`) **and** server (`codex mcp-server`) | adapters/{claude,codex}/mcp.ts |
| Subagents | `--agents '<json>'`, `.claude/agents/*.md` | `[agents.<name>]` in `config.toml` | adapters/{claude,codex}/agents.ts |
| CI-determinism flags | `--bare` (skips autodiscovery) | `--ephemeral`, `--ignore-user-config`, `--skip-git-repo-check` | not in seam |
| In-session loop helper | `/loop` (session-level slash command) | none | n/a |

> [!IMPORTANT]
> **The load-bearing safety divergence.** **Codex ships a real OS sandbox** (Apple Seatbelt / Landlock+seccomp), selectable **without** full bypass. **Claude Code has NO OS sandbox** — it is permission-prompt-based only, and `--dangerously-skip-permissions` just removes the prompts. Consequence: **unattended Claude requires external isolation** (container/VM, §3.2); **Codex can run sandboxed-autonomous** with `-s workspace-write -a never` (network off by default). This single fact decides the CLI for many readers (§5.3).

> [!NOTE]
> **`/loop` is not the production loop.** It is a **session-level** slash command (run a prompt on an interval), **not** a `-p` headless loop runner. The unattended mechanism stays the bash `while` loop or a harness you assemble (§3.11).

> [!WARNING]
> **`--bare` gotcha.** Claude `--bare` **will become the `-p` default** in a future release and **disables auto-discovery of hooks/skills/MCP/`CLAUDE.md`**. Do **not** use it for the loop — you need the Stop-gate hook and `CLAUDE.md` auto-loaded — or explicitly re-pass `--settings`/`--mcp-config`/`--agents`/`--add-dir`.

> [!WARNING]
> **macOS Codex network gotcha.** `sandbox_workspace_write.network_access = true` is **silently ignored by Seatbelt on macOS** (openai/codex#10390); Linux Landlock honors it. Never rely on Codex's own network toggle on macOS — front it with the external firewall (§3.3).

### 2.7 The Backpressure seam, what `init` writes, and v0 boundaries

**Author once, compile per target.** The seam (`src/seam/`) and adapters (`src/adapters/`) are the **only** two places in the codebase that branch on which CLI. Everything else is target-agnostic.

```ts
// src/seam/targets.ts — the single source of truth for per-CLI flag spellings
export const TARGET_FLAGS: Record<AgentTarget, TargetFlags> = {
  claude: { headless: "-p",   permission: "--dangerously-skip-permissions",            model: "--model", maxTurns: "--max-turns" },
  codex:  { headless: "exec", permission: "--dangerously-bypass-approvals-and-sandbox", model: "--model", maxTurns: null },
};

// src/seam/argv.ts — PURE argv builder (no I/O), order: [headless?, prompt, permission?, --model <name>?, --max-turns <n>?]
export function buildArgv(target: AgentTarget, prompt: string, opts?: AgentOpts): string[];

// src/seam/run.ts — spawns BINARIES[target] via an injectable SpawnFn; resolves the exit code
export function runAgent(target: AgentTarget, prompt: string, opts?: RunAgentOpts): Promise<number | null>;
```

`headless` and `permission` default to **`true`** (an autonomous loop is always headless + bypassed). The exact, test-pinned `buildArgv` outputs:

| call | result |
| --- | --- |
| `buildArgv("claude","do the task",{model:"opus",maxTurns:40})` | `["-p","do the task","--dangerously-skip-permissions","--model","opus","--max-turns","40"]` |
| `buildArgv("codex","do the task",{model:"opus",maxTurns:40})` | `["exec","do the task","--dangerously-bypass-approvals-and-sandbox","--model","opus"]` (**max-turns dropped** — Codex has no such flag) |
| `buildArgv("claude","do the task")` | `["-p","do the task","--dangerously-skip-permissions"]` |
| `buildArgv("codex","do the task")` | `["exec","do the task","--dangerously-bypass-approvals-and-sandbox"]` |
| `buildArgv("claude","do the task",{headless:false,permission:false})` | `["do the task"]` |

> [!NOTE]
> The seam passes the prompt as an **argv positional**, not piped stdin (canonical Ralph pipes `cat PROMPT.md | claude -p`; multi-KB prompts may hit `ARG_MAX` — §3.11.2). There is **no `--max-budget-usd` knob** in the seam — budget is the Governor's job (§3.8), or you append the flag to a raw loop line.

**What `init` writes — Claude** (`backpressure init --target claude`):

```json
// .claude/settings.json   (Stop → pnpm test : THE backpressure gate)
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "pnpm test" } ] } ] } }
```
```markdown
<!-- .claude/agents/reviewer.md   (tools: Read, Grep) -->
---
name: reviewer
description: Reviews a diff for scope creep and missing tests.
tools: Read, Grep
---

You are a careful code reviewer. Report only concrete issues.
```
Plus `.claude/skills/building-adaptive-ui/` (the whole tree, byte-copied, exec bits preserved). **No `.mcp.json`** is written (no MCP servers in v0).

**What `init` writes — Codex** (`backpressure init --target codex`):

```toml
# .codex/config.toml   (hooks + [agents.reviewer] fragments; NO [mcp_servers] in v0)
[[hooks]]
event = "Stop"
command = "pnpm test"

[agents.reviewer]
description = "Reviews a diff for scope creep and missing tests."
prompt = "You are a careful code reviewer. Report only concrete issues."
tools = [ "Read", "Grep" ]
```
Plus `.codex/skills/building-adaptive-ui/` (whole tree). `init` is **atomic** — `verifySkills()` runs **before any write**, and a bad skill throws `SkillVerificationError` so **nothing is written**; `--dry-run` previews; `--global` writes **skills only** into `~/.claude/skills` or `~/.codex/skills`.

> [!WARNING]
> **Repo bug to know now (full fix in §3.7.4).** `src/adapters/codex/hooks.ts` emits a **flat `[[hooks]]`** array (`event="Stop"` / `command="pnpm test"`). **Codex 0.137.0 does not recognize this shape** — it expects nested `[[hooks.Stop]]` + `[[hooks.Stop.hooks]]` (or `~/.codex/hooks.json`). As shipped, the Codex Stop-gate is not loaded; align the adapter before relying on it.

> [!CAUTION]
> **v0 boundaries — promise nothing undelivered.** The tracker MCP server (`src/tracker/`) is **built but not installed** (no `.mcp.json` / no `[mcp_servers]`). `backpressure build` and `backpressure index` are **stubs** (`not yet implemented`). The store is a **JSON file**. The Stop hook is **hardcoded to `pnpm test`** (non-pnpm repos hand-edit, §5.2). And **there is no bundled loop runner** — `Governor`, `writeJournalEntry`, and `runAgent` are **primitives you assemble yourself** (§3.11). Cross-ref §1.6, §4.5.

### 2.8 Subagents as disposable memory (the hard concurrency rule)

A subagent is **disposable memory**: each gets its own fresh context window that is **garbage-collected on return**. This is how a stateless main agent reaches past a single window — fan out search/research/edit work, collect the results, discard the contexts.

> [!IMPORTANT]
> **Hard rule: MANY subagents for search/research/edit; EXACTLY ONE for build/test.** Parallel builds collide (shared target dirs, lockfiles, ports).

The canonical statement, reproduced verbatim (preserve `parrallel`, lowercase `rust`):

> You may use up to 500 parrallel subagents for all operations but only 1 subagent for build/tests of rust.

> [!WARNING]
> **In v0 this rule is enforced by prompt wording only** — there is no structural lock, so a misbehaving loop can still launch parallel builds, and two edit subagents can write the same file. Structural enforcement (an `flock` build **mutex**) is added in §3.7.1; parallel-**edit** write collisions are addressed in §4.2.3.

**Where each architectural piece plugs into Backpressure** — the map §4.5 expands into a full cheat-sheet:

| Architectural piece | Backpressure primitive | Source file |
| --- | --- | --- |
| L2 — Headless invoke | `runAgent` / `buildArgv` / `TARGET_FLAGS` | `src/seam/run.ts`, `src/seam/argv.ts`, `src/seam/targets.ts` |
| L3 — Backpressure gate | `DEFAULT_HOOKS` Stop hook (`pnpm test`) → composite gate | `src/install/init.ts` |
| L4 — Per-run caps (Governor) | `Governor` `{ maxIterations, maxBudgetUsd?, maxConsecutiveFailures }` | `src/loop/governor.ts` |
| L5 — Audit trail | `writeJournalEntry(path, { iteration, taskId, result, duration })` | `src/loop/journal.ts` |
| L5/L7 — Diff review | `reviewer` subagent (tools: Read, Grep) | `DEFAULT_CAPABILITIES`, `src/install/plan.ts` |
| L1 — Memory contract | bundled skill + your `PROMPT.md`/`specs`/`fix_plan`/`CLAUDE.md`·`AGENTS.md` | `skills/`, repo files |

> [!NOTE]
> **Do not conflate the two outcome vocabularies.** The Governor's `IterationOutcome` is the union `"success" | "failure"`; the journal's `result` is a **free-form string** (e.g. `"done"`, `"blocked"`, `"failed"`). They are fed separately — the Governor is your safety cap, the journal is your audit log (§3.8, §3.9).

---

## 3. Implementation Guide

This guide runs in **risk-first order**: the isolation boundary goes up *before* the agent is ever invoked, because the loop's bypass flags (§1.4) hand the model an unrestricted host shell. Each step states the failure mode it closes, the guardrail, the Backpressure wiring, and the Claude-vs-Codex split, and ends with a **Guardrail installed / Failure mode closed** line. Each step is tagged with its **L-id** from the §2.3 injection-point model.

> [!NOTE]
> **Assumption (stated):** you are a senior/intermediate software or platform/DevOps engineer who already drives Claude Code or Codex *interactively*. The commands below assume fluency with bash, git, rootless Docker, and `iptables` — they are not explained line-by-line.

### 3.1 Install order

Install the points in this order; each later step assumes the earlier ones exist.

| § | Step | L-id |
| --- | --- | --- |
| 3.2 | Build the isolated playground (sandbox) | L0 |
| 3.3 | Lock down secrets & network egress | L0 |
| 3.4 | Install + verify the CLI headless, install Backpressure guardrails | L2 prep + L3 install |
| 3.5 | Author the four memory files | L1 |
| 3.6 | Run the planning phase — once | L1 |
| 3.7 | Compose the composite backpressure gate (**the heart**) | L3 |
| 3.8 | Headless invocation, per-iteration caps, the Governor | L2 + L4 |
| 3.9 | Observability install | L5 |
| 3.10 | Known-green checkpoint & deterministic recovery | L6 |
| 3.11 | Assemble the loop harness | L1–L6 |
| 3.12 | First run: attended, then unattended + supervision | — |
| 3.13 | CI / merge gate | L7 |

### 3.2 Build the isolated playground (L0)

**Failure mode this closes:** the canonical loop passes `--dangerously-skip-permissions` (Claude) or `--dangerously-bypass-approvals-and-sandbox` (Codex), each of which **turns OFF the CLI's own sandbox** (§1.4, §2.6). What remains is an unrestricted shell on the host: filesystem, network, and every credential the launching user can reach. Isolation is therefore *literally step one* — there is nothing to "undo" a leaked token after the fact.

> [!IMPORTANT]
> **A git worktree is NOT a sandbox.** A worktree is **version-control isolation**, not a security boundary. `git reset --hard` only rewinds file changes *inside the repo*; it cannot undo a deleted file elsewhere on disk, a leaked secret, an exfiltrated `~/.claude` token, or an outbound network call. The worktree is the **floor**, never the ceiling.

**Isolation tiers** (this table is the single source; §4.1.2 references it):

| Tier | Tech | Security boundary | Use when |
| --- | --- | --- | --- |
| **0 — floor** | `git worktree` on a non-main branch | none (same host, user, network) | trusted greenfield only; never higher-value |
| **1 — baseline** | hardened rootless Docker / devcontainer | shared host kernel; escapable if permissive | trusted repo, want an fs + process boundary |
| **2 — strong** | gVisor (`--runtime=runsc`) | user-space kernel; ~10–30% I/O overhead | LLM-generated code on shared infra |
| **3 — strict** | microVM — Firecracker / Kata | own guest kernel in KVM; ~125 ms boot | untrusted code, multi-tenant, high value |

> [!WARNING]
> **Treat the agent's *output* as untrusted too.** ~45% of AI-generated code fails security tests (Veracode 2025). The sandbox contains both what the model *does* and what it *writes*.

#### 3.2.1 Worktree floor (Tier 0)

```bash
# A throwaway branch off a clean, committed baseline. The branch name is the
# guard the harness (§3.11.2) checks before it will run.
git worktree add ../ralph-loop -b ralph/auto
cd ../ralph-loop
git rev-parse --abbrev-ref HEAD   # must NOT be main/master
```

The non-main branch means every loop's work is trivially `git reset --hard`-able and lands as a reviewable diff — never directly on `main`. This is the **minimum** acceptable posture, and only for a fully trusted greenfield repo.

#### 3.2.2 Hardened container (Tier 1, the recommended baseline)

Build a pinned image (pin the CLI explicitly — see §2.2; `--max-turns` already vanished from Claude's `--help` while staying functional):

```dockerfile
# Dockerfile.ralph
FROM node:20-bookworm-slim
RUN corepack enable && useradd -m -u 1000 agent
ENV DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
# Tools the composite gate (§3.7) needs inside the loop:
RUN apt-get update && apt-get install -y --no-install-recommends \
      iptables ipset dnsutils curl jq ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*
# Pin the CLI — do NOT rely on an auto-updating image.
RUN npm i -g @anthropic-ai/claude-code@2.1.193
USER agent
WORKDIR /work
```

Run it with the blast radius clamped down. **Two networking models** (the firewall in §3.3 needs `NET_ADMIN`+`NET_RAW`, which `--cap-drop ALL` removes — pick one explicitly):

**Model A — single container, firewall installed at startup then privileges dropped** (simplest):

```bash
docker network create ralph-egress 2>/dev/null || true   # user-defined bridge
docker run --rm -it \
  --cap-add NET_ADMIN --cap-add NET_RAW \   # required to install the iptables allowlist
  --security-opt no-new-privileges \
  --read-only --tmpfs /tmp --tmpfs /work/.cache \
  --pids-limit 512 --memory 4g --cpus 2 \
  --network ralph-egress \
  -e CLAUDE_CODE_OAUTH_TOKEN \               # value taken from host env, never echoed/mounted
  -e ALERT_WEBHOOK \                         # for harness paging (§3.11.2)
  -v "$PWD":/work:rw -w /work \              # mount ONLY the repo, nothing else
  ralph-loop:2.1.193 \
  bash -lc 'sudo /usr/local/bin/init-firewall.sh && exec gosu agent ./scripts/ralph-loop.sh'
```

Here the entrypoint runs `init-firewall.sh` (§3.3) as root to install the default-deny allowlist, then `gosu agent` drops to the non-root user for the loop itself, so the agent process runs unprivileged behind a firewall it cannot alter.

**Model B — preferred for untrusted runs: agent on `--network none`, egress via a sidecar proxy.** The agent container gets `--cap-drop ALL` and `--network none`; a separate Squid/mitmproxy sidecar on `ralph-egress` holds the allowlist, and the agent points `HTTPS_PROXY`/`HTTP_PROXY` at it. The agent never has raw network or `NET_ADMIN`.

> [!WARNING]
> **`-u 1000:1000` / non-root is mandatory for Claude.** Claude **refuses** `--dangerously-skip-permissions` as root. In Model A the `gosu agent` drop satisfies this; in Model B add `-u 1000:1000`.

> [!WARNING]
> **Never bind-mount host credentials.** `~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.docker/config.json`, and `~/.npmrc` must stay outside the container. Under bypass mode the agent's *own* token (`~/.claude`) is the prize — inject a short-lived credential via env (`-e CLAUDE_CODE_OAUTH_TOKEN`), never a mounted file (§3.3).

> [!NOTE]
> **Anthropic's own devcontainer caveat (verbatim):** *"When executed with `--dangerously-skip-permissions`, dev containers do not prevent a malicious project from exfiltrating anything accessible inside the container, including the Claude Code credentials stored in `~/.claude`."* A container is a boundary, not a guarantee — pair it with default-deny egress (§3.3) and least-privilege creds.

**Claude vs Codex:** **Codex can avoid full bypass entirely.** Because Codex ships a real OS sandbox (§2.6), you can run *sandboxed-autonomous* — `-s workspace-write -a never`, network off by default — and skip `--dangerously-bypass-approvals-and-sandbox` (decision matrix in §4.1.4). **Claude has no OS sandbox**, so for Claude the container is **mandatory**, and the bypass flag runs *inside* it.

#### 3.2.3 Stronger isolation (Tiers 2–3)

For untrusted or higher-value runs, swap the runtime without changing the command shape:

```bash
# gVisor (Tier 2): register runsc in /etc/docker/daemon.json, then:
docker run --runtime=runsc --rm -it ... ralph-loop:2.1.193
```

Tier 3 (Firecracker via Kata, or a managed microVM provider) is the bar for genuinely untrusted code; see §4.1.2. `firejail --net=none --read-only=...` is a weaker, SUID-root local option — acceptable for a quick trusted-repo run, not a substitute for a VM.

**Guardrail installed:** a container/microVM with a non-root user, clamped capabilities, no mounted host creds, and the firewall topology defined. **Failure mode closed:** an unrestricted host shell escaping the repo. Deep dive: §4.1.

### 3.3 Lock down secrets and network egress (L0)

**Failure mode this closes:** isolation without egress control is a half-measure — an unrestricted shell with host network is an exfiltration path. Two controls: ephemeral credentials, and a default-deny egress allowlist.

**Ephemeral, least-privilege credentials only.** Mint a short-lived token, pass it by env, and **revoke on exit**:

```bash
# Claude: a dedicated OAuth token (rotate/revoke after the run)
export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"
# GitHub: a fine-grained, repo-scoped PAT with a short expiry — never a prod cred.
echo ".env"  >> .gitignore
echo ".env"  >> .dockerignore   # so secrets are neither committed nor baked into the image
```

For multiple secrets, use `--env-file .env` (with `.env` already gitignored/dockerignored).

**Default-deny egress** with an allowlist (Anthropic's `init-firewall.sh` pattern). The ordering is load-bearing: **build the allowlist while egress is still open, open loopback/DNS/established first, and flip the policy to DROP last** — otherwise the script bricks its own setup. Save as `scripts/init-firewall.sh`, run as root inside the container (Model A, §3.2.2):

```bash
#!/usr/bin/env bash
# scripts/init-firewall.sh — default-deny egress with an allowlist. Run as root.
# Requires NET_ADMIN + NET_RAW. Rebuild PER RUN: CDN/GitHub IPs rotate.
set -euo pipefail

# 1. Open the essentials FIRST, while OUTPUT policy is still ACCEPT.
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT     # DNS
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# 2. Build the allowlist ipset while traffic is still permitted.
ipset create allowed-domains hash:net -exist
curl -s https://api.github.com/meta | jq -r '(.web + .api + .git)[]' \
  | while read -r cidr; do ipset add allowed-domains "$cidr" -exist; done
for d in registry.npmjs.org api.anthropic.com api.openai.com chatgpt.com; do
  dig +short "$d" | grep -E '^[0-9.]+$' \
    | while read -r ip; do ipset add allowed-domains "$ip" -exist; done
done
# Add your alert host (§3.11.2) so the harness can page out:
[ -n "${ALERT_HOST:-}" ] && for ip in $(dig +short "$ALERT_HOST"); do ipset add allowed-domains "$ip" -exist; done

# 3. Accept the allowlist, THEN flip default-deny LAST.
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -P OUTPUT DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP

# 4. Self-test — the proof the wall is up.
curl --connect-timeout 5 https://example.com        && { echo "FAIL: egress open";   exit 1; }
curl --connect-timeout 5 https://api.github.com/zen  || { echo "FAIL: allowlist broke"; exit 1; }
echo "firewall: default-deny egress active"
```

> [!NOTE]
> **Claude vs Codex egress.** Claude: allowlist `api.anthropic.com`, `registry.npmjs.org`, GitHub, plus telemetry hosts if OTEL is on (§4.4). Codex: **macOS Seatbelt silently ignores `sandbox_workspace_write.network_access = true`** (openai/codex#10390) — never rely on Codex's own toggle on macOS; use this external firewall and verify the current OpenAI/ChatGPT inference hosts (they change).

**Guardrail installed:** ephemeral scoped tokens plus a default-deny egress wall with a self-test. **Failure mode closed:** secret/data exfiltration over the host network. Deep dive: §4.1.3.

### 3.4 Install the CLI headless, verify flags, and install Backpressure guardrails (L2 prep + L3)

**Failure mode this closes:** a loop launched against an unpinned CLI auto-updates a flag out from under you (`--max-turns` already vanished from `--help`, §2.2), and a bare loop has no gate. This step pins + verifies the CLI and installs the Backpressure guardrails, compiled to each CLI's native config from one source of truth.

#### 3.4.1 Pin and verify the CLI flags

```bash
# Pin (also done in the image, §3.2.2):
DISABLE_AUTOUPDATER=1 npm install -g @anthropic-ai/claude-code@2.1.193

# Verify the load-bearing flags PARSE (unknown flags error; these must not):
claude -p "noop" --dangerously-skip-permissions --max-budget-usd 0.01 --max-turns 1 --help >/dev/null
claude --help | grep -- '--max-budget-usd'   # documented cost cap — present
# --max-turns is hidden from --help in 2.1.193 but still parses; confirm:
claude -p "x" --max-turnzzz 1 2>&1 | grep -q "unknown option" && echo "guardrail: typo rejected"
codex exec --help | grep -E -- '--sandbox|--ask-for-approval'
```

Record the results in your pinned notes; re-run before every campaign (§5.4).

#### 3.4.2 Install Backpressure guardrails — Claude

Preview first, then install. `init` is **atomic** — it verifies every bundled skill *before* writing anything, so a broken skill aborts with `SkillVerificationError` and **nothing is written**:

```bash
backpressure init --target claude --dry-run   # preview the planned files
backpressure init --target claude             # write them
```

| Path | Kind | Contents |
| --- | --- | --- |
| `.claude/settings.json` | hooks | Stop-event gate → `pnpm test` (widened to the composite gate in §3.7) |
| `.claude/agents/reviewer.md` | agent | the `reviewer` subagent (tools: `Read`, `Grep`) |
| `.claude/skills/building-adaptive-ui/` | skill | the whole skill tree, byte-copied (exec bits preserved) |
| `.mcp.json` | — | **NOT written** — `mcpServers` is empty in v0 (§1.6) |

The exact emitted `.claude/settings.json` (2-space indent, trailing newline):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "pnpm test"
          }
        ]
      }
    ]
  }
}
```

#### 3.4.3 Install Backpressure guardrails — Codex

```bash
backpressure init --target codex --dry-run
backpressure init --target codex
```

| Path | Kind | Contents |
| --- | --- | --- |
| `.codex/config.toml` | hooks | Stop-event gate + `[agents.reviewer]` (no `[mcp_servers]` table in v0) |
| `.codex/skills/building-adaptive-ui/` | skill | the whole skill tree, byte-copied |

The exact emitted `.codex/config.toml` in v0:

```toml
[[hooks]]
event = "Stop"
command = "pnpm test"

[agents.reviewer]
description = "Reviews a diff for scope creep and missing tests."
prompt = "You are a careful code reviewer. Report only concrete issues."
tools = [ "Read", "Grep" ]
```

> [!WARNING]
> **Repo bug — the Codex gate as shipped does not load.** This flat `[[hooks]]` table is what `src/adapters/codex/hooks.ts` emits today, but **Codex 0.137.0 does not recognize it** — the CLI expects nested `[[hooks.Stop]]` + `[[hooks.Stop.hooks]]` (or a `~/.codex/hooks.json`). The corrected schema and the **hook-trust** gotcha are covered in §3.7.4. On Codex, **do not assume the installed gate fires** until you have applied that fix.

**Guardrail installed:** a pinned, flag-verified CLI plus a Stop-event test-gate and a diff reviewer, authored once and compiled per target. **Failure mode closed:** a fragile/unpinned CLI and untested code ending a turn unchecked. Compose the real gate in §3.7.

### 3.5 Author the four memory files (L1)

**Failure mode this closes:** each loop is a **fresh context window with amnesia** (§1.2). State lives *entirely* in re-read files; if they are vague, missing, or misnamed, the loop re-invents duplicates, ships stubs, loses intent, or reads nothing at all.

The memory-file contract (full version in §2.5):

| Abstract file | Role | Real per-CLI name |
| --- | --- | --- |
| `PROMPT.md` | standing orders piped every loop | `PROMPT.md` (same) |
| `fix_plan.md` | prioritized `- [ ]` to-do list | `fix_plan.md` / `IMPLEMENTATION_PLAN.md` (same) |
| `specs/*` | the blueprint — *what* to build | `specs/*` (same) |
| `AGENT.md` | how to build/run/test the repo | **`CLAUDE.md`** (Claude) / **`AGENTS.md`** (Codex) |

> [!WARNING]
> **Name-mapping.** The abstract `AGENT.md` is **`CLAUDE.md` for Claude Code** and **`AGENTS.md` for Codex**. Write the wrong filename and the CLI auto-discovers nothing — the loop runs blind.

> [!IMPORTANT]
> **Core insight (keep front-and-center).** When something keeps going wrong, **fix THESE FILES, not the code.** Future loops have no memory of intent, so *capture the why* in specs/tests/docs or the next amnesiac loop deletes what it cannot see. Keep all four files in git — versioned, auditable, revertable.

#### 3.5.1 `PROMPT.md` — the standing orders (embed the Ralph directives verbatim)

```markdown
# Standing orders — re-read every loop

You are one iteration of an autonomous loop with a FRESH context window and no
memory of previous loops. The repository's memory files ARE your memory.

## Do exactly ONE thing this loop
1. Read `specs/` (the blueprint) and `fix_plan.md` (the ordered to-dos).
2. Pick the SINGLE most important unchecked `- [ ]` item. Do only that.
3. Before making changes search codebase (don't assume an item is not implemented) using parrallel subagents. Think hard.
4. Implement it. DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL IMPLEMENTATIONS. DO IT OR I WILL YELL AT YOU
5. Run the FULL composite gate (`./scripts/backpressure-gate.sh`) — not just the
   tests for the code you touched. It must pass before you finish.
6. On green: tick that one box in `fix_plan.md`, commit, and stop.

## Subagent rule (disposable memory)
You may use up to 500 parrallel subagents for all operations but only 1 subagent for build/tests of rust.
(Many subagents for search/research/edit; EXACTLY ONE for build/test — parallel builds collide.)

## When you write a test or doc, capture the WHY — the next loop has no memory of intent.
```

> [!NOTE]
> The directives in lines 3, 4, and the subagent rule are reproduced **verbatim** from Huntley's prompt — preserve the misspelling `parrallel`, the lowercase `rust`, and the ALL-CAPS emphasis (§5.5). The gate instruction deliberately says **run the full composite gate**, which is stronger than "run the tests for the code you touched."

#### 3.5.2 `fix_plan.md` — the ordered to-do list

```markdown
# Fix Plan — prioritized, one item per loop

- [ ] Define the public API surface in `specs/api.md` and stub the entrypoint.
- [ ] Implement request validation against `specs/api.md`.
- [ ] Implement the persistence layer per `specs/storage.md`.
- [ ] Wire integration tests covering the acceptance checks in `specs/overview.md`.
```

The loop ticks **exactly one** `- [ ]` per pass and commits — that checkbox is the v0 task-claim mechanism (atomic claiming arrives post-v0 with `src/tracker/`, §4.6).

#### 3.5.3 `specs/overview.md` — the blueprint (one file per concern)

```markdown
# Overview — what we are building

## Goal
A small HTTP service that <one precise sentence>.

## Acceptance criteria (the positive "done" signal — not just "no boxes left")
- [ ] `POST /v1/items` validates the body and returns 201 with the created id.
- [ ] Invalid bodies return 422 with a machine-readable error list.
- [ ] All endpoints are covered by an integration test tagged @acceptance (§3.7.3).

## Out of scope
- Auth, rate limiting, and multi-tenancy are explicitly deferred.

## Why these choices
Capture intent here so a future amnesiac loop does not "simplify" it away.
```

Split distinct concerns into `specs/api.md`, `specs/storage.md`, etc. — one file per concern keeps each spec small enough to load and precise enough to steer generation. The acceptance criteria become the `@acceptance` suite that is the only *positive* "done" signal (§3.7.3, §4.3.5).

#### 3.5.4 `AGENT.md` → `CLAUDE.md` / `AGENTS.md` — how to build/run/test

```markdown
# How to work in this repo

## Build / run / test — the composite gate
The single source of truth for "is this change OK" is:

    ./scripts/backpressure-gate.sh

It chains format → typecheck → stub-guard → dedup → build/test → acceptance →
secret-scan → dep-guard and exits non-zero on the first failure. The Stop hook
runs it; CI runs the SAME script.

## Conventions
- TypeScript, Node 20+, ESM. Tests use vitest. Every `src/` file has a sibling
  test under `test/` added in the same change.
- Isolate side effects behind small wrappers so they can be mocked.

## Hard rules
- One productive commit per loop; commit message: `iter <task-id>: <summary>`.
- Never push to main; never run `npm publish`; never `pnpm add` without approval.
```

Write this to **`CLAUDE.md`** for a Claude loop and **`AGENTS.md`** for a Codex loop (the composite gate script itself is wired in §3.7).

**Guardrail installed:** a complete, versioned memory contract the amnesiac loop rebuilds from every pass. **Failure mode closed:** re-invented duplicates, stub code, lost intent, and a loop that reads nothing.

### 3.6 Run the human-steered planning phase — ONCE (L1)

**Failure mode this closes:** newcomers skip planning and the loop wanders — it has no blueprint to converge on and no ordered to-dos to claim. The fix is the **Planning plane** (§2.4): run **once**, human-steered, a single agent plus disposable subagents, producing `specs/*.md` and `fix_plan.md` before any loop turns.

> [!NOTE]
> **"Manual context up front, automatic context in the loop."** Planning is the one phase where a human stays in the chair. The implementation loop then allocates context *identically* every pass. The beginner walkthrough lives in `docs/RALPH_GUIDE.md`; this step adds only **production discipline** — commit the artifacts, set a regeneration cadence.

#### 3.6.1 Requirements → `specs/*.md` (what to build)

Drive an *interactive* session (not headless) to discuss the task, then fan **disposable subagents** to load source material and write specs, one file per concern:

```text
You are the planning lead. We are building <X>. Do NOT write implementation code.

1. Interview me about requirements until they are unambiguous.
2. Dispatch subagents to read these URLs / papers / release notes: <links>.
   Each subagent's context is GARBAGE-COLLECTED on return — have it return only
   the distilled facts we need.
3. Write specs ONE FILE PER CONCERN into specs/ (api, storage, acceptance, ...).
   Each spec states what to build and WHY. No code.
```

Subagents here are **disposable memory** (§2.8): each gets its own fresh context window that is discarded on return, letting a single planning agent read far more than one window holds.

#### 3.6.2 TODO → `fix_plan.md` (the ordered plan)

Once specs exist, fan subagents across the existing tree in parallel to map reality, then write the ordered checklist:

```text
Study every file in specs/. Then dispatch subagents to survey the existing src/
in parallel — report what already exists so we do not re-implement it.

You may use up to 500 parrallel subagents for all operations but only 1 subagent
for build/tests of rust.

Write fix_plan.md: an ORDERED list of `- [ ]` items, smallest-shippable-first,
each traceable to a spec. No item should bundle two concerns.
```

> [!IMPORTANT]
> **The hard concurrency rule (§2.8), verbatim:** *"You may use up to 500 parrallel subagents for all operations but only 1 subagent for build/tests of rust."* MANY subagents for search/research/edit; **EXACTLY ONE** for build/test — parallel builds collide. In v0 this is enforced **only by prompt wording**; the structural `flock` build mutex is added in §3.7.1.

#### 3.6.3 Commit the baseline, then set a drift cadence

```bash
git add specs fix_plan.md PROMPT.md CLAUDE.md   # or AGENTS.md for Codex
git commit -m "plan: specs + ordered fix_plan baseline"
```

The loop must start from a **clean, committed baseline** so every later iteration is a reviewable, revertable delta. **Specs are the source of truth; `fix_plan.md` is derived** — when the plan drifts stale, regenerate it from `specs/*` rather than hand-patching (cadence and trigger in §4.3.4).

**Guardrail installed:** a committed `specs/*` blueprint and an ordered `fix_plan.md` the loop converges on. **Failure mode closed:** a directionless loop with nothing concrete to claim.

### 3.7 Compose the composite backpressure gate (L3) — the heart of this guide

**Failure mode this closes:** the v0 Stop hook runs a single `pnpm test` (§3.4). That is *one* leg of backpressure. Without lint/typecheck/build/secret/dependency stages and a *positive* acceptance signal, bad code, leaked secrets, duplicate implementations, stubs, and rogue dependencies flow straight through the gate. This step replaces the bare `pnpm test` with **one composite script, one exit code** — the honest wall the whole loop centers on.

#### 3.7.1 The `flock` build mutex (structural enforcement of EXACTLY-ONE build/test)

The §2.8 hard rule is prompt-wording only in v0. Make it structural: wrap the build/test stage in an `flock(1)` lock so a second concurrent build **fails fast** instead of colliding. This survives a misbehaving agent that ignores the prompt.

```bash
# Used inside the gate (§3.7.2): -n = fail immediately if the lock is held.
flock -n /tmp/ralph-build.lock -c 'pnpm test && pnpm run build'
```

#### 3.7.2 `scripts/backpressure-gate.sh`

Author it once; the Stop hook (§3.7.3) and CI (§3.13) both call this exact script, eliminating local-vs-CI drift.

```bash
#!/usr/bin/env bash
# scripts/backpressure-gate.sh — the composite backpressure gate. ONE exit code.
# Fail-fast: the first red stage stops the loop. Chmod +x and commit it.
set -euo pipefail

echo "== 1. format + lint (biome) =="
pnpm exec biome check .

echo "== 2. typecheck =="
pnpm exec tsc --noEmit

echo "== 3. stub / placeholder guard (prevents incident 4, §5.1) =="
if git rev-parse --verify -q main >/dev/null; then
  changed="$(git diff --name-only main... || true)"
  if [ -n "$changed" ] && echo "$changed" | xargs -r grep -nE 'TODO|FIXME|unimplemented!|not implemented'; then
    echo "gate: placeholder/stub code in changed files"; exit 1
  fi
fi

echo "== 4. duplicate-symbol guard (prevents incident 3, §5.1) =="
pnpm exec jscpd --min-tokens 50 --threshold 0 --silent src/ \
  || { echo "gate: duplicate code detected"; exit 1; }

echo "== 5. build + tests — EXACTLY ONE at a time (flock mutex, §3.7.1) =="
flock -n /tmp/ralph-build.lock -c 'pnpm test && pnpm run build' \
  || { echo "gate: build/test busy or failed"; exit 1; }

echo "== 6. spec-level acceptance — the only POSITIVE done signal (§4.3.5) =="
pnpm run test:acceptance          # vitest run -t @acceptance (see §3.7.3)

echo "== 7. secret scan (secrets = backpressure, §4.1.5) =="
gitleaks detect --no-banner --redact

echo "== 8. dependency guard (§4.1.6) — no unreviewed new deps; audit CVEs =="
git diff --quiet -- pnpm-lock.yaml \
  || { echo "gate: pnpm-lock.yaml changed — new deps need review"; exit 1; }
pnpm audit --audit-level=high

echo "gate: GREEN"
```

> [!NOTE]
> Tune stages per language: for a Rust loop swap stages 1–5 for `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `cargo build` — the *honest compiler* is your strongest backpressure (§1.5). The shape (fail-fast, one exit code, flock-wrapped build, a positive acceptance stage) is the same.

#### 3.7.3 Wire the gate as the Stop hook (and as CI)

Point the installed Stop hook at the script instead of bare `pnpm test`. Edit `DEFAULT_HOOKS` (`src/install/init.ts`) once and re-`init`, or hand-edit the emitted config:

```json
// .claude/settings.json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "./scripts/backpressure-gate.sh" } ] } ] } }
```

Add the acceptance script to `package.json` so stage 6 is real:

```json
{ "scripts": { "test:acceptance": "vitest run -t @acceptance" } }
```

Author the `@acceptance` suite **1:1 from the `specs/*` acceptance criteria** (§3.5.3) — an end-to-end/smoke test per criterion. This is what makes "plan complete" a *positive* signal rather than merely "no `- [ ]` left" (§4.3.5).

#### 3.7.4 Codex: the nested hooks schema fix + the exit-code contract

Two Codex-specific facts make or break the gate as backpressure:

**(a) Schema.** Replace the flat `[[hooks]]` table the adapter emits (§2.7) with the **nested** schema Codex 0.137.0 actually loads:

```toml
# .codex/config.toml — the schema Codex 0.137.0 recognizes
[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = "./scripts/backpressure-gate.sh"
timeout = 600
```

**(b) Trust.** Codex refuses a freshly-installed/changed command hook until you review and **trust** it; an untrusted hook is **silently skipped**, not failed — so the gate never fires and bad code flows straight through. Pre-trust the hook, or for an unattended loop pass `--dangerously-bypass-hook-trust`. Claude has **no** hook-trust gate.

> [!NOTE]
> **The exit-code contract (L3).** For Claude, a hook **exit code 2 is a blocking error whose stderr is fed back to the model** — that is mechanically what makes the gate real backpressure *within* one iteration. This is version-sensitive (verify per §5.4), and Codex Stop-hook failure semantics are newer/unverified. Because the seam's `runAgent` surfaces **only the CLI process exit code** (not the hook result), the harness **re-runs the gate** to derive a deterministic Governor outcome (§3.11.1) — this is why the gate appears to "run twice."

**Guardrail installed:** one composite, exit-coded, flock-wrapped gate with a positive acceptance stage, wired identically as the Stop hook and (later) CI. **Failure mode closed:** bad code, secrets, stubs, duplicates, and rogue dependencies crossing a weak single-`pnpm test` gate.

### 3.8 Configure headless invocation, per-iteration caps, and the Governor (L2 + L4)

You have a sandbox (§3.2), egress lockdown (§3.3), a verified CLI (§3.4), memory files (§3.5), a committed plan (§3.6), and a composite gate wired as the Stop hook (§3.7). This step builds the **actual invocation line** and bolts on the caps that stop a single pass from running away.

**The verified loop one-liners** (also the building blocks for the harness in §3.11):

```bash
# Claude Code — external sandbox is MANDATORY (no OS sandbox; run INSIDE the §3.2 container)
timeout 1800 claude -p "$(cat PROMPT.md)" \
  --dangerously-skip-permissions \
  --model opus \
  --max-budget-usd 2.00 \
  --max-turns 40 \
  --output-format stream-json --verbose --include-partial-messages \
  | tee -a loop.jsonl
```

```bash
# Codex — SAFER default: sandbox ON, approvals OFF (no full bypass needed)
timeout 1200 codex exec "$(cat PROMPT.md)" \
  -s workspace-write -a never \
  --model gpt-5.5-codex \
  --json | tee -a loop.jsonl

# Codex — full bypass: ONLY inside an already-isolated container (§3.2)
timeout 1200 codex exec "$(cat PROMPT.md)" \
  --dangerously-bypass-approvals-and-sandbox \
  --dangerously-bypass-hook-trust \
  --model gpt-5.5-codex --json
```

> [!WARNING]
> **Cost-cap asymmetry (load-bearing).** Claude has `--max-budget-usd` (documented) **and** `--max-turns` (works in 2.1.193 but is now undocumented — treat as fragile; §2.2). **Codex has NEITHER** — so on Codex an external `timeout` and the Governor budget are **mandatory**, plus account-level spend caps set in the OpenAI org/project dashboard. Codex full bypass also requires `--dangerously-bypass-hook-trust` or the Stop gate is silently skipped (§3.7.4).

To feed the run-level budget cap, parse spend from Claude's JSON output and hand it to the Governor:

```bash
# Per-iteration cost for the Governor (Claude only; Codex has no per-call USD figure)
cost=$(claude -p "$(cat PROMPT.md)" --dangerously-skip-permissions \
        --model opus --max-turns 40 --output-format json | jq -r '.total_cost_usd')
```

**The Governor** (`src/loop/governor.ts`) is the per-run cap — a pure, in-memory primitive Backpressure ships but does **not** auto-run. Exact API:

```ts
const gov = new Governor({
  maxIterations: 40,
  maxConsecutiveFailures: 3,
  maxBudgetUsd: 20, // optional; INERT unless you feed real costUsd to record()
});

gov.record("success", cost); // record(outcome: "success" | "failure", costUsd = 0): void
const verdict = gov.decide(); // { halt: boolean; reason?: string }
```

`decide()` checks limits in **fixed precedence with `>=`, first breach wins**: iterations → consecutiveFailures → budget. `record("failure", …)` increments the consecutive-failure run; `record("success", …)` resets it to 0.

> [!WARNING]
> **`maxBudgetUsd` does nothing unless you feed real `costUsd`.** With the default `record(outcome)` (costUsd = 0) the spend total never grows and the budget cap never fires. If you cannot measure per-iteration spend (the Codex case), **drop `maxBudgetUsd` and govern with `maxIterations` + `timeout`**. The seam emits no `--max-budget-usd` flag (§2.7) — add it to the raw loop line yourself, or extend `AgentOpts`/`TargetFlags` (§4.5).

**Layered kill switches** — combine the typed primitive with OS- and shell-level brakes:

| Control | Mechanism | Where |
| --- | --- | --- |
| Iteration ceiling | `Governor.maxIterations` / bash `(( i <= max ))` | Governor / harness |
| Max consecutive failures | `Governor.maxConsecutiveFailures` (resets on success) | Governor |
| Per-iteration timeout | `timeout 1800 claude -p …` / `timeout 1200 codex exec …` | harness |
| **Campaign wall-clock** | outer deadline: `[ "$(date +%s)" -ge "$DEADLINE" ] && break` | harness |
| **Disk guard** | `df` floor: bail if free space < N (full disk corrupts the journal) | harness |
| Manual STOP flag | `[ -f STOP ] && break` (touch `STOP` from another shell) | harness |
| Signal handling | `trap 'kill "$child" 2>/dev/null; exit 130' INT TERM` | harness |
| **Stall detection** | commit SHA unchanged for K loops — **NOT in Governor**; add externally (§3.11.2) | harness |

**Guardrail installed:** per-iteration + per-run + per-campaign caps. **Failure mode closed:** a single runaway, expensive, idle, or disk-filling pass.

### 3.9 Observability install (L5)

**Failure mode this closes:** an unattended loop with no record is unaudited and undebuggable — you cannot tell convergence from thrashing, or attribute cost. `init` does **not** auto-assemble observability; wire it here. The §4.4 reference expands on metrics and alert thresholds; this step installs the three legs.

**1. Per-iteration JSONL journal.** `writeJournalEntry(path, { iteration, taskId, result, duration })` (`src/loop/journal.ts`) appends one line per loop; append I/O is injectable. Wired into both harnesses in §3.11.

**2. `git log` as the audit trail.** One productive commit per loop makes `git log --oneline` the history and `git diff <before>..<after>` exactly the per-iteration change the `reviewer` subagent reviews. Commit granularity is also the recovery substrate (§3.10).

**3. Per-iteration structured logs — redacted before persisting.** Tee `--output-format json` (Claude) / `--json` (Codex) to `logs/iter-$n.json`, but **scrub secrets first** (the agent can echo a token into its output):

```bash
# Redact before the log ever hits disk (§4.1.5).
timeout 1800 claude -p "$(cat PROMPT.md)" --dangerously-skip-permissions \
  --model opus --max-turns 40 --output-format json \
  | gitleaks stdin --redact 2>/dev/null \
  | tee "logs/iter-$n.json"
```

Watch `system/init` (fail the loop if a required plugin/MCP/skill didn't load) and `system/api_retry` (rate-limit telemetry).

**OTEL fleet metrics** (optional, for multi-loop campaigns): `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_ENDPOINT=<collector>` → dashboard **loops/hr, gate pass-rate, $/loop, stall streak** and alert via Alertmanager on the §4.4 thresholds. Add the collector/alert host to the egress allowlist (§3.3).

> [!NOTE]
> **Log retention.** `logs/`, `loop.jsonl`, and the journal grow unbounded over an overnight campaign. Rotate per-run into a timestamped dir, cap with `logrotate` / `--log-opt max-size`, and pair with the disk-guard kill switch (§3.8) so a full disk halts the loop instead of corrupting the journal.

**Guardrail installed:** a redacted, rotated, three-legged audit record per iteration. **Failure mode closed:** an unauditable loop and secrets persisted to logs.

### 3.10 Known-green checkpoint & deterministic recovery (L6)

Huntley's recovery advice is hand-wavy — *"git reset --hard or a recovery prompt."* Production turns that into a protocol with three named pieces: a **known-green ref**, an **automatic rollback**, and a **bounded escalation**.

```bash
# After a FULL green gate, advance the known-green ref to this commit.
mark_green() { git update-ref refs/green HEAD; }

# On a RED gate, roll the bad iteration back to the last green commit.
recover_to_green() {
  if git rev-parse --verify -q refs/green >/dev/null; then
    echo "RED gate — resetting to last green ($(git rev-parse --short refs/green))"
    git reset --hard refs/green
  else
    echo "RED gate but no green checkpoint yet — resetting to start of iteration"
    git reset --hard "$before" # $before captured at top of loop (§3.11.2)
  fi
}
```

Recovery is **bounded**: cap consecutive recovery attempts (the Governor's `maxConsecutiveFailures` already does this), then **halt and page a human** (the `notify()` path in §3.11.2) rather than thrash. The alternative to a hard reset is handing the failing diff to a **bounded recovery prompt** (a separate `PROMPT.recovery.md` that says "the gate failed with this output; fix it or revert your last change"), capped at e.g. 2 attempts before reset.

> [!NOTE]
> **Commit granularity is the recovery substrate.** One productive commit per loop (§3.9) keeps history bisectable and makes `refs/green` meaningful. `git reset --hard` only undoes **in-repo** file changes — it cannot undo a deleted external file, a leaked secret, or an exfiltrated `~/.claude` token (§1.4). Recovery is correctness insurance, **not** a security control; that is the sandbox's job (§3.2). Full incident runbook: §5.1; recovery as a standing practice: §4.3.2.

**Guardrail installed:** deterministic rollback to a known-good tree with bounded escalation. **Failure mode closed:** a non-compiling tree poisoning later iterations, and resetting away good work.

### 3.11 Assemble the loop harness (brings L1–L6 together)

Backpressure ships **primitives, not a runner** (§1.6, §2.7). You assemble the loop yourself and **run it inside the §3.2 sandbox**. Two equivalent harnesses follow: bash (drives the installed CLI + Stop-hook gate) and TypeScript (assembles the typed primitives).

#### 3.11.1 Harness A — TypeScript (Governor + journal + seam)

This wires the exact repo APIs. The seam returns **only the CLI process exit code** and does **not** surface the Stop-hook result, so the harness **re-runs the gate** to derive a deterministic Governor outcome.

```ts
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Governor } from "./src/loop/governor.js";
import { writeJournalEntry, type JournalEntry } from "./src/loop/journal.js";
import { runAgent } from "./src/seam/run.js";
import type { AgentTarget } from "./src/seam/targets.js";

const TARGET: AgentTarget = "claude";
const JOURNAL = "loop-journal.jsonl";

// Helper the critic flagged: derive taskId from the first unchecked plan item.
function currentPlanItemId(): string {
  const line = readFileSync("fix_plan.md", "utf8")
    .split("\n")
    .find((l) => l.startsWith("- [ ]"));
  return line ? line.replace("- [ ]", "").trim().slice(0, 60) : "unknown";
}

const gov = new Governor({
  maxIterations: 40,
  maxConsecutiveFailures: 3,
  // maxBudgetUsd: 20, // only effective if you pass measured costUsd to record()
});

let iteration = 0;
for (;;) {
  const verdict = gov.decide(); // decide() BEFORE running => exactly maxIterations run
  if (verdict.halt) {
    console.error(`halt: ${verdict.reason}`);
    break;
  }

  iteration += 1;
  const prompt = readFileSync("PROMPT.md", "utf8");
  const start = Date.now();

  // runAgent spawns: claude -p "<prompt>" --dangerously-skip-permissions --model opus --max-turns 40
  // (buildArgv order: [headless?, prompt, permission?, --model <name>?, --max-turns <n>?])
  const exit = await runAgent(TARGET, prompt, { model: "opus", maxTurns: 40 });

  // The Stop hook (composite gate) already ran INSIDE the CLI, but the seam does
  // not surface its result — re-run the gate here to get a deterministic signal.
  const gate = spawnSync("./scripts/backpressure-gate.sh", [], { stdio: "inherit" });
  const passed = exit === 0 && gate.status === 0;

  gov.record(passed ? "success" : "failure"); // pass measured USD as 2nd arg to arm maxBudgetUsd

  const entry: JournalEntry = {
    iteration,
    taskId: currentPlanItemId(),
    result: passed ? "done" : "failed", // FREE-FORM string, NOT the Governor's outcome union
    duration: Date.now() - start,
  };
  await writeJournalEntry(JOURNAL, entry);
}
```

> [!WARNING]
> **Three gaps to internalize.** (1) The seam passes the prompt as an **argv positional**, not piped stdin — a multi-KB `PROMPT.md` becomes one very long argument with no ARG_MAX handling (use the bash piped form in §3.11.2 for large prompts). (2) `JournalEntry.result` is a **free-form string** (`"done"`/`"blocked"`/`"failed"`), distinct from the Governor's `"success" | "failure"` — do not conflate them. (3) Import paths assume you run **in-repo** (`src/…`) or after `pnpm run build` (`dist/…`); there is no public export map in v0.

#### 3.11.2 Harness B — bash (installed CLI + Stop-hook gate)

A complete, copy-pasteable harness combining every rail from §3.7–§3.10: branch guard, required-file checks, iteration ceiling, campaign deadline, disk guard, per-iteration `timeout`, the **backpressure gate**, **stall detection**, **green-checkpoint recovery**, a `notify()` paging path, STOP flag, and a signal trap.

```bash
#!/usr/bin/env bash
# scripts/ralph-loop.sh — run INSIDE the §3.2 sandbox, behind the §3.3 firewall.
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
MAX_ITERS=40
MAX_STALLS=3
ITER_TIMEOUT=1800                       # Claude per-iteration wall-clock seconds
DEADLINE=$(( $(date +%s) + 8*3600 ))    # campaign wall-clock: 8h from now
MIN_FREE_MB=1024                        # disk-guard floor
GATE=./scripts/backpressure-gate.sh

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
      --model opus \
      --max-budget-usd 2.00 \
      --max-turns 40 \
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
```

The **Codex variant** swaps only the agent line — there is **no `--max-turns`** and the gate lives in `.codex/config.toml`, so the `timeout` is the only per-iteration cap:

```bash
  # Codex: sandbox ON, approvals OFF (network off by default in workspace-write)
  timeout 1200 \
    codex exec "$(cat PROMPT.md)" \
      -s workspace-write -a never \
      --model gpt-5.5-codex \
    & child=$!; wait "$child" || echo "agent exited non-zero ($?)"
```

> [!NOTE]
> For a multi-KB `PROMPT.md`, prefer the **piped** form `cat PROMPT.md | claude -p …` over the argv positional shown above (ARG_MAX). One-thing-per-loop task claiming is **prose discipline** in v0 — the prompt instructs the agent to tick exactly one `- [ ]` per pass and commit. Atomic claiming with in-progress/done states arrives with `src/tracker/` post-v0 (§4.6).

#### 3.11.3 The managed alternative — Claude Code's built-in `/loop`

`/loop` is a **session-level** slash command that re-runs a prompt on an interval (omit the interval to let the model self-pace). It is convenient for **attended** iteration but is **not** a `-p` headless loop runner:

```text
/loop 5m study specs/ and fix_plan.md, implement the ONE most important item, run the gate, tick it off
```

> [!WARNING]
> **`/loop` is not the unattended mechanism.** It runs inside a live session (no fresh-context-per-iteration amnesia guarantee, no external `timeout`/STOP-file/sandbox boundary, and it does not re-pipe `PROMPT.md` the way the bash form does). For production, the unattended loop stays the bash `while` harness or the TypeScript harness above. See §2.6 for the full `/loop` clarification.

**Guardrail installed:** the assembled loop, with all of L1–L6 wired and a paging path. **Failure mode closed:** ad-hoc, un-capped, un-audited iteration that halts silently.

### 3.12 First run: attended, then unattended

Do **not** walk away on iteration one. Run the first few loops **attended** and tune by **editing the memory files, not the code** — this is the technique's core operating discipline.

- **Tighten `PROMPT.md`** when the agent wanders, re-implements existing code, or skips the gate.
- **Sharpen a `specs/*` file** when output is vaguely wrong — *your skill shows up in the output; vague specs ⇒ garbage*.
- **Reprioritize `fix_plan.md`** when the agent picks low-value items first; **regenerate it from `specs/`** when it drifts stale (§4.3.4).
- **Guard against false completion** — all `- [ ]` boxes ticked but specs not actually met. Caps give termination, not a positive "done" signal; the `@acceptance` stage (§3.7.3, §4.3.5) is that positive signal.

> [!NOTE]
> **Fix the files, not the code.** When something keeps going wrong, the durable fix lives in `PROMPT.md` / `specs/*` / `fix_plan.md` / `CLAUDE.md`(Claude) / `AGENTS.md`(Codex) — the next amnesiac loop has no memory of a one-off code patch, but it re-reads the memory files every pass (§2.5). Commit the file fix so the memory contract stays versioned and revertable.

**Harness supervision (for true overnight operation).** The harness *process* itself is unmanaged — if it dies (OOM, host reboot, dropped SSH, container exit) the campaign just stops. Run it under a supervisor that restarts and resumes from `refs/green`:

```ini
# /etc/systemd/system/ralph.service — Restart on failure, hard campaign ceiling.
[Service]
ExecStart=/usr/bin/docker run --rm ... ralph-loop:2.1.193 ./scripts/ralph-loop.sh
Restart=on-failure
RestartSec=10
RuntimeMaxSec=28800        # 8h campaign hard stop
```

A restarted harness resumes from the last green commit (the loop re-reads `fix_plan.md` and `refs/green`), so progress is not lost. Alternatives: `docker run --restart=on-failure`, or `tmux`/`nohup` for trusted runs.

**Go / no-go checklist before walking away:**

- [ ] **Isolated** — running in a container / microVM, **not** just a worktree (§3.2)
- [ ] **Egress** default-deny + self-test passing (`curl example.com` fails, `curl api.github.com/zen` passes) (§3.3)
- [ ] **Ephemeral scoped creds** only, injected by env; no prod credentials reachable (§3.3)
- [ ] **Composite gate** wired as the Stop hook (§3.7) — and on Codex, the hook is **trusted** and uses the **nested** `[[hooks.Stop]]` schema (§3.7.4)
- [ ] **Caps set** — Governor + per-iteration `timeout` + campaign deadline + disk guard + STOP flag + signal trap + stall detection (§3.8)
- [ ] **Known-green ref** + bounded recovery + `notify()` paging (§3.10, §3.11.2)
- [ ] **Supervisor** with restart/resume (this section)
- [ ] **First run attended** — tuned via the files, not the code

**Guardrail installed:** a human-validated, supervised loop with a positive go/no-go gate. **Failure mode closed:** an unattended run that was never observed to converge, or that dies silently overnight.

### 3.13 CI / merge gate (L7)

**Failure mode this closes:** the loop's output is delivered straight to `main` with no human or independent re-check. The loop runs on a throwaway non-main branch and opens a **PR — never auto-merge**. CI re-runs the **same** `scripts/backpressure-gate.sh` as a required status check (defense in depth: backpressure inside the loop *and* on the PR), and a human approves before merge.

**The workflow** (`.github/workflows/backpressure-gate.yml`, Actions pinned by SHA, read-only token):

```yaml
name: backpressure-gate
on: pull_request
permissions:
  contents: read            # least privilege; loop cannot push from CI
jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11   # v4 pinned by SHA
      - uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d   # v4 pinned by SHA
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b  # v4 pinned by SHA
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: bash scripts/backpressure-gate.sh
```

**Branch protection** — make the gate + review required, no auto-merge:

```bash
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=gate' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F enforce_admins=true \
  -F restrictions=null
```

**OIDC for cloud creds** (never a long-lived secret in the loop step):

```yaml
permissions:
  contents: read
  id-token: write            # request a short-lived OIDC token at run time
# then e.g. aws-actions/configure-aws-credentials with role-to-assume + no static keys
```

> [!NOTE]
> The bundled `reviewer` subagent is a **pre-filter, not a substitute** for the human approval enforced here. Ralph **multiplies a senior engineer; it does not replace one** (§4.6).

**Guardrail installed:** PR-only delivery, CI re-running the same gate as a required check, branch protection, human approval, OIDC creds. **Failure mode closed:** unreviewed agent output reaching `main`.

---

## 4. Best Practices & Production Considerations

*Cross-cutting controls for steady-state operation of an already-built loop (§3 stood it up). Each control names the **L0–L7 injection point** it hardens (defined in §2.3) and recaps §3 as a standing practice, not a one-time setup step. The organizing fact, restated from §1.4: both loop one-liners pass a bypass flag that **turns OFF the CLI's own sandbox**, so every isolation, cost, observability, and recovery burden lives in machinery you operate — this section is the operations manual for that machinery.*

### 4.1 Security

#### 4.1.1 The bypass thesis, formalized (L0–L7)

The Ralph loop only runs unattended because it disables the CLI's in-process guardrails:

| CLI | Loop flag | What it actually is | Net effect |
| --- | --- | --- | --- |
| Claude Code | `--dangerously-skip-permissions` | `= --permission-mode bypassPermissions` (**no OS sandbox exists either way**) | removes all permission prompts → unrestricted host shell |
| Codex | `--dangerously-bypass-approvals-and-sandbox` | `= --sandbox danger-full-access` (alias `--yolo`) | removes approvals **and** the real OS sandbox (Seatbelt/Landlock) |

**Both flags disable the CLI's own sandbox to buy autonomy.** Therefore every control below lives *outside* the CLI. The single biggest production failure is bypassing the in-CLI sandbox and not replacing it. Two standing corollaries:

> [!WARNING]
> **Treat the loop's own output as untrusted, not just its inputs.** An industry baseline to plan around: **45% of AI-generated code fails security tests** (Veracode 2025). The agent is a junior contributor with root on the box — sandbox it, scan its commits, and gate its PRs.

> [!NOTE]
> **Prefer "sandbox ON, approvals OFF" over "sandbox OFF" wherever the CLI allows it** (deep dive in §4.1.4). Reserve full bypass for *inside* a container.

#### 4.1.2 Isolation reference (L0)

> [!WARNING]
> **A git worktree is version-control isolation, NOT a security sandbox.** `git reset --hard` only undoes file changes *inside the repo* — it cannot undo a deleted file elsewhere on the host, a leaked secret, or an exfiltrated `~/.claude` credential. The worktree is the floor (§3.2.1), not the boundary.

The four-tier model (worktree → rootless Docker → gVisor → microVM) and the full annotated `docker run` live in **§3.2** — that is the single source for the tier table and container-hardening flags. As a standing practice: keep the chosen tier matched to the trust level of the run, never bind-mount host credentials (`~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.docker/config.json`, `~/.npmrc`), and remember the agent's *own* `~/.claude` token is the prize.

> [!WARNING]
> Anthropic's reference devcontainer warning, verbatim: *"dev containers do not prevent a malicious project from exfiltrating anything accessible inside the container, including the Claude Code credentials stored in `~/.claude`."* A container is a boundary, not a guarantee — pair it with default-deny egress (§4.1.3) and least-privilege creds (§4.1.5).

#### 4.1.3 Network egress (L0)

Under bypass, unrestricted shell = an exfiltration path, so **default-deny egress is mandatory**. The full ordered `init-firewall.sh` and the self-test live in **§3.3** (build the allowlist while egress is open; open loopback/DNS/established first; flip `OUTPUT DROP` last; rebuild per run because CDN/GitHub IPs rotate). The standing self-test that must stay in the gate:

```bash
curl --connect-timeout 5 https://example.com         && echo FAIL   # MUST be blocked
curl --connect-timeout 5 https://api.github.com/zen  || echo FAIL   # MUST succeed
```

Requires `NET_ADMIN` + `NET_RAW`; reconcile with `--cap-drop ALL` via Model A or Model B in §3.2.2. The sidecar-proxy alternative (Squid/mitmproxy + `--network none`) is equivalent.

| CLI | Egress note |
| --- | --- |
| Claude | allowlist `api.anthropic.com`, `registry.npmjs.org`, GitHub, plus telemetry/alert hosts if OTEL/`notify()` are on (§3.9, §3.11.2) |
| Codex | **macOS Seatbelt silently ignores `sandbox_workspace_write.network_access = true`** (openai/codex#10390). Never rely on Codex's own toggle on macOS — use the external firewall, and add the current OpenAI/ChatGPT inference hosts to the ipset (verify; they change) |

#### 4.1.4 "Sandbox ON, approvals OFF" deep-dive (L2)

Full bypass is the *last* resort, used only inside the §4.1.2 container. Graduated autonomy first:

| CLI | Safer autonomous posture | Why it's safer |
| --- | --- | --- |
| **Codex** | `codex exec -s workspace-write -a never` | a **real OS sandbox** confines writes to the workspace; **network is OFF by default** in `workspace-write`; `-a never` means it still never prompts |
| **Claude Code** | `--permission-mode auto` (classifier-gated) or scoped `--allowedTools` / `--disallowedTools` / `--tools "Bash,Edit,Read"` | narrows the tool surface — but **Claude has no OS sandbox**, so the container is still mandatory |

> [!NOTE]
> The Backpressure seam and the canonical Ralph one-liner both default to **full bypass** (`buildArgv` sets `permission: true` → emits the dangerous flag). That is acceptable **only inside** the §4.1.2 sandbox. If you can run Codex `workspace-write`, do — it is strictly safer than the seam default.

#### 4.1.5 Secrets & secret scanning as extra backpressure (L0 + L1 + L3)

- **Ephemeral, least-privilege tokens only.** `claude setup-token` → pass `CLAUDE_CODE_OAUTH_TOKEN` via env (not a mounted file); or a fine-grained **repo-scoped** GitHub PAT with short expiry; or OIDC workload identity in CI (§3.13). **Rotate/revoke on loop exit.** No production credentials reachable (a worktree does *not* scope these — §4.1.2).
- **`.env` exclusion:** secrets in **both** `.gitignore` and `.dockerignore`.
- **Secret scanning *is* backpressure** — it is stage 7 of the §3.7 composite gate, so a commit that introduces a secret fails the gate and is rolled back:

| Tool | Role | Command |
| --- | --- | --- |
| **gitleaks** | fast, offline, regex+entropy | pre-commit `gitleaks protect --staged --redact`; gate `gitleaks detect --no-banner --redact` |
| **TruffleHog** | confirms a secret is *live* | scheduled full-history sweep in CI: `trufflehog git file://. --only-verified` |

2025/26 best practice: **gitleaks at commit + PR, TruffleHog scheduled full-history sweeps.** Use `--redact` everywhere, and **scrub tool-output before persisting it to logs/the journal** — the §3.9 tee pipes through `gitleaks stdin --redact`; never log a full `env`.

#### 4.1.6 Supply chain & blast-radius (L0 + L2 + L7)

- **Pinned deps + lockfiles:** `pnpm install --frozen-lockfile` (CI fails on lockfile drift); commit `pnpm-lock.yaml`.
- **Dependency-addition guard.** The agent has an unrestricted shell and can `pnpm add <malicious-pkg>` mid-loop. Defend at two layers: the gate's **lockfile-diff check** (`git diff --quiet -- pnpm-lock.yaml` fails when new top-level deps appear without approval) plus `pnpm audit --audit-level=high` (or `osv-scanner`) — both are stages 8 of §3.7 — and a **`PreToolUse` deny** on `Bash(pnpm add *)` / `Bash(npm i *)` unless allowlisted. For stricter setups, route installs through an internal registry/allowlist.
- **No auto-publish:** keep `"private": true` (this repo does); never wire `npm publish`/release into the loop.
- **Pin the agent CLI:** `DISABLE_AUTOUPDATER=1` + `npm i -g @anthropic-ai/claude-code@X.Y.Z` (§2.2). **Pin GitHub Actions by commit SHA**, not tag (§3.13).
- **`PreToolUse` deny hook** as the in-CLI complement to the outer firewall — block `Bash(npm publish*)`, `Bash(git push * main*)`, `Bash(git push * master*)`, `Bash(pnpm add *)`, and non-allowlisted `curl|wget`. Under Claude you can also pass `--disallowedTools "Bash(npm publish *)"`. This hook is an **extension you add** (§4.5), not a v0 default.

---

### 4.2 Scalability & Cost Governance

#### 4.2.1 The two-layer cost model (L2 + L4)

Cost is capped at two layers; the **Codex asymmetry** is the thing to internalize:

| Layer | Claude Code | Codex |
| --- | --- | --- |
| **Per-iteration (CLI)** | `--max-budget-usd 2.00` (documented) **+** `--max-turns 40` (works but undocumented/fragile — §2.6) | **NEITHER flag exists** → `timeout 1200 codex exec …` + iteration count are **mandatory**, plus OpenAI org/project account-level spend caps |
| **Per-run (Backpressure)** | `Governor` (`src/loop/governor.ts`) | same `Governor` |
| **Per-campaign** | outer `timeout`/deadline + `RuntimeMaxSec` (§3.8, §3.12) | same |

```ts
const gov = new Governor({
  maxIterations: 40,
  maxConsecutiveFailures: 3,
  maxBudgetUsd: 20, // only effective if you feed real costUsd to record()
});
```

`decide()` halts on the **first** breach in fixed precedence — **iterations → consecutiveFailures → budget** (`>=`, reset failures on success). Verified semantics in §2.7 / §3.8.

#### 4.2.2 Feeding real spend into the Governor (L4)

> [!WARNING]
> **`maxBudgetUsd` is inert unless you feed real `costUsd`.** `record(outcome, costUsd = 0)` defaults the cost to **0**, so with no measured spend `spentUsd` never grows and the budget cap never fires. If you cannot measure spend, drop `maxBudgetUsd` and govern with `maxIterations`.

```bash
# Claude exposes per-iteration cost in its JSON result:
cost=$(claude -p "$(cat PROMPT.md)" --output-format json | jq '.total_cost_usd')
# → feed it into the harness: gov.record(passed ? "success" : "failure", cost)
```

> [!NOTE]
> **The seam emits no budget flag.** `buildArgv`/`AgentOpts`/`TargetFlags` model only `--model` and `--max-turns`. To pass `--max-budget-usd` through `runAgent`, either add it to the raw loop line yourself, or extend the seam — add `maxBudgetUsd?: number` to `AgentOpts` and `budget: string | null` to `TargetFlags` (`"--max-budget-usd"` for claude, `null` for codex), mirroring exactly how `maxTurns` is already handled (§4.5). For Codex (no native budget), meter via the provider dashboard.

#### 4.2.3 Throughput, the wheel & concurrency safety (L3)

The governing tension, verbatim: *the wheel has got to turn fast* — companion: *The speed of the wheel turning that matters, balanced against the axis of correctness.* Faster loops only help if each is **deterministically buildable**:

- **Reproducible env:** pin the toolchain (mise/asdf/devcontainer) + lockfiles + a **fresh container per run** so "works in this loop only" drift is impossible.
- **The `flock` build mutex** (built in §3.7.1) is the *structural* enforcement of the §2.8 hard rule — **EXACTLY ONE** build/test at a time. In v0 that rule is enforced **only by prompt wording**; the mutex makes it survive a misbehaving agent.
- **Parallel-EDIT collisions** are the silent twin the source ignores: it permits **MANY** edit subagents but never addresses two writing the same file. Mitigate with disjoint file assignment / serialized edits, plus dedup discipline — the verbatim search-first directive in `PROMPT.md` (*Before making changes search codebase (don't assume an item is not implemented) using parrallel subagents. Think hard.*), the `reviewer` subagent, and the gate's `jscpd` duplicate-symbol stage (§3.7.2).

#### 4.2.4 Fleet operation (L0 + L7)

Multiple loops scale horizontally — each in **its own sandbox and its own branch**, never sharing a worktree. Use CI parallelism with a per-loop budget *and* a wall-clock ceiling. Task-claim discipline (§4.6) prevents two loops re-picking the same `- [ ]` item.

---

### 4.3 Error Handling & Reliability

#### 4.3.1 Kill-switch reference (L4 + L6)

> [!WARNING]
> **Stall detection is NOT in the Governor.** The Governor counts only iterations, consecutive failures, and budget. A loop can make zero progress (commit SHA unchanged) while every Governor limit is respected. You **must** add stall detection externally.

| Control | Mechanism | Governor-native? |
| --- | --- | --- |
| Iteration ceiling | `Governor.maxIterations` / bash `[ "$n" -lt 40 ]` | ✅ |
| Max consecutive failures | `Governor.maxConsecutiveFailures` (resets on success) | ✅ |
| Budget cap | `Governor.maxBudgetUsd` (needs real `costUsd` — §4.2.2) | ✅ |
| **Stall detection** | commit SHA unchanged for K loops → bail | ❌ **add externally** |
| Per-iteration timeout | `timeout 1800 claude -p …` / `timeout 1200 codex exec …` | ❌ |
| **Campaign wall-clock** | outer deadline / systemd `RuntimeMaxSec` | ❌ |
| **Disk guard** | `df` floor → halt before the journal corrupts | ❌ |
| Manual kill switch | `[ -f STOP ] && break` | ❌ |
| Signal handling | `trap 'kill "$child" 2>/dev/null; exit 130' INT TERM` | ❌ |
| Human-in-the-loop | first run **attended**; PR approval before merge (§4.6) | ❌ |

Every halt branch should call `notify()` (§3.11.2) so an unattended loop that stops at 3am pages a human rather than dying silently.

#### 4.3.2 Deterministic recovery protocol (L6)

This turns Huntley's hand-wavy *"git reset --hard or a recovery prompt"* into a protocol with a known-green checkpoint (§3.10): **detect broken tree → reset to last green OR hand the diff to a bounded recovery prompt → cap attempts → page a human.**

```bash
if ! ./scripts/backpressure-gate.sh; then
  echo "RED gate — rolling back iteration $n"
  git reset --hard "$last_green"           # refs/green = last commit that passed the FULL gate
  failures=$((failures + 1))
  [ "$failures" -ge 2 ] && { notify "halt: paging a human"; break; }
fi
```

Pair with the non-main branch guard (§3.11.2). Commit granularity — **one productive commit per loop** — keeps history bisectable and recovery precise; without it, `git reset --hard` either resets away good work or leaves a poisoned tree.

#### 4.3.3 The gate's exit-code contract (L3)

The exit code **is** the brake. For Claude, a hook **exit code 2 is a blocking error whose stderr is fed back to the model** — that is mechanically what makes the gate real backpressure *within* one iteration.

> [!NOTE]
> **Verify exit-code semantics on your version.** Claude exit-2-blocks-the-turn is the documented hooks convention but is version-sensitive; **Codex Stop-hook failure semantics are newer and unverified** — flag as "verify on your Codex version" (§5.4). Because the seam's `runAgent` surfaces **only the CLI process exit code** (not the hook result), the harness **re-runs the gate** to derive a deterministic Governor outcome (§3.11.1) — this is why the gate appears to "run twice."

#### 4.3.4 Plan/spec drift (L1)

`specs/*` is the source of truth; `fix_plan.md` is derived. They drift apart as the loop ticks boxes. **Trigger + cadence:** regenerate `fix_plan.md` from `specs/*` whenever the plan goes stale (repeated no-op loops, or items that no longer map to a spec), and re-run the **planning phase** (§3.6) mid-project when requirements change. Keep all memory files in git so every regeneration is auditable and revertable — and remember the core insight: when something keeps going wrong, **fix THESE FILES, not the code**.

#### 4.3.5 Stop conditions & false-completion (L1 + L6)

Caps give **termination**, not a positive **"done"** signal. *"Faith in eventual consistency"* is bounded by the ceiling, not by correctness.

> [!WARNING]
> **`grep -q '^- \[ \]' fix_plan.md` returning empty does not mean the work is done** — it means no unchecked boxes remain, which an over-eager loop reaches by ticking boxes whose specs are unmet (false completion). The **`@acceptance` suite** (`pnpm run test:acceptance`, authored 1:1 from `specs/*` and run as stage 6 of the gate, §3.7.3) is the positive signal: "plan complete" only counts when acceptance is green.

---

### 4.4 Observability (reference) (L5)

`init` does **not** auto-assemble observability — it is installed in §3.9. The record has **three legs**:

1. **Per-iteration JSONL journal** — `writeJournalEntry(path, { iteration, taskId, result, duration })` appends one line per loop (append I/O injectable).
   > [!NOTE]
   > **Do not conflate the two vocabularies.** `JournalEntry.result` is a **free string** (`"done"` / `"blocked"` / `"failed"`); the Governor's `IterationOutcome` is the union `"success" | "failure"`. They are fed separately. For production, extend `JournalEntry` with `costUsd`, `commitSha` (before→after), and `exitCode` (§4.5).
2. **`git log` as the audit trail** — commit-per-loop makes `git log --oneline` the history and `git diff <before>..<after>` exactly the per-iteration change the `reviewer` subagent (tools: **Read, Grep**) reviews for scope creep + missing tests.
3. **Per-iteration structured logs** — tee `--output-format json` (Claude) / `--json` (Codex) through `gitleaks stdin --redact` to `logs/iter-$n.json` (§3.9). Watch `system/init` (fail the loop if a required plugin/MCP didn't load) and `system/api_retry` (rate-limit telemetry).

**OTEL fleet metrics:** `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_ENDPOINT=<collector>`. Derive and dashboard: **loops/hr, gate pass-rate, $/loop, stall streak**, and route to Alertmanager.

| Alert on | Threshold (tune) | Why |
| --- | --- | --- |
| Failure streak | ≥ `maxConsecutiveFailures − 1` | loop is about to halt; intervene early |
| Stall | commit SHA unchanged ≥ K loops | burning budget for no progress |
| $/loop spike | > N× rolling median | runaway cost (§4.2) |
| `system/init` failure | any | a required hook/MCP/skill silently didn't load |
| Disk free | < floor | journal/logs about to corrupt (§3.8) |

**Retention:** rotate per-run into a timestamped dir, cap with `logrotate` / `--log-opt max-size`, and pair with the disk-guard kill switch so a long campaign cannot fill disk or corrupt the journal.

---

### 4.5 Backpressure wiring cheat-sheet & v0 boundaries

| Control | Backpressure surface | File |
| --- | --- | --- |
| Test/lint/secret gate (L3) | `DEFAULT_HOOKS` Stop hook → point at `scripts/backpressure-gate.sh` | `src/install/init.ts` |
| Publish/push/add deny (L7/L2) | add a `PreToolUse` `HookDefinition` | `src/install/init.ts` + adapters |
| Per-run caps (L4) | `Governor` | `src/loop/governor.ts` |
| Per-iteration budget (L2) | raw flags now; extend `AgentOpts`/`TargetFlags` for `--max-budget-usd` | `src/seam/argv.ts`, `src/seam/targets.ts` |
| Audit (L5) | `writeJournalEntry` (+ commit-per-loop, OTEL) | `src/loop/journal.ts` |
| Diff review (L5/L7) | `reviewer` subagent | `DEFAULT_CAPABILITIES`, `src/install/plan.ts` |
| Headless invoke (L2) | `runAgent` / `buildArgv` | `src/seam/run.ts` |

One `HookDefinition` compiles to **both** targets — `emitClaudeHooks` → `.claude/settings.json`, `emitCodexHooks` → Codex TOML — so a control authored once installs into both CLIs (author once, compile per target).

> [!WARNING]
> **Extensions vs. what v0 ships.** The following are **edits/extensions you make**, not installed v0 behavior (cross-ref §1.6, §2.7): the widened composite gate (v0 `DEFAULT_HOOKS` is exactly `[{ event: "Stop", command: "pnpm test" }]` — a single `pnpm test`, hardcoded, not parameterized), the `PreToolUse` deny hook, the seam budget flag, the journal-field extensions, a Governor stall detector, atomic task-claim (post-v0 `src/tracker`), and the **Codex hooks-adapter fix** (`src/adapters/codex/hooks.ts` emits a flat `[[hooks]]` array Codex 0.137.0 does not recognize — it expects nested `[[hooks.Stop]]` + `[[hooks.Stop.hooks]]`; §3.7.4 / §5.2). Also v0-deferred: the **tracker MCP is built but not installed** (no `.mcp.json` / `[mcp_servers]`), `build`/`index` are stubs, the store is a JSON file, and **no loop runner ships** — Governor/journal/`runAgent` are primitives you assemble (§3.11).

---

### 4.6 Human governance & the merge gate (L7)

PR-based human review is the **final, non-negotiable gate**. The loop runs on a throwaway non-main branch and delivers a **PR — never auto-merge to main** (§3.13). Defense in depth: the **same `scripts/backpressure-gate.sh`** runs as a required status check on the PR (branch protection via `gh api`: tests + lint + gitleaks required before merge), so backpressure exists *both* inside the loop and on the PR.

> [!NOTE]
> The bundled `reviewer` subagent is a **pre-filter, not a substitute for human review**. Verbatim: Ralph **multiplies a senior engineer; it does not replace one** — anyone claiming a tool does 100% of the work without an engineer is *peddling horseshit*.

**Task-claim discipline for "one thing per loop":** v0 relies on `fix_plan.md` `- [ ]` boxes and prose discipline (tick exactly one per pass, with a commit). The production upgrade is the repo's `src/tracker` (store/select/server, **post-v0**) — atomic claim with in-progress/done states and dependency ordering — which prevents a restarted or parallel loop from re-picking an item already in flight (§4.2.4).

---

### 4.7 Production-readiness checklist (consolidated, L0–L7)

- [ ] **Isolated** in a container/microVM (§3.2), **not** just a worktree; non-root, `--read-only`, no host-credential mounts; firewall topology chosen (Model A or B)
- [ ] **Default-deny egress** + self-test passing (§3.3); Codex macOS uses the *external* firewall, not its own toggle
- [ ] **Ephemeral, scoped creds** injected by env; no prod creds reachable; secret scan (gitleaks) in the gate; rotate/revoke on exit (§4.1.5)
- [ ] **Composite, exit-coded gate** wired as the Stop hook (§3.7) — format → typecheck → stub-guard → dedup → build/test → acceptance → secret-scan → dep-guard, `flock`-wrapped; **Codex hook trusted & nested-schema correct**
- [ ] **Caps:** `Governor` + per-iteration `timeout` + campaign deadline + disk guard + `STOP` file + `trap` + **external stall detection** (§4.3.1)
- [ ] **Known-green checkpoint** (`refs/green`) + bounded recovery, then `notify()` a human (§4.3.2)
- [ ] **Commit-per-loop** + redacted JSONL journal + OTEL + alerting on failure-streak / stall / $/loop / disk (§4.4)
- [ ] **Supervisor** with restart/resume (systemd `Restart=on-failure` + `RuntimeMaxSec`, §3.12)
- [ ] **Cost cap** real: Claude `--max-budget-usd` fed into `Governor.record(…, costUsd)`; Codex `timeout` + Governor + account spend caps + dashboard metering (§4.2)
- [ ] **PR-only**, CI re-runs the same gate, branch protection, **human approval before merge** (§3.13, §4.6)
- [ ] **Pinned** toolchain / CLI (`DISABLE_AUTOUPDATER=1`) / Actions-by-SHA / `--frozen-lockfile` / dep-addition guard / `"private": true` (§4.1.6)
- [ ] **First run attended** (§3.12)

> [!WARNING]
> **The "bonfire of outcomes."** The gate is only as honest as its weakest link. On greenfield, typed/fast-compiling projects the compiler is honest backpressure; on **dynamic/untyped languages you MUST wire a static analyzer into the gate** — verbatim: *If you do not, then you will run into a bonfire of outcomes.* A weak gate means bad code flows straight downstream, and the loop faithfully multiplies it.

---

## 5. Troubleshooting & FAQs

This is the on-call runbook for an unattended loop. §5.1 is symptom-driven recovery; §5.2 is the per-CLI gotcha table; §5.3 answers the conceptual questions a reviewer will ask; §5.4 is the re-verification drill before every campaign; §5.5 is the fidelity appendix. Every fix cross-references the section that installs the corresponding guardrail — if a problem keeps recurring, the durable fix is almost always to **edit a memory file (§2.5), not to babysit the loop**.

### 5.1 Recovery runbook (symptom → diagnosis → recovery → prevention)

> [!NOTE]
> **The Ralph mindset for incidents.** The technique is *"deterministically bad in an undeterministic world"* — you are *expected* to wake up to some breakage. The job of this runbook is not to prevent every bad loop; it is to make every bad loop **cheap to roll back and impossible to ship**. Recovery is a protocol (§3.10, §4.3.2), not a panic.

| # | Symptom | Diagnosis (root cause) | Command-level recovery | Prevention (durable fix) |
| --- | --- | --- | --- | --- |
| 1 | **Wake to a non-compiling repo** | A loop landed a broken edit and the gate did not (or could not) reject it; later loops built on the rubble. | `git reset --hard <last-green>`, **or** hand the diff to a *bounded* recovery prompt (cap 2 attempts, then halt and page a human). | Known-green checkpoint (`refs/green`) + commit-per-loop. §3.10, §4.3.2 |
| 2 | **Gate goes red and stays red** | The agent cannot satisfy the gate (under-specified task, missing fixture, flaky test). | Stop looping. `git reset --hard <last-green>`, run one bounded recovery prompt scoped to the failure, cap attempts, escalate. | `Governor.maxConsecutiveFailures` halts the streak (§3.8). Sharpen the spec / fix the test, not the model. §4.3.2 |
| 3 | **Duplicate implementations** of the same function/module | **Non-deterministic search**: a fresh-context loop doesn't know the thing exists and re-writes it. | Delete the dupe, keep the better one, commit. | Verbatim search directive in `PROMPT.md` (below) + the `reviewer` subagent + the gate's `jscpd` dedup stage. §3.5, §3.7.2 |
| 4 | **Placeholder / stub code** (`TODO`, `// not implemented`) | Model took the lazy path; a weak gate doesn't fail on stubs. | Revert the stub commit. | The gate's stub-grep stage (§3.7.2) + the verbatim all-caps full-implementation directive in `PROMPT.md` (below). §3.5 |
| 5 | **Context exhaustion** (loop degrades mid-pass, output truncates) | Too much stuffed into one loop. | Kill the iteration (`timeout`/STOP file), shrink the task to **one** `- [ ]` item, restart clean. | Enforce **one thing per loop** (§1.2 principle 1); split fat `fix_plan.md` items; lean on subagents as disposable memory (§2.8). |
| 6 | **Stale / drifting plan** | Specs evolved or the plan was never refreshed; the loop chases dead to-dos. | Regenerate `fix_plan.md` from `specs/*` (§3.6.2); re-commit. | `specs/*` is truth, `fix_plan.md` is derived; set a regeneration cadence. §4.3.4 |
| 7 | **Parallel build/test collisions** (intermittent failures) | Two subagents ran build/test concurrently. | Re-run the gate serially to confirm green; discard the poisoned iteration. | **MANY** subagents to search/edit, **EXACTLY ONE** to build/test, enforced by the `flock` mutex. §2.8, §3.7.1 |
| 8 | **Loop stalls — iterations run, no new commits** | The agent spins without a productive change. | Bail. Inspect the journal/`git log` for the last real commit; fix the blocking spec/dep. | **Stall detection** (commit SHA unchanged for K loops). NOT in `Governor` — add externally. §3.8, §4.3.1 |
| 9 | **Runaway cost** | No effective budget brake; on Codex no native cap. | Trip the STOP file / kill the run. | Claude: `--max-budget-usd` + feed `total_cost_usd` into `gov.record(outcome, costUsd)`. Codex: `timeout` + `Governor` + account spend caps **mandatory**. §3.8, §4.2 |
| 10 | **False completion** (every `- [ ]` ticked, specs unmet) | Caps + checkbox-counting give termination, not a "done" signal. | Don't merge. Run `pnpm run test:acceptance`; reopen unmet items. | Spec-level `@acceptance` suite as gate stage 6. §3.7.3, §4.3.5 |
| 11 | **"It wandered"** — scope creep | Vague standing orders. *Your skill shows up in the output.* | Revert off-scope commits; read the `reviewer` notes. | **Fix the files, not the code**: tighten `PROMPT.md`, sharpen the spec. §3.12, §4.6 |
| 12 | **Suspected secret leak** | Bypass mode = unrestricted host shell; a worktree shares host creds/network. | **[see callout]** | Container + default-deny egress + ephemeral scoped creds + secret scanning in the gate. §3.2, §3.3, §4.1 |

> [!CAUTION]
> **Incident 12 is different — git cannot undo this.** `git reset --hard` only rewinds **in-repo file changes**. It will **not** un-leak a credential, restore a deleted file outside the repo, or recall an exfiltrated `~/.claude` token. If you suspect a leak: **rotate/revoke the token immediately**, audit egress logs, and treat it as a security incident — not a git problem. This is exactly why isolation (§3.2) and egress lock-down (§3.3) come *before* the agent is ever invoked.

**The two verbatim directives that prevent incidents 3 and 4** — paste them into `PROMPT.md` exactly, original spelling preserved (`parrallel` is not a typo to fix):

```text
Before making changes search codebase (don't assume an item is not implemented) using parrallel subagents. Think hard.

DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL IMPLEMENTATIONS. DO IT OR I WILL YELL AT YOU
```

**Bounded recovery snippet** (incidents 1–2) — the protocol behind the table:

```bash
if ! ./scripts/backpressure-gate.sh; then
  echo "RED gate — rolling back iteration $n"
  git reset --hard "$last_green"          # discard the poisoned iteration
  fails=$((fails + 1))
  if [ "$fails" -ge 2 ]; then
    notify "halt: recovery cap reached, paging a human"
    break
  fi
fi
```

### 5.2 Platform-specific gotchas (Claude Code vs Codex)

Pinned to **Claude Code 2.1.193** and **Codex CLI 0.137.0** (verified 2026-06-26). All version-sensitive — see §5.4.

| Symptom | CLI | Cause | Fix |
| --- | --- | --- | --- |
| **Codex Stop gate silently skipped** | Codex | Codex refuses a freshly-installed/changed command hook until trusted; untrusted hooks are skipped, not failed. | Pre-trust the hook, or pass `--dangerously-bypass-hook-trust` for the loop. Make "hook trusted" a go/no-go item (§3.12). Claude has **no** hook-trust gate. |
| **Codex Stop hook not loaded at all** | Codex | Repo bug: `src/adapters/codex/hooks.ts` emits a **flat `[[hooks]]`** array Codex 0.137.0 does not recognize. | Hand-write the **nested** schema (§3.7.4) into `.codex/config.toml`, or use `~/.codex/hooks.json`. |
| **Codex `network_access = true` has no effect** | Codex (macOS) | Apple **Seatbelt** silently ignores the workspace-write network toggle (openai/codex#10390); Linux **Landlock** honors it. | Use the external default-deny firewall (§3.3). |
| **`--max-turns` missing from `claude --help` but still parses** | Claude | The flag became undocumented in 2.1.193; it still works. | Pin the CLI version; prefer documented `--max-budget-usd` as primary cap, treat `--max-turns` as fragile secondary. §2.2 |
| **Hooks / `CLAUDE.md` / MCP suddenly not loaded** | Claude | `--bare` (slated to become the `-p` default) disables auto-discovery. | Do **not** use `--bare` for the loop; or explicitly re-pass `--settings`/`--mcp-config`/`--agents`/`--add-dir`. §2.6 |
| **Background work cut off / huge prompt fails** | Claude | `-p` lifetimes: background Bash killed ~5s after the final result; background subagents waited up to 10 min (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`); piped stdin capped at 10 MB. | Keep long-running work inside the single build/test subagent; for multi-KB prompts pipe (`cat PROMPT.md \| claude -p`) rather than an argv positional (ARG_MAX). §3.5, §3.11.2 |
| **Budget cap never fires** | Both (via Governor) | `Governor.maxBudgetUsd` is inert unless you feed real `costUsd`; default `costUsd = 0`. | Parse `claude -p … --output-format json \| jq '.total_cost_usd'` into `gov.record("success", costUsd)`. Else drop `maxBudgetUsd`, govern with `maxIterations`. §3.8, §4.2.2 |
| **Gate passes locally but ships the wrong thing** | Both | `init` hardcodes the Stop hook to `pnpm test` — no lint/typecheck/build/security in the installed default. | Point the Stop hook at `scripts/backpressure-gate.sh` (§3.7); hand-edit `DEFAULT_HOOKS` for non-pnpm repos. §2.7, §4.5 |
| **Harness "runs the gate twice"** | Both | Intentional: the in-CLI Stop hook gates the *agent within the iteration*; the harness re-runs because the seam surfaces only the process **exit code**, not the hook result. | Keep both. The harness re-run yields the deterministic `Governor` outcome. §3.11.1, §4.3.3 |

**Correct Codex Stop-hook schema** (replaces the flat `[[hooks]]` the adapter currently emits):

```toml
[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = "./scripts/backpressure-gate.sh"
timeout = 600
```

### 5.3 Conceptual FAQs

**Q: Can I run Ralph on my existing / legacy codebase?**
A: Don't. Huntley is blunt: *"There's no way in heck would I use Ralph in an existing code base"*. This guide assumes **greenfield** with clear, testable outputs (§1.5). Legacy code lacks the honest backpressure (a compiler/type-checker or wired-in static analysers) that converges the loop; without it, *"If you do not, then you will run into a bonfire of outcomes."*

**Q: Does this replace engineers?**
A: No. Ralph **multiplies a senior engineer; it does not replace one.** Claims to the contrary are, verbatim, *"peddling horseshit."* The human merge gate (§3.13, §4.6) is non-negotiable; the `reviewer` subagent is a pre-filter, not a substitute.

**Q: Claude Code or Codex for unattended runs?**
A: The OS-sandbox divergence decides it (§2.6). **Codex ships a real OS sandbox** (Seatbelt / Landlock+seccomp) selectable *without* full bypass, so it can run "sandbox ON, approvals OFF" (`-s workspace-write -a never`). **Claude Code has no OS sandbox** — `--dangerously-skip-permissions` just removes prompts — so unattended Claude **requires** an external container/VM. Claude has `--max-budget-usd` + (fragile) `--max-turns`; Codex has neither, so `timeout` + `Governor` are mandatory there.

**Q: Why both an in-loop gate *and* a CI check?**
A: Defense in depth (§3.13). The Stop hook is backpressure *within* each iteration; the required CI status check is backpressure *on the PR*. The same `scripts/backpressure-gate.sh` runs in both, eliminating local-vs-CI drift.

**Q: Why isn't a git worktree enough?**
A: A worktree is **version-control isolation, not a security sandbox** (§1.4). It shares the host's credentials and network; `git reset --hard` cannot undo a leaked secret or a deleted external file. The worktree is the floor (§3.2.1); the container/microVM is the real boundary.

**Q: Is `/loop` the production loop?**
A: No. `/loop` is a **session-level** slash command, not a `-p` headless runner (§2.6). The unattended mechanism stays the bash `while` loop or your own harness (§3.11).

**Q: Does Backpressure run the loop for me?**
A: No — by design. It is a **capability pack**, not an agent/runtime, and **ships no loop runner** (§2.7). It gives you the Stop-event test gate, the `reviewer` subagent, the `building-adaptive-ui` skill, and tested **primitives** (`Governor`, `writeJournalEntry`, `runAgent`/`buildArgv`) that *you* assemble (§3.11).

**Q: Two phases or three?**
A: Huntley formally names two — **phase one: generate** and **phase two: backpressure**. The **GENERATE → BACKPRESSURE → LOOP BACK** triad is this guide's editorial synthesis (§1.3).

**Q: Why is my budget cap doing nothing?**
A: `Governor` budget is inert without a real cost feed (§5.2, "Budget cap never fires"). Pass measured `costUsd` to `record()`, or govern with `maxIterations`.

**Q: Can I run the loop in CI?**
A: Yes, and an ephemeral runner gives you isolation for free — but scope it hard: `permissions: { contents: read }`, OIDC for cloud creds, `timeout-minutes`, never expose org secrets. The loop opens a **PR on a throwaway non-main branch; never auto-merge to main** (§3.13).

**Q: How is this different from the beginner `docs/RALPH_GUIDE.md`?**
A: `RALPH_GUIDE.md` teaches the technique and a starter bash harness. This guide is **production-oriented**: it spends its weight on sandboxing, secrets, egress, cost governance, observability, kill switches, deterministic recovery, CI, and the concrete Backpressure wiring (§§2–4). It cross-references the beginner guide rather than restating it.

### 5.4 Version-sensitivity & re-verification checklist

Run this **before every campaign** — the matrix in §2.6 is a snapshot, and `--max-turns` already vanished from Claude's `--help` once.

- [ ] Re-run `claude --help` and `codex exec --help`; diff against your pinned notes.
- [ ] Confirm `--max-budget-usd` and `--max-turns` still **parse** on Claude (unknown flags error; these should not).
- [ ] Confirm the **Stop-hook exit-code semantics** on your Claude version (exit 2 = blocking error fed back to the model) and your Codex version (failure semantics are newer/unverified — §4.3.3).
- [ ] Confirm Codex **hook schema** (nested `[[hooks.Stop]]`) and **hook-trust** behavior.
- [ ] Rebuild the egress allowlist (CDN/GitHub/OpenAI IPs rotate) and re-run the self-test (§3.3).
- [ ] Pin: CLI (`DISABLE_AUTOUPDATER=1` + `npm i -g @anthropic-ai/claude-code@X.Y.Z`), toolchain (mise/asdf/devcontainer), lockfiles (`--frozen-lockfile`), and GitHub Actions by **commit SHA**.
- [ ] Treat the entire §2.6 capability matrix as version-sensitive until re-verified.

### 5.5 Fidelity & quotes appendix

**Verbatim quotes — reproduce exactly, original spelling and case preserved:**

- *"deterministically bad in an undeterministic world"* — preserve **undeterministic**.
- *"Before making changes search codebase (don't assume an item is not implemented) using parrallel subagents. Think hard."* — preserve **parrallel**.
- *"DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL IMPLEMENTATIONS. DO IT OR I WILL YELL AT YOU"* — all-caps, no trailing period.
- *"You may use up to 500 parrallel subagents for all operations but only 1 subagent for build/tests of rust."* — preserve **parrallel** and lowercase **rust**.
- *"the wheel has got to turn fast."*
- *"There's no way in heck would I use Ralph in an existing code base"*
- *"If you do not, then you will run into a bonfire of outcomes."* — context: failing to wire static analysers into dynamically-typed projects.
- *"peddling horseshit"* — on the claim that a tool replaces engineers.

**Editorial-vs-Huntley notes (do not misattribute):**

- The named **GENERATE → BACKPRESSURE → LOOP BACK** triad and the "loop back" label are this guide's synthesis; Huntley names only *generate* and *backpressure* (§1.3).
- The **relay-race-with-amnesia / shared-clipboard** image is this guide's own analogy, not a Huntley quote (§1.2).
- The modern one-liner uses `claude -p` (print/headless); Huntley's original post pipes into `claude-code`. Present `claude -p` as the runnable form; don't claim the post wrote it (§1.2).
- **Receipts** ($50,000 contract delivered for $297 of AI spend; the **CURSED** self-hosting compiler; "6 repos shipped overnight" at a YC hackathon) are reproduced as **attributed claims**, not independently verified fact (§1.5).

**Source:** ghuntley.com/ralph. **Companion docs:** `docs/RALPH_GUIDE.md` (beginner), `docs/USER_GUIDE.md` (toolkit reference).