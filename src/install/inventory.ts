import { access } from "node:fs/promises";
import { cwd } from "node:process";
import type { AgentTarget } from "../seam/targets.js";
import {
  DEFAULT_CAPABILITIES,
  type InstallCapabilities,
  type PlannedFile,
  planInstall,
} from "./plan.js";

/** One installed-capability entry: a planned file and whether it exists on disk. */
export interface CapabilityEntry {
  kind: PlannedFile["kind"];
  path: string;
  present: boolean;
}

/** The slice of the filesystem {@link inventory} needs: an existence check only. */
export interface ExistsIo {
  exists(path: string): Promise<boolean>;
}

/** Default {@link ExistsIo} backed by `node:fs`. */
export const nodeExistsIo: ExistsIo = {
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
};

/** Options for {@link inventory}. */
export interface InventoryOptions {
  /** Capabilities to look for; defaults to {@link DEFAULT_CAPABILITIES}. */
  capabilities?: InstallCapabilities;
  /** Repo root to inventory; defaults to `process.cwd()`. */
  baseDir?: string;
  /** Existence-check wrapper; defaults to {@link nodeExistsIo}. Injected in tests. */
  io?: ExistsIo;
}

/**
 * Inventory the Backpressure capabilities installed in `baseDir` for `target` —
 * the read-only inverse of `init`/`build`. Derives the candidate file list from
 * the SAME pure planner {@link planInstall} (so there is no per-target branch
 * here), then checks each planned path for existence. The only side effect is
 * the injected existence check; nothing is read for content or written. See
 * `specs/index-command.md`.
 */
export async function inventory(
  target: AgentTarget,
  opts: InventoryOptions = {},
): Promise<CapabilityEntry[]> {
  const { capabilities = DEFAULT_CAPABILITIES, baseDir = cwd(), io = nodeExistsIo } = opts;

  const plan = planInstall(target, baseDir, capabilities);
  const entries: CapabilityEntry[] = [];
  for (const file of plan) {
    entries.push({ kind: file.kind, path: file.path, present: await io.exists(file.path) });
  }
  return entries;
}

/**
 * Render a {@link CapabilityEntry} list: one line per entry with a present/absent
 * marker (`[x]`/`[ ]`), the kind, and the path; then an
 * `N/M capabilities installed` summary. Pure.
 */
export function formatInventory(entries: CapabilityEntry[]): string {
  const present = entries.filter((e) => e.present).length;
  const lines = entries.map((e) => `${e.present ? "[x]" : "[ ]"} ${e.kind}\t${e.path}`);
  lines.push(`${present}/${entries.length} capabilities installed`);
  return `${lines.join("\n")}\n`;
}
