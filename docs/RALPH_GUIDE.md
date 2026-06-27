# Ralph — A Practitioner's Guide to Autonomous AI Coding

> A hands-on introduction to the **Ralph technique** and a step-by-step
> guide to building your own loop. Based on Geoffrey Huntley's post
> [*"Ralph Wiggum as a software engineer"*](https://ghuntley.com/ralph/).

**Why this doc lives here:** this project is named after a concept from Ralph.
The technique has three phases — **Generate → Backpressure → Loop** — and
"Backpressure" (the test/lint gate) is the middle one. This repo exists to make
that gate easy to install into a coding CLI. So this guide is both background
reading and a workflow recipe.

## Contents

1. [What Ralph actually is](#1-what-ralph-actually-is)
2. [The philosophy (four ideas)](#2-the-philosophy-four-ideas)
3. [The three phases (the heart of it)](#3-the-three-phases-the-heart-of-it)
4. [Zoom out: plan first, then loop](#4-zoom-out-plan-first-then-loop)
5. [The files Ralph reads every loop](#5-the-files-ralph-reads-every-loop)
6. [Prompting lessons (learned the hard way)](#6-prompting-lessons-learned-the-hard-way)
7. [When Ralph works vs. when it fails](#7-when-ralph-works-vs-when-it-fails)
8. [Is it real? (the receipts)](#8-is-it-real-the-receipts)
9. [Build your own Ralph workflow (step-by-step)](#9-build-your-own-ralph-workflow-step-by-step)
10. [How this relates to Backpressure (this project)](#10-how-this-relates-to-backpressure-this-project)

---

## 1. What Ralph actually is

Ralph is a **technique**, not a tool. The whole idea fits on one line of bash:

```bash
while :; do cat PROMPT.md | claude -p ; done
```

In plain English: *run the same prompt over and over, forever, letting the AI do
one small thing each time, until the software is built.* (`claude -p` is the real
binary in print/headless mode — it reads the piped prompt, runs once, and exits,
so the loop can restart it. The runnable version with safety rails is in
[§9](#9-build-your-own-ralph-workflow-step-by-step).)

It's named after Ralph Wiggum from *The Simpsons* — the lovable, impulsive kid —
because the technique is, in Huntley's words, **"deterministically bad in an
undeterministic world."** It isn't clever. It just never stops. That turns out to
be surprisingly powerful.

**The mental model.** A normal AI chat session is a *conversation*: you ask, it
answers, the context fills up, quality drifts. Ralph throws that away. Every loop
is a **fresh start with a clean context window**. The AI never remembers the last
loop. Instead it re-reads a few key files each time to work out where things stand
and what to do next.

> Picture a relay race where every runner has amnesia — but they all read the same
> clipboard before running their leg. The clipboard is the memory.

---

## 2. The philosophy (four ideas)

| Principle | What it means for you |
|---|---|
| **One thing per loop** | The cardinal rule. Each iteration does *exactly one task*. Small context, sharp focus. You trust the AI to pick the most important thing each time. |
| **Faith in eventual consistency** | No single loop is perfect. You believe bugs get noticed and fixed *across many loops*. It's gardening, not engineering — you tend it and it converges. |
| **Your skill shows up in the output** | Ralph doesn't hide a weak operator. Vague prompts and specs produce bad code. Good results come from *your* clarity, not the model alone. |
| **Monolithic beats multi-agent** | One process, one repo, one loop. Fancy multi-agent setups add randomness and break. Keep it dumb and single-threaded. |

---

## 3. The three phases (the heart of it)

Every loop cycles through three stages:

```
   ┌──▶ PHASE 1: GENERATE — "write the code"
   │      - specs say what to build
   │      - examples show the style
   │      - AI produces code
   │                │
   │                ▼
   │    PHASE 2: BACKPRESSURE — "is it actually good?"
   │      - run the unit tests
   │      - run the linter / compiler
   │      - run security scanners
   │      - GATE: must pass to proceed
   │                │
   │                ▼
   │    PHASE 3: LOOP BACK — "check your own work"
   │      - test the code you just changed
   │      - note what's still broken in the plan
   │      - start over with a fresh context
   │                │
   └────────────────┘   (loop back to PHASE 1)
```

- **Generate** is cheap now — the AI writes code fast. Quality is steered by your
  *specs* and *examples*, not by hoping.
- **Backpressure** is the gate. Tests + linters + compiler must pass before the
  loop continues. This is the "are you sure?" wall that stops bad code from
  flowing downstream. **This is the concept this repo is named after.** Without
  it, the loop happily turns garbage into more garbage.
- **Loop back** — the AI tests its own change, writes down what's left, and the
  cycle restarts with a clean slate.

> "The wheel has got to turn fast." — Huntley. Iteration *speed* matters more than
> any single loop being perfect.

---

## 4. Zoom out: plan first, then loop

[§3](#3-the-three-phases-the-heart-of-it) was one turn of the wheel. But the loop
never starts from a blank repo — the memory files it reads (`specs/*` and the
plan) are produced by a deliberate, **human-steered planning phase** you run
*once* before any looping begins. Most newcomers skip straight to the loop and
wonder why it wanders; the planning phase is where your engineering judgement
actually goes in. Here's the whole process, end to end:

```
  ═══════════  PLANNING PHASE — run once, by hand  ═══════════

  [1] REQUIREMENTS · one agent, one fresh context window
        You <-> agent: talk the task through. SHAPE the context —
        don't implement yet.
          - subagents load URLs / papers / release notes
          - subagents write specs, one file per concern
                 │
                 ▼  produces:  specs/*.md   (what to build)
                 │
                 ▼  consumed by
  [2] TODO · one agent, one fresh context window
        You <-> agent: talk the task through. SHAPE the context —
        don't implement yet.
          - subagents study specs/*
          - subagents analyse src/ in parallel (Huntley's prompt uses up to 500)
          - subagents write the plan
                 │
                 ▼  produces:  fix_plan.md   (ordered to-dos)


  ═══════  IMPLEMENTATION PHASE — the loop, driven by PROMPT.md + AGENT.md  ═══════

  [3] INCREMENTAL LOOP · one agent, one fresh context window, allocated
      the SAME way every pass (automatic, not hand-steered):
          1. study specs/* + fix_plan.md
          2. pick the ONE most important item
          3. research & edit   →  parallel subagents OK
          4. build & test      →  exactly ONE subagent
          5. on green, tick it off the plan

      ↺ loop: fresh context, back to step 1
```

**Read it in two halves.**

- **Planning phase — you drive.** Two single-agent stages whose context you shape
  by hand (it's a *discussion*, not an implementation):
  - **Requirements** → talk the task through, pull external context (papers,
    release notes, breaking-change URLs) into the window via subagents, then write
    `specs/*.md`, one file per concern. The output is *what to build*, precisely.
  - **TODO** → study those specs, fan subagents across the existing `src/` to learn
    what's already there (Huntley's prompt uses up to 500 in parallel), then write
    `fix_plan.md` — the ordered to-do list (the same file the
    [§9](#9-build-your-own-ralph-workflow-step-by-step) walkthrough builds).

- **Implementation phase — the loop drives itself.** `PROMPT.md` + `AGENT.md` pin
  the behaviour so every pass allocates its context *the same way* — that sameness
  is the feature, not a limitation. Each pass picks the single most important plan
  item, does just that one, and ticks it off **only when build + tests go green**
  (the backpressure gate from [§3](#3-the-three-phases-the-heart-of-it)), then
  starts over with a clean window.

**Two ideas this view makes explicit.**

- **Subagents are disposable memory.** Every subagent gets its *own* fresh context
  window that's garbage-collected the moment it returns. That's how a stateless
  main agent reaches past a single window: spawn subagents to load external docs,
  to search/analyse the codebase in parallel, and to do edits — then keep only
  their results. The one hard rule: **many subagents for search/research/edit,
  exactly one for build/test** (parallel builds collide — see
  [§6, lesson 3](#6-prompting-lessons-learned-the-hard-way)).
- **Manual context up front, automatic context in the loop.** You spend judgement
  *before* the loop — shaping specs and the plan by hand. Once looping, the context
  is assembled mechanically and identically each time. Plan deliberately, then let
  the wheel turn.

---

## 5. The files Ralph reads every loop

Because each loop has amnesia, Ralph re-reads the same handful of files every time
to rebuild its bearings. **These files are the memory.** The AI is stateless; the
files hold the state.

| File | Role | Analogy |
|---|---|---|
| `PROMPT.md` | The instructions piped in every loop | The standing orders |
| `fix_plan.md` (a.k.a. `IMPLEMENTATION_PLAN.md`) | A prioritized to-do list (`- [ ]` checkboxes) | The clipboard: "what's left, most important first" |
| `specs/*` | Specifications — what you're building, precisely | The blueprint |
| `AGENT.md` (a.k.a. `AGENTS.md` / `CLAUDE.md`) | How to build, run, and test the project | The "how this repo works" cheat sheet |

**Key insight:** when something keeps going wrong, the fix is almost always
**editing these files**, not the code.

---

## 6. Prompting lessons (learned the hard way)

These specific tricks from the post each map to a real failure mode:

1. **Stop it re-inventing things that already exist.** The AI assumes code isn't
   there and writes duplicates. The antidote, verbatim:
   > "Before making changes search codebase (don't assume an item is not
   > implemented) using parrallel subagents. Think hard."

2. **Force real code, not stubs.** Models love placeholder functions because they
   compile (and "it compiles" is the reward signal). Huntley's blunt fix, verbatim:
   > "DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL
   > IMPLEMENTATIONS. DO IT OR I WILL YELL AT YOU"

3. **Parallel for searching, serial for building.** Let it fan out subagents to
   read/search, but only *one* at a time for builds/tests (or they collide):
   > "You may use up to 500 parrallel subagents for all operations but only 1
   > subagent for build/tests of rust."

4. **Write down the "why" in tests and docs.** Future loops have no memory of *why*
   a test exists — so the intent must live in the code/docs, or the next loop may
   delete it.

---

## 7. When Ralph works vs. when it fails

**✅ Works great for:**

- **Greenfield** — brand-new projects from scratch. Its sweet spot.
- Things with **clear, testable outputs** (compilers, libraries, well-specced
  services).
- Self-correcting loops where tests give honest pass/fail signals.

**❌ Fails or hurts for:**

- **Existing / legacy codebases.** Huntley: *"There's no way in heck would I use
  Ralph in an existing code base."*
- **Dynamic / untyped languages** without static analyzers wired in as
  backpressure ("a bonfire of outcomes" — with no compiler or type-checker gating
  each loop, errors slip through and the loop multiplies them).
- Anytime the test gate is weak — bad code flows straight through.

**Gotchas you *will* hit:**

- You'll wake up to a codebase that doesn't compile. Recovery = `git reset --hard`
  and restart, or write a recovery prompt.
- Non-deterministic search → duplicate implementations.
- Context exhaustion if you stuff too much into each loop.

---

## 8. Is it real? (the receipts)

- A **$50,000 contract** delivered as a tested MVP for **$297** of AI spend.
- **CURSED** — a real compiler for an esoteric language *with zero presence in
  training data* — built entirely by Ralph loops, and it self-improves.
- **6 repos shipped overnight** at a Y Combinator hackathon.

**Big caveat:** Huntley is emphatic that this needs a **senior engineer** steering
it. Claims that "you don't need engineers anymore" he calls *"peddling horseshit."*
Ralph multiplies a skilled operator; it doesn't replace one.

---

## 9. Build your own Ralph workflow (step-by-step)

A concrete starter you can run today.

> ⚠️ **Safety rule #1: isolate before you run.** Best: a container or throwaway
> VM. At minimum: a throwaway git worktree — but a worktree is *version-control*
> isolation, **not a security sandbox.** The loop runs the CLI with approval
> prompts bypassed (`--dangerously-skip-permissions`), i.e. unrestricted shell on
> your host, sharing its filesystem, network, and credentials. `git` only undoes
> file changes inside the repo — it can't undo a deleted file elsewhere or a
> leaked secret.

### Step 1 — Make an isolated playground

```bash
git worktree add ../my-ralph-loop -b ralph/auto
cd ../my-ralph-loop
```

### Step 2 — Create the four memory files

**`fix_plan.md`** — the to-do clipboard:

```markdown
# Fix Plan
- [ ] Set up the project skeleton and a passing "hello world" test
- [ ] Implement <first real feature from the spec>
- [ ] ...
```

**`specs/overview.md`** — describe *what* you're building, precisely. Be specific;
vagueness in = garbage out.

**`AGENT.md`** — how to build, run, and test:

```markdown
# How to work in this repo
- Build:  pnpm run build
- Test:   pnpm test      ← the backpressure gate; must pass
- Lint:   pnpm run check
```

**`PROMPT.md`** — the standing orders piped every loop:

```markdown
Study @fix_plan.md and @AGENT.md, and read every spec file under specs/.

Do ONE thing from @fix_plan.md — the highest priority item only.

Before writing code, SEARCH the codebase first (don't assume something
isn't implemented). Think hard.

DO NOT write placeholder or stub implementations. Write full, real code.

After your change, run the tests for the code you touched. If they fail,
fix them before finishing. Then update @fix_plan.md: check off what you
did, add any new problems you found.

Commit your work with a clear message.
```

### Step 3 — The loop, with safety rails

The raw `while :; do ... ; done` has no brakes. A safer starter version adds a
branch guard, file checks, a per-iteration turn cap, a hard test gate, and stop
conditions for both completion and stalls:

```bash
#!/usr/bin/env bash
set -uo pipefail

# SAFETY: refuse to run anywhere but a throwaway branch. Also blocks detached
# HEAD ("HEAD") and "not a git repo" (-> "none") — both would otherwise slip
# through the guard and run unsandboxed.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo none)
case "$branch" in
  main|master|HEAD|none)
    echo "Refusing to run on '$branch' — create a throwaway worktree first."; exit 1;;
esac

# SAFETY: the piped memory files must exist, or every loop feeds the agent empty input.
for f in PROMPT.md fix_plan.md; do
  [ -f "$f" ] || { echo "Missing required file: $f"; exit 1; }
done

n=0; stalls=0
# Loop while the plan still has unchecked items, capped at 25 as a hard ceiling.
while grep -qE '^- \[ \]' fix_plan.md && [ "$n" -lt 25 ]; do
  n=$((n + 1)); echo "=== iteration $n ==="
  before=$(git rev-parse HEAD 2>/dev/null || echo none)

  # --max-turns caps a single iteration so one runaway pass can't run away.
  # (Optional cost cap, Claude only: --max-budget-usd 2.00)
  claude -p --dangerously-skip-permissions --max-turns 40 < PROMPT.md

  # BACKPRESSURE: tests must pass to keep going.
  pnpm test || { echo "Tests failed — stopping for human review."; break; }

  # STALL GUARD: a productive iteration makes a commit; bail after 3 idle ones.
  after=$(git rev-parse HEAD 2>/dev/null || echo none)
  if [ "$after" = "$before" ]; then
    stalls=$((stalls + 1))
    [ "$stalls" -ge 3 ] && { echo "3 stalls in a row — a task is stuck. Stopping."; break; }
  else
    stalls=0
  fi
done
```

> Modern CLIs have a built-in loop you can use instead of hand-rolled bash — e.g.
> Claude Code's `/loop`. Graduating to one of those is the natural next step once
> you understand the mechanics.
>
> Driving **Codex** instead of Claude Code? Swap the agent line for
> `codex exec "$(cat PROMPT.md)" --dangerously-bypass-approvals-and-sandbox`
> (Codex has no `--max-turns`).

### Step 4 — Watch the first run, then tune

- **Attend the first few loops.** Don't walk away yet.
- Every time it does something dumb, **fix the files, not the code**: tighten
  `PROMPT.md`, sharpen a spec, reprioritize `fix_plan.md`.
- Regenerate `fix_plan.md` when it goes stale — delete and rewrite it freely.
- Commit every loop so `git log` is your history and `git reset --hard` is your
  escape hatch.

### Pre-flight checklist (read before every run)

- [ ] Isolated: a container/VM, or at minimum a throwaway worktree — **not** main, not your real repo
- [ ] No production credentials reachable from the environment (a worktree does **not** scope these)
- [ ] Per-iteration turn cap (`--max-turns`) and an iteration ceiling both set
- [ ] A real test gate that actually fails on bad code (the backpressure)
- [ ] First run is **attended**

---

## 10. How this relates to Backpressure (this project)

- The **"Backpressure" name is load-bearing** — it's Phase 2 of Ralph, the
  test/lint gate. This repo's value is making that gate easy to install: hooks
  that run `pnpm test`, plus loop primitives (`loop/governor.ts`,
  `loop/journal.ts`) and the headless-invocation seam (`seam/run.ts`).
- This project **does not ship a loop runner** — by design. The loop, context
  management, and sandboxing are the CLI's job. Drive the loop with the CLI's own
  mechanism (e.g. Claude Code's `/loop`) or your own harness like the one in
  [§9](#9-build-your-own-ralph-workflow-step-by-step), and let Backpressure supply
  the guardrails.

---

*Source: Geoffrey Huntley, [ghuntley.com/ralph](https://ghuntley.com/ralph/).
All quoted text is reproduced verbatim from that post, including its original
spelling.*
