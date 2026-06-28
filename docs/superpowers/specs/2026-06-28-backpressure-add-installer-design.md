# Backpressure `add` — Remote Capability-Pack Installer (Design Spec)

- **Date:** 2026-06-28
- **Status:** Approved design — ready for implementation planning.
- **Supersedes:** the earlier "ship `/backpressure-loop` as a bundled skill" idea
  (Design B). That goal is now delivered as a *pack item* installed by `add`/`init`.

---

## 1. Summary

Add a new command — `npx backpressure@latest add <owner/repo>[@ref]` — that **fetches
a manifest-declared capability pack from a GitHub repo and installs it** into the
current repo (or user-global), compiling each declared capability to the chosen
CLI's native config. This turns Backpressure from "a pack with its own CLI" into
**a general installer for agent capability packs**, and is the mechanism by which
`/backpressure-loop` and its harness finally reach end users.

## 2. Motivation (how we got here)

The loop launcher `/backpressure-loop` and its harness (`scripts/ralph-loop.sh`,
`backpressure-gate.sh`, `Dockerfile.ralph`) live only in *this* repo. The published
package ships `files: ["dist","skills"]` — only the CLI and bundled skills — and
`init` installs `hook|mcp|agent|skill` capabilities into `.claude/.codex`. There is
**no concept of a "command" or "script" capability, and no way to distribute the
launcher to a consumer repo.** `add` closes that gap and generalises it: any repo
that declares a `backpressure.json` becomes installable with one `npx` line.

## 3. Locked decisions (with rationale)

| # | Decision | Why |
|---|----------|-----|
| A | `add` is a **generic GitHub-pack installer**; `owner/repo` is a real, meaningful argument. | The only reading where passing `owner/repo` earns its place; enables an ecosystem of packs. |
| i | A repo declares its pack via an **explicit `backpressure.json` manifest**. | Self-describing + validatable; it's the surface the trust prompt reads ("about to install X"); feeds the existing `planInstall` path. |
| copy | Install model is **copy real files into `.claude/.codex`**, with `.backpressure/` as the committed source-of-truth + bookkeeping. **Symlinks are NOT the default.** | Verified: Claude Code skill discovery does not reliably follow symlinks (regression since ~v2.1.69); Windows `fs.symlink` needs admin/Dev-Mode; Git-for-Windows checks committed symlinks out as text; symlinks-into-git dangle silently on clone. Copy is discovery-safe on every OS and is already how `init` writes. |
| picker | Interactive **numbered target picker** `1.Claude / 2.Codex / 3.Other` (**multi-select**), plus a **global/local scope** prompt. Flags (`--target`, `--global/--local`, `--yes`) bypass prompts for CI. | Matches the requested UX; multi-select lets a user equip several CLIs at once. |
| other | **"Other" materialises only portable *content*** — skill directories (and any bundled MCP server files) — under `.backpressure/`, with **no per-CLI registration** (no `hook`/`agent`/`command` written, and no MCP config, since registration is itself per-target). | Honest mapping of the Portable tier to a CLI we can't compile for; zero new adapters. The user wires their CLI to the materialised content manually. |
| link | Symlinks offered only as an **opt-in `--link` flag, Unix/macOS only, caveated**. | Preserves single-edit propagation for power users without making the fragile path the default. |

## 4. The contract — `backpressure.json`

A repo is an installable pack **iff** it contains `backpressure.json` at its root
(or at `<subdir>` when invoked as `owner/repo/subdir@ref`). It is zod-validated
before anything is written.

```jsonc
{
  "name": "backpressure-loop",
  "version": "1.0.0",
  "targets": ["claude", "codex"],          // CLIs this pack supports
  "items": [
    { "type": "skill",   "name": "backpressure-loop", "path": "skills/backpressure-loop" },
    { "type": "command", "name": "backpressure-loop", "path": "commands/backpressure-loop.md" },
    { "type": "agent",   "name": "reviewer",          "path": "agents/reviewer.md" },
    { "type": "hook",    "event": "Stop",             "command": "./scripts/backpressure-gate.sh" },
    { "type": "mcp",     "name": "tracker", "command": "node", "args": ["server.js"] }
  ],
  "scripts": ["scripts/backpressure-gate.sh", "scripts/ralph-loop.sh"]
}
```

**Item taxonomy:**

- **Copied-verbatim items** — `skill`, `command` — installed without per-target
  compilation. `skill` installs on every target that has a skills dir; `command`
  has a destination **only on Claude** (`.claude/commands/<name>.md`).
- **Compiled items** — `agent`, `hook`, `mcp` — emitted by the **existing**
  per-target emitters (`src/adapters/{claude,codex}/*`): JSON for Claude, TOML for
  Codex. No new code branches on target name.
- **`scripts`** — executable companions (e.g. the gate) that hooks/commands
  reference; copied with the executable bit preserved (as `init` already does for
  skill `scripts/`). They install under `.backpressure/scripts/<basename>`, and a
  `hook.command` (or command body) that references a declared script — written
  source-relative, e.g. `./scripts/backpressure-gate.sh` — is **resolved by the
  installer to its installed `.backpressure/scripts/` path**, so the author writes
  the natural path and the gate still runs post-install.

`command` and `script` are **two new installable kinds** added to today's
`hook|mcp|agent|skill` set. `command` is **Claude-only/portable**: Codex's
slash-command equivalent (`~/.codex/prompts/`) is user-level only and deprecated,
so Codex and "Other" **skip `command` items with a printed notice**.

## 5. The `add` pipeline

```
add owner/repo[@ref]
 1. parse PackRef     owner/repo[/subdir][@ref]                              (pure)
 2. fetch + PIN       resolve ref -> commit SHA (REST, optional GITHUB_TOKEN)
                      -> download codeload.github.com/.../tar.gz/<sha>
                      -> Node-20 DecompressionStream -> nanotar parse
                      -> strip the leading "<repo>-<ref>/" dir -> in-memory tree
 3. validate          read + zod-validate backpressure.json; assert each item path exists
 4. choose targets    prompt [1 Claude][2 Codex][3 Other] (multi)   | --target
    choose scope        prompt global(~) | local(cwd)               | --global/--local
 5. compile            reuse planInstall + adapters -> concrete per-target file plan
 6. TRUST gate         print owner/repo@<sha> + every hook command + every script
                      -> require confirmation                       | --yes
 7. write             materialize .backpressure/ (pack + lock + installed.json)
                      -> COPY real files into .claude/.codex -> MERGE hooks
                      -> record every written path + exact hook entry
 8. report            "Wrote: <path>" per file; "pinned owner/repo@<sha>"
```

`3.Other` materialises only portable *content* (skill dirs, bundled MCP server
files) under `.backpressure/`; nothing is registered into a CLI config, and
`command`/`hook`/`agent` items are skipped with a printed notice.

## 6. On-disk layout (copy model)

```
repo/
├─ .backpressure/
│  ├─ pack/                 # fetched, validated pack — source cache, offline re-compile
│  ├─ scripts/              # executable companions (e.g. backpressure-gate.sh), +x preserved
│  ├─ backpressure.lock     # { "source":"owner/repo", "ref":"main", "sha":"<40-hex>" }
│  └─ installed.json        # every written path + exact hook entries, per target
├─ .claude/
│  ├─ skills/backpressure-loop/…        # real copies — discovery-safe on every OS
│  ├─ commands/backpressure-loop.md
│  ├─ agents/reviewer.md
│  └─ settings.json                     # hook merged in (recorded in installed.json)
└─ .codex/config.toml                   # hooks (+ mcp when registered)
```

- **Global** install mirrors this under `~/.backpressure/` -> `~/.claude/`, `~/.codex/`.
- **VCS (recommended):** commit `.backpressure/` **and** the `.claude/.codex`
  copies — all real files, zero dangling links, work on `git clone` with no regen
  step. (Lean alternative: gitignore the copies and regenerate via a future
  `restore`; rejected for v0 to avoid an extra post-clone step.)
- `--link` (Unix-only) swaps the copies for **relative** symlinks (never absolute,
  never junctions) for single-edit propagation.

## 7. Components

New `src/add/*` modules; every `src/` file ships its sibling `test/` file in the
same change. Side effects (network, fs) sit behind small injectable seams so units
test without touching disk or the network — matching the existing `InstallIo` /
`SpawnFn` pattern.

| Module | Responsibility | Side effects |
|--------|----------------|--------------|
| `add/ref.ts` | parse `owner/repo[/subdir][@ref]` → `PackRef` | pure |
| `add/manifest.ts` | `PackManifestSchema` (zod) + `parseManifest` | pure |
| `add/fetch.ts` | `fetchPack(ref, fetcher)` — ref→SHA pin, codeload download, decompress, **nanotar** parse, strip dir → `Map<path,Uint8Array>` | network, behind `PackFetcher` |
| `add/safejoin.ts` | `safeResolve(root, entry)` — reject `..`/absolute/symlink entries (zip-slip) | pure |
| `add/plan.ts` | `planAdd(manifest, targets, scope)` → reuses `planInstall`; maps new `command`/`script` items | pure |
| `add/trust.ts` | `summarizeTrust(manifest, sha)` (pure) + injectable `Prompter` (target/scope/confirm) | seam |
| `add/write.ts` | materialize `.backpressure/`, copy into `.claude/.codex`, merge hooks, write `installed.json` | `InstallIo` |
| `add/installed.ts` | `installed.json` schema + read/write; `remove` reverses from it | `InstallIo` |
| `cli.ts` | register `add` (`--target/--global/--local/--ref/--yes/--link`); teach `remove` to consume `installed.json` | — |
| `adapters/*` | new `command` emitter (Claude `.claude/commands/<name>.md`; Codex/Other skip); a **tagged, removable** hook merge | seam |

**Invariants preserved:** only `src/seam/` and `src/adapters/` branch on which CLI
— the fetch/extract/manifest code is target-agnostic. Author once, compile per
target still holds: a remote pack declares each item once; the same emitters
compile to JSON or TOML.

## 8. Dependencies

**Exactly one new runtime dependency: `nanotar`** (zero transitive deps, ESM,
Node 18+). `fetch` and gzip decompression are Node-20 built-ins
(`DecompressionStream`). Rejected: `tar` (+5 transitive deps) and `degit` (needs a
`git` binary for private/SSH, contradicting the "no git required" goal). Hand-rolled
USTAR parsing is rejected too: GitHub tarballs begin with `pax_global_header` and
may carry GNU/pax long-name records, and the caller would own extraction security.

## 9. Error handling

All expected failures are typed `InstallError`s, surfaced as a single
`backpressure: …` line with no stack trace (matching today's convention):

- Missing / invalid `backpressure.json`, or a declared item path absent.
- `404` (bad repo/ref); `403` (rate limit → "set `GITHUB_TOKEN`"); private repo
  without a token.
- Unsafe tar entry (zip-slip) → refuse and name the entry.
- Target not in `manifest.targets` → error listing supported targets.
- `--link` on Windows → refuse and fall back to copy with a notice.

Re-install is **idempotent** via `installed.json`: prior entries are removed before
the new write, so hooks never duplicate in `settings.json`/`config.toml`.

## 10. Security / trust model

`add` installs **third-party code that later runs on the user's machine** (hook
commands fire on the Stop gate; `scripts/*.sh` carry the exec bit). Therefore:

- Resolve a moving ref to an **immutable commit SHA** and pin it (`backpressure.lock`).
  Never pin a tarball content hash (GitHub's gzip bytes are not reproducible).
- The **trust gate** prints `owner/repo@<sha>` and lists *every* hook command and
  executable script the pack will install, and requires confirmation (`--yes` to skip
  in CI).
- The extraction writer is **zip-slip-safe** (rejects `..`, absolute paths, and
  symlink entries).

## 11. Testing

- Sibling unit tests for every module; `fetch` behind a **fake `PackFetcher`** so no
  unit test touches the network. One opt-in integration test hits `codeload` behind
  an env flag.
- `@acceptance` suite: manifest valid/invalid; zip-slip vectors refused; `planAdd`
  maps `command`/`script` and `Other`=portable-only; **hook merge/remove idempotency**
  (install twice → no duplicate; remove → no orphan in `settings.json`); copy
  preserves the exec bit; `installed.json` round-trips; the pinned SHA lands in the
  lock.

## 12. Scope & sequencing (one spec, three sequenced plans)

This is a large feature. Recommended build order — each phase is independently
green and useful:

1. **Phase 1 — Pack format + new capability kinds (no network).** `backpressure.json`
   schema; `command` + `script` items; plan/adapter/emit; `installed.json`; and let
   **`init`** install a *local* pack directory. **→ Delivers shippable
   `/backpressure-loop` (the original goal) with zero network code.**
2. **Phase 2 — Remote fetch.** `ref`/`fetch`/`safejoin` + SHA pinning + `nanotar`;
   `add` works end-to-end against GitHub; `--yes` for non-interactive runs.
3. **Phase 3 — Interactive UX + remove + docs.** target/scope pickers, trust prompt,
   `--link`; `remove` via `installed.json`; README + `USER_GUIDE.md` "Running the loop
   in practice" write-up.

## 13. Open questions / deferred

- **Codex adapter pre-existing bugs (separate follow-up, may gate Phase-3 Codex
  support):** inline `[agents.<name>]` emits `prompt`/`tools`, which Codex's
  `AgentRoleToml` (`deny_unknown_fields`) rejects — real agents need standalone
  `.codex/agents/<name>.toml` with `developer_instructions`; project skills may need
  `.agents/skills` (not `.codex/skills`); project `.codex/config.toml` is ignored
  unless the project is **trusted**. Codex `hook`/`mcp` emitters are verified correct.
- **Token policy** for private packs: `GITHUB_TOKEN` env only (recommended), vs. also
  shelling to `gh auth token` (reintroduces an external-tool dependency).
- **Monorepo subtree packs** (`owner/repo/path@ref`): support in v0, or whole-repo only?
- **`@ref` resolution:** exact branch/tag/SHA only, or also accept a semver tag range?
- **Windows support stance:** is Windows a first-class target (forces copy default;
  symlinks opt-in/Unix-only)?

## 14. Non-goals (v0)

- No marketplace/registry index — `add` resolves a single `owner/repo@ref`.
- No signature/attestation verification beyond commit-SHA pinning + explicit confirm.
- No automatic update/upgrade command (re-running `add` is the update path).
- No change to the loop runtime — Backpressure remains a capability pack, not a runner.

---

## Appendix — Verified assumptions (research pass, 2026-06-28)

Facts that the design rests on, from a four-agent verification workflow (sources
abbreviated):

- **Claude Code discovery** is at documented paths: `.claude/skills/<name>/SKILL.md`,
  `.claude/agents/<name>.md`, `.claude/commands/<name>.md`, hooks in
  `.claude/settings.json`; user-level under `~/.claude/`. *(high confidence)*
- **Symlinked skill discovery is unreliable** in Claude Code (regression ~v2.1.69;
  `/skills` won't list symlinked skills) → **drives the copy-default decision.**
  *(medium–high)*
- **Hooks JSON shape:** `{ "hooks": { "Stop": [ { "hooks": [ { "type":"command",
  "command":"…" } ] } ] } }`; Stop omits `matcher`; arrays concatenate on merge with
  **no stable id** → removal must be driven by a recorded manifest, not string-match.
  *(high)*
- **Codex** reads project `.codex/config.toml` (loaded only when the project is
  trusted); `hook` and `mcp` TOML shapes in the repo are correct; **inline
  `[agents.*]` with `prompt`/`tools` is rejected** by Codex's schema. *(high)*
- **Fetch:** `codeload.github.com/<o>/<r>/tar.gz/<ref>` serves public tarballs with no
  auth and is **not** REST-rate-limited; resolve `ref`→SHA via `GET
  /repos/{o}/{r}/commits/{ref}` with `Accept: application/vnd.github.sha`; Node-20
  `fetch` + `DecompressionStream` need **zero** deps; **`nanotar`** is the one needed
  dep (parse-only → caller owns zip-slip safety). *(high)*
- **Symlink VCS hazards:** git stores symlinks as mode `120000` (target path);
  Git-for-Windows checks them out as text (`core.symlinks=false` default); committed
  links into a gitignored dir dangle **silently** (clean `git status`). *(high)*
