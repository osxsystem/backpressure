import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseTarGzip } from "nanotar";
import { PackFetchError } from "../install/errors.js";
import type { PackRef } from "./ref.js";
import { safeResolve } from "./safejoin.js";

/** Network seam: resolve a ref to a SHA and download the repo tarball. */
export interface PackFetcher {
  resolveSha(ref: PackRef): Promise<string>;
  downloadTarball(ref: PackRef, sha: string): Promise<Uint8Array>;
}

/**
 * Minimal fs seam for byte writes + temp dirs (kept separate from InstallIo).
 * NOTE: mode is a string (e.g. "755") to match nanotar's TarFileAttrs.mode type.
 */
export interface BytesIo {
  ensureDir(p: string): Promise<void>;
  writeBytes(p: string, data: Uint8Array, mode?: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
}

export const nodeBytesIo: BytesIo = {
  ensureDir: async (p) => void (await mkdir(p, { recursive: true })),
  writeBytes: async (p, data, mode) => {
    await writeFile(p, data);
    if (mode !== undefined) await chmod(p, mode);
  },
  mkdtemp: (prefix) => mkdtemp(join(tmpdir(), prefix)),
};

const GH_API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";

function authHeaders(): Record<string, string> {
  const t = process.env.GITHUB_TOKEN;
  return {
    accept: "application/vnd.github+json",
    "user-agent": "backpressure-add",
    ...(t ? { authorization: `Bearer ${t}` } : {}),
  };
}

/**
 * Build a status-aware {@link PackFetchError} for GitHub API responses.
 * 403 → rate-limit / token hint; 404 → not-found / private hint; else → generic.
 */
function ghError(status: number, what: string): PackFetchError {
  if (status === 403)
    return new PackFetchError(
      "GitHub access denied (403) — rate limit, or set GITHUB_TOKEN with repo scope for a private repo.",
    );
  if (status === 404)
    return new PackFetchError(
      `${what} not found, or private repo — set GITHUB_TOKEN with repo scope to access private repos.`,
    );
  return new PackFetchError(`${what} (${status}).`);
}

export const nodePackFetcher: PackFetcher = {
  async resolveSha(ref) {
    const r = ref.ref ?? (await defaultBranch(ref));
    const res = await fetch(`${GH_API}/repos/${ref.owner}/${ref.repo}/commits/${r}`, {
      headers: { ...authHeaders(), accept: "application/vnd.github.sha" },
    });
    if (!res.ok) throw ghError(res.status, `cannot resolve ${ref.owner}/${ref.repo}@${r}`);
    return (await res.text()).trim();
  },
  async downloadTarball(ref, sha) {
    const res = await fetch(`${CODELOAD}/${ref.owner}/${ref.repo}/tar.gz/${sha}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw ghError(res.status, `cannot download ${ref.owner}/${ref.repo}@${sha}`);
    return new Uint8Array(await res.arrayBuffer());
  },
};

async function defaultBranch(ref: PackRef): Promise<string> {
  const res = await fetch(`${GH_API}/repos/${ref.owner}/${ref.repo}`, { headers: authHeaders() });
  if (!res.ok) throw ghError(res.status, `cannot read ${ref.owner}/${ref.repo}`);
  return ((await res.json()) as { default_branch: string }).default_branch;
}

/**
 * Fetch + pin + extract a pack to a fresh temp dir. Resolves the ref to an
 * immutable SHA, downloads the GitHub tarball, gunzips + parses it (nanotar),
 * strips the leading `<repo>-<sha>/` wrapper, and writes each file under a temp
 * dir via {@link safeResolve} (zip-slip-safe). Honours `ref.subdir` as the pack
 * root. Returns the dir to hand to `installPack` plus the pinned SHA.
 */
export async function fetchPack(
  ref: PackRef,
  io: BytesIo,
  fetcher: PackFetcher,
): Promise<{ dir: string; sha: string }> {
  const sha = await fetcher.resolveSha(ref);
  const bytes = await fetcher.downloadTarball(ref, sha);
  const entries = await parseTarGzip(bytes);
  const root = await io.mkdtemp("bp-add-");

  // Strip GitHub's "<repo>-<sha>/" wrapper, then optional subdir.
  const stripPrefix = `${ref.repo}-${sha}/`;
  const subPrefix = ref.subdir ? `${ref.subdir.replace(/\/$/, "")}/` : "";

  let wrote = 0;
  for (const e of entries) {
    if (e.type !== "file" || !e.data) continue;
    if (!e.name.startsWith(stripPrefix)) continue;
    let rel = e.name.slice(stripPrefix.length);
    if (subPrefix) {
      if (!rel.startsWith(subPrefix)) continue;
      rel = rel.slice(subPrefix.length);
    }
    if (!rel) continue;
    const dest = safeResolve(root, rel);
    await io.ensureDir(dirname(dest));
    await io.writeBytes(dest, e.data, e.attrs?.mode);
    wrote++;
  }
  if (wrote === 0)
    throw new PackFetchError(`pack at ${ref.owner}/${ref.repo} is empty or subdir not found.`);
  return { dir: root, sha };
}
