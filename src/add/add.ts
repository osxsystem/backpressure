import { join } from "node:path";
import { type InstallIo, nodeInstallIo } from "../install/init.js";
import {
  type BytesIo,
  fetchPack,
  nodeBytesIo,
  nodePackFetcher,
  type PackFetcher,
} from "./fetch.js";
import { installPack } from "./install-pack.js";
import { serializeLock } from "./lock.js";
import { parseManifest } from "./manifest.js";
import type { InstallChoice } from "./pack.js";
import { parseRef } from "./ref.js";
import { confirmInstall, type Prompter } from "./trust.js";

/** Injectable side-effect seams for {@link addPack}. */
export interface AddDeps {
  io: InstallIo;
  bytesIo: BytesIo;
  fetcher: PackFetcher;
  prompter: Prompter;
}

/** Caller choices for {@link addPack}. */
export interface AddOptions {
  choice: InstallChoice;
  baseDir: string;
  yes?: boolean;
}

/**
 * Install a GitHub-hosted capability pack: parse the ref, fetch + pin it, gate it
 * behind the trust prompt, install via the Phase-1 {@link installPack}, then write
 * `.backpressure/backpressure.lock`. Returns the written files, the pinned SHA,
 * and any per-target skip notices.
 */
export async function addPack(
  arg: string,
  opts: AddOptions,
  deps?: AddDeps,
): Promise<{ files: string[]; sha: string; notices: string[] }> {
  const d = deps ?? {
    io: nodeInstallIo,
    bytesIo: nodeBytesIo,
    fetcher: nodePackFetcher,
    prompter: { confirm: async () => false } satisfies Prompter,
  };

  const ref = parseRef(arg);
  const { dir, sha } = await fetchPack(ref, d.bytesIo, d.fetcher);

  const manifest = parseManifest(await d.io.readText(join(dir, "backpressure.json")));
  const source = ref.subdir ? `${ref.owner}/${ref.repo}/${ref.subdir}` : `${ref.owner}/${ref.repo}`;
  await confirmInstall(manifest, source, sha, d.prompter, { yes: opts.yes });

  const { installed, notices } = await installPack(dir, opts.choice, opts.baseDir, d.io);

  const lockPath = join(opts.baseDir, ".backpressure", "backpressure.lock");
  await d.io.ensureDir(join(opts.baseDir, ".backpressure"));
  await d.io.writeText(lockPath, serializeLock({ source, ref: ref.ref ?? "default", sha }));

  return { files: installed.files, sha, notices };
}
