import { basename, join } from "node:path";
import { emitClaudeAgents } from "../adapters/claude/agents.js";
import { emitClaudeHooks } from "../adapters/claude/hooks.js";
import { emitClaudeMcp } from "../adapters/claude/mcp.js";
import { emitCodexAgents } from "../adapters/codex/agents.js";
import { emitCodexHooks } from "../adapters/codex/hooks.js";
import { emitCodexMcp } from "../adapters/codex/mcp.js";
import type { PackItem, PackManifest } from "./manifest.js";
import { safeResolve } from "./safejoin.js";
import { rewriteScriptRefs } from "./scripts.js";

/** Which CLI the user is installing for; "other" = portable content only. */
export type InstallChoice = "claude" | "codex" | "other";

/** One filesystem operation the installer will perform. */
export type PackOp =
  | { op: "copyTree"; from: string; to: string }
  | { op: "copyFile"; from: string; to: string }
  | { op: "writeText"; path: string; contents: string };

/** A pure plan: the ops to perform plus any user-facing skip notices. */
export interface PackPlan {
  ops: PackOp[];
  notices: string[];
}

const byType = <T extends PackItem["type"]>(items: PackItem[], type: T) =>
  items.filter((i): i is Extract<PackItem, { type: T }> => i.type === type);

/**
 * Compile a validated manifest into write ops for `choice`, rooted at `baseDir`.
 * Pure — the emitters it calls are pure and it performs no I/O. `skill`/`command`
 * become file copies from `packDir`; `agent`/`hook`/`mcp` are compiled per target
 * via the existing adapters; `scripts` always land under `.backpressure/scripts/`.
 *
 * All manifest-derived source and destination paths are validated via
 * {@link safeResolve} to prevent path-traversal (a hostile pack cannot write
 * outside `packDir` or `baseDir`).
 */
export function planPack(
  packDir: string,
  manifest: PackManifest,
  choice: InstallChoice,
  baseDir: string,
): PackPlan {
  const ops: PackOp[] = [];
  const notices: string[] = [];
  const abs = (...p: string[]): string => join(baseDir, ...p);

  for (const s of manifest.scripts) {
    ops.push({
      op: "copyFile",
      from: safeResolve(packDir, s),
      to: safeResolve(join(baseDir, ".backpressure", "scripts"), basename(s)),
    });
  }

  const skills = byType(manifest.items, "skill");
  const commands = byType(manifest.items, "command");

  if (choice === "other") {
    for (const sk of skills) {
      ops.push({
        op: "copyTree",
        from: safeResolve(packDir, sk.path),
        to: safeResolve(join(baseDir, ".backpressure", "skills"), sk.name),
      });
    }
    for (const c of commands)
      notices.push(`skipped command "${c.name}" — no destination for an unknown CLI`);
    if (manifest.items.some((i) => i.type === "agent" || i.type === "hook" || i.type === "mcp")) {
      notices.push("skipped hooks/agents/mcp — no adapter for an unknown CLI");
    }
    return { ops, notices };
  }

  const configDir = choice === "claude" ? ".claude" : ".codex";
  for (const sk of skills) {
    ops.push({
      op: "copyTree",
      from: safeResolve(packDir, sk.path),
      to: safeResolve(join(baseDir, configDir, "skills"), sk.name),
    });
  }

  const hookDefs = byType(manifest.items, "hook").map((h) => ({
    event: h.event,
    command: rewriteScriptRefs(h.command, manifest.scripts),
    ...(h.matcher !== undefined ? { matcher: h.matcher } : {}),
  }));
  const agentDefs = byType(manifest.items, "agent").map((a) => ({
    name: a.name,
    description: a.description,
    prompt: a.prompt,
    ...(a.tools !== undefined ? { tools: a.tools } : {}),
  }));
  const mcpDefs = byType(manifest.items, "mcp").map((m) => ({
    name: m.name,
    command: m.command,
    args: m.args,
    ...(m.env !== undefined ? { env: m.env } : {}),
  }));

  if (choice === "claude") {
    for (const c of commands) {
      ops.push({
        op: "copyFile",
        from: safeResolve(packDir, c.path),
        to: safeResolve(join(baseDir, ".claude", "commands"), `${c.name}.md`),
      });
    }
    if (hookDefs.length > 0) {
      ops.push({
        op: "writeText",
        path: abs(".claude", "settings.json"),
        contents: `${JSON.stringify(emitClaudeHooks(hookDefs), null, 2)}\n`,
      });
    }
    if (mcpDefs.length > 0) {
      ops.push({
        op: "writeText",
        path: abs(".mcp.json"),
        contents: `${JSON.stringify(emitClaudeMcp(mcpDefs), null, 2)}\n`,
      });
    }
    for (const af of emitClaudeAgents(agentDefs)) {
      ops.push({ op: "writeText", path: abs(af.path), contents: af.contents });
    }
    return { ops, notices };
  }

  // choice === "codex": one config.toml carries hooks + mcp + agents.
  for (const c of commands)
    notices.push(`skipped command "${c.name}" — Codex has no project-level command surface`);
  const fragments: string[] = [];
  if (hookDefs.length > 0) fragments.push(emitCodexHooks(hookDefs));
  if (mcpDefs.length > 0) fragments.push(emitCodexMcp(mcpDefs));
  if (agentDefs.length > 0) fragments.push(emitCodexAgents(agentDefs));
  if (fragments.length > 0) {
    ops.push({
      op: "writeText",
      path: abs(".codex", "config.toml"),
      contents: fragments.join("\n"),
    });
  }
  return { ops, notices };
}
