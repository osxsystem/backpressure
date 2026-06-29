import { basename, dirname, join, relative } from "node:path";
import { InvalidPackManifestError, isEnoent } from "../install/errors.js";
import { type InstallIo, nodeInstallIo } from "../install/init.js";
import { type InstalledManifest, serializeInstalled } from "./installed.js";
import type { PackItem } from "./manifest.js";
import { parseManifest } from "./manifest.js";
import { type InstallChoice, planPack } from "./pack.js";
import { rewriteScriptRefs } from "./scripts.js";

/** The outcome of {@link installPack}: what was recorded, plus skip notices. */
export interface InstallPackResult {
  installed: InstalledManifest;
  notices: string[];
}

/**
 * Install a local pack directory (containing `backpressure.json`) into `baseDir`
 * for `choice`. Reads + validates the manifest, plans the write ops via
 * {@link planPack}, executes them through `io`, and records an
 * `installed.json`. Network-free — the Phase-2 `add` command fetches a pack into
 * a temp dir and then calls this.
 */
export async function installPack(
  packDir: string,
  choice: InstallChoice,
  baseDir: string,
  io: InstallIo = nodeInstallIo,
): Promise<InstallPackResult> {
  const manifest = parseManifest(await io.readText(join(packDir, "backpressure.json")));

  if (choice !== "other" && !manifest.targets.includes(choice)) {
    throw new InvalidPackManifestError(
      `pack "${manifest.name}" does not support target "${choice}". Supported: ${manifest.targets.join(", ")}`,
    );
  }

  const { ops, notices } = planPack(packDir, manifest, choice, baseDir);
  const files: string[] = [];
  const rel = (p: string): string => relative(baseDir, p);

  // Pre-flight: verify every copy SOURCE exists before writing anything, so a
  // manifest that references a missing/empty source fails atomically — no
  // partial install (e.g. a stale `.backpressure/scripts/` dir or a half-copied
  // file) is left in the target. Mirrors init's validate-before-write gate.
  for (const op of ops) {
    if (op.op === "copyTree") {
      let rels: string[];
      try {
        rels = await io.listFiles(op.from);
      } catch (e) {
        if (isEnoent(e)) throw new InvalidPackManifestError(`item source not found: ${op.from}`);
        throw e;
      }
      if (rels.length === 0) throw new InvalidPackManifestError(`item source is empty: ${op.from}`);
    } else if (op.op === "copyFile") {
      let siblings: string[];
      try {
        siblings = await io.listFiles(dirname(op.from));
      } catch (e) {
        if (isEnoent(e)) throw new InvalidPackManifestError(`item source not found: ${op.from}`);
        throw e;
      }
      if (!siblings.includes(basename(op.from)))
        throw new InvalidPackManifestError(`item source not found: ${op.from}`);
    }
  }

  for (const op of ops) {
    if (op.op === "copyTree") {
      let rels: string[];
      try {
        rels = await io.listFiles(op.from);
      } catch (e) {
        if (isEnoent(e)) throw new InvalidPackManifestError(`item source not found: ${op.from}`);
        throw e;
      }
      if (rels.length === 0) throw new InvalidPackManifestError(`item source is empty: ${op.from}`);
      for (const r of rels) {
        const dest = join(op.to, r);
        await io.ensureDir(dirname(dest));
        await io.copyFile(join(op.from, r), dest);
        files.push(rel(dest));
      }
    } else if (op.op === "copyFile") {
      await io.ensureDir(dirname(op.to));
      try {
        await io.copyFile(op.from, op.to);
      } catch (e) {
        if (isEnoent(e)) throw new InvalidPackManifestError(`item source not found: ${op.from}`);
        throw e;
      }
      files.push(rel(op.to));
    } else {
      await io.ensureDir(dirname(op.path));
      await io.writeText(op.path, op.contents);
      files.push(rel(op.path));
    }
  }

  const hooks =
    choice === "other"
      ? []
      : manifest.items
          .filter((i): i is Extract<PackItem, { type: "hook" }> => i.type === "hook")
          .map((h) => ({
            event: h.event,
            command: rewriteScriptRefs(h.command, manifest.scripts),
            ...(h.matcher !== undefined ? { matcher: h.matcher } : {}),
          }));

  const installed: InstalledManifest = {
    name: manifest.name,
    version: manifest.version,
    choice,
    files,
    hooks,
  };
  const installedPath = join(baseDir, ".backpressure", "installed.json");
  await io.ensureDir(dirname(installedPath));
  await io.writeText(installedPath, serializeInstalled(installed));

  return { installed, notices };
}
