# Consumer E2E test prompt — Backpressure on Claude Code

> A reusable, **black-box** prompt for an autonomous agent acting as a release
> tester. It verifies the journey a real developer takes: download the pack,
> build it, run `backpressure init --target claude` in their own repo, and get
> **working Claude Code guardrails**. The spec is [`USER_GUIDE.md`](USER_GUIDE.md)
> — not the unit tests.
>
> Phases 0–2 (build + install + file verification) are CLI-agnostic and can be
> driven by any agentic CLI. Phase 3 (live Stop-hook firing) is the
> Claude-Code-specific integration check.

## The consumer flow under test

The package is `private`/unpublished — consumed from source, not `npm i -g`:

```bash
git clone <repo-url> backpressure && cd backpressure
corepack enable && pnpm install && pnpm run build   # -> dist/cli.js (the `backpressure` bin)
pnpm link --global                                   # or invoke: node /abs/backpressure/dist/cli.js
cd ~/my-project
backpressure init --target claude --dry-run          # preview
backpressure init --target claude                    # writes ./.claude/{settings.json,agents/reviewer.md,skills/...}
```

`init --target claude` writes exactly three files (no `.mcp.json` in v0): a Stop
hook running `pnpm test` (the gate), the `reviewer` subagent, and the
`building-adaptive-ui` skill. `init` reads its bundled skills from the **pack's
own location**, so it is run from the consumer repo with no copying.

---

## PROMPT

Replace `<PATH-TO-BACKPRESSURE>` (and `<URL>`/`<date>`) before running.

```text
You are a release tester. Verify that a developer who downloads the Backpressure
pack, builds it, and runs `backpressure init --target claude` in their own repo gets
WORKING Claude Code guardrails. Treat it as a BLACK BOX: drive only the shipped
surfaces (the `backpressure` bin and `pnpm` scripts) and observe REAL output. The
spec is docs/USER_GUIDE.md — read it first; do NOT use the unit tests as your oracle.

## Ground rules
- Do every install/run in THROWAWAY temp dirs (mktemp -d / a scratch dir). NEVER write
  `.claude/` into, or run loops against, the backpressure checkout itself.
- Do not "fix" anything. On failure, capture the exact command, exit code, and
  stdout/stderr, then continue. A check with no captured evidence is an automatic FAIL.
- Keep a running PASS/FAIL/BLOCKED table; save a final report to e2e-consumer-report-<date>.md.

## Phase 0 — Obtain + build the pack (as a downloader would)
1. Use the backpressure checkout at <PATH-TO-BACKPRESSURE> as the "downloaded" copy
   (or `git clone <URL>` into a temp dir). From it: `corepack enable && pnpm install && pnpm run build`.
2. Assert `dist/cli.js` exists and is executable.
3. `node dist/cli.js --help` must list FOUR subcommands: init, remove, build, index.
   (If you `pnpm link --global`, prefer the `backpressure` bin for later phases; otherwise
   invoke `node <abs>/dist/cli.js`.)

## Phase 1 — Make a realistic consumer repo (temp, NOT the pack)
In a fresh temp dir, create a minimal project whose `pnpm test` is OBSERVABLE, so we can
later prove the installed Stop hook actually fired:
- `git init` and one commit.
- `package.json`: { "name":"sample", "private":true, "scripts": { "test":"node gate-marker.mjs" } }
- `gate-marker.mjs`: appends an ISO timestamp line to `.gate.log` and exits 0
  (a real, dependency-free `pnpm test` that leaves a trace).
- Confirm `pnpm test` works and writes `.gate.log` (no `pnpm install` needed — no deps).

## Phase 2 — Install the guardrails (the consumer command)
Run FROM the consumer repo (do NOT copy the pack's skills/ — init reads them from the
pack's own location):
1. `backpressure init --target claude --dry-run` -> expect 3 `Planned:` lines and ZERO files
   written (verify the dir is unchanged).
2. `backpressure init --target claude` -> expect 3 `Wrote:` lines. Verify each file and its
   contents against docs/USER_GUIDE.md:
   - `.claude/settings.json` -> a Stop hook whose command is `pnpm test`.
   - `.claude/agents/reviewer.md` -> YAML frontmatter: name=reviewer, a description, tools Read+Grep.
   - `.claude/skills/building-adaptive-ui/SKILL.md` -> valid frontmatter; byte-identical to the
     pack's source skill.
   - Assert NO `.mcp.json` was written (v0 registers no MCP server).

## Phase 3 — Prove it actually works in Claude Code (the real-life part)
Still inside the consumer repo:
1. Delete `.gate.log`. Run a trivial headless turn that ends normally and triggers the Stop hook:
   `claude -p "Reply with the single word READY and do nothing else."`
   (This loads the project `.claude/settings.json` and fires the Stop hook on completion.)
2. PROVE the gate fired: assert `.gate.log` now exists with a fresh timestamp — that is the
   Stop hook having run `pnpm test`. This is the load-bearing check; capture both the claude
   output and the `.gate.log` contents.
3. Subagent check: `claude -p "List the names of the custom subagents available in this repo."`
   and confirm `reviewer` is reported (or, if headless listing is unreliable, confirm Claude
   can read .claude/agents/reviewer.md and summarize the reviewer).
4. Skill check: confirm `building-adaptive-ui` is discoverable (present under .claude/skills/
   and, optionally, that Claude can name it when asked what skills are available).
   NOTE: If headless `claude -p` cannot run in this environment (auth/sandbox), do NOT fail the
   install — mark Phase 3 BLOCKED, record why, and fall back to asserting the Stop hook is
   correctly REGISTERED in settings.json.

## Phase 4 — Error handling & lifecycle
1. `backpressure init --target bogus` -> a single clean `backpressure: …`/"Unknown target" line
   on stderr listing valid targets, non-zero exit, NO stack trace.
2. `backpressure remove --target claude --dry-run` then `backpressure remove --target claude` ->
   removes the installed skill (inverse of init); re-running reports "Skipped (not installed)".
3. `backpressure build` and `backpressure index` -> each prints "… : not yet implemented", exit 0.

## Known v0 gaps — confirm, do NOT report as bugs
- `build` and `index` are stubs. No `.mcp.json` / tracker is installed. The store is a JSON
  file. There is no bundled loop runner.

## Deliverable
A Markdown report: (1) a summary PASS/FAIL/BLOCKED table, one line per check; (2) for each FAIL,
the command + exit code + expected-vs-actual + output snippet; (3) real defects separated from
expected v0 gaps; (4) a final verdict — INSTALL WORKS / BROKEN — blockers first. Print the table
at the end.
```
