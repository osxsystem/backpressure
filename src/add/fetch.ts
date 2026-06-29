import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
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
 * 403 → rate-limit / scope hint; 404 → not-found / access hint; else → generic.
 *
 * `hasToken` tailors the hint: when a `GITHUB_TOKEN` is already set, re-suggesting
 * "set GITHUB_TOKEN" is confusing, so the message points at the likely real cause
 * (rate limit, or the token lacking `repo` scope) instead. Defaults to reading the
 * env; pass it explicitly in tests. Exported for unit testing.
 */
export function ghError(
  status: number,
  what: string,
  hasToken: boolean = (process.env.GITHUB_TOKEN ?? "") !== "",
): PackFetchError {
  if (status === 403)
    return new PackFetchError(
      hasToken
        ? "GitHub access denied (403) — rate limit exceeded, or the token lacks the required scope for this repo."
        : "GitHub access denied (403) — rate limit, or set GITHUB_TOKEN with repo scope for a private repo.",
    );
  if (status === 404)
    return new PackFetchError(
      hasToken
        ? `${what} not found, or the token lacks access (a private repo needs the \`repo\` scope).`
        : `${what} not found, or private repo — set GITHUB_TOKEN with repo scope to access private repos.`,
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

/** One extracted regular file from the tarball (dirs/symlinks/meta are dropped). */
interface TarFile {
  /** Full, normalised path (ustar `prefix` + `name` rejoined). */
  name: string;
  data: Uint8Array;
  /** Octal permission string (e.g. `"0000755"`), or undefined if unset. */
  mode?: string;
}

/** Read a NUL-terminated field from a tar header. */
function tarField(buf: Buffer, off: number, len: number): string {
  let end = off;
  const max = off + len;
  while (end < max && buf[end] !== 0) end++;
  return buf.toString("ascii", off, end);
}

/**
 * Normalise a tar entry path the way a safe extractor must: forward slashes,
 * no drive/leading-slash, and `..`/`.` segments resolved away. Mirrors nanotar's
 * `_sanitizePath` so a hostile `prefix/../../../evil` collapses to `evil` (which
 * then fails the wrapper-prefix filter and is dropped) — keeping the existing
 * zip-slip posture while we read the real header ourselves.
 */
function sanitizeTarPath(p: string): string {
  const s = p
    .replace(/\\/g, "/")
    .replace(/^[a-zA-Z]:\//, "")
    .replace(/^\/+/, "");
  const out: string[] = [];
  for (const part of s.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

/**
 * Gunzip + parse a POSIX **ustar** tar into its regular files. Unlike nanotar
 * 0.3.0 (which reads only the 100-byte `name` field), this also reads the ustar
 * `prefix` field at bytes 345–499 and rejoins `prefix/name`, so paths over 100
 * chars — which GitHub's codeload server stores split — are recovered instead of
 * silently truncated to their basename and dropped. PAX (`x`) and GNU (`L`) long
 * names override the next entry's path; meta entries (`g`/`x`/`L`) and non-files
 * (dirs `5`, symlinks, …) carry no data and are skipped.
 */
function parseUstarTarGzip(gz: Uint8Array): TarFile[] {
  const buf = gunzipSync(Buffer.from(gz));
  const files: TarFile[] = [];
  let off = 0;
  let longName: string | undefined; // pending override from a PAX/GNU header
  while (off + 512 <= buf.length) {
    const name = tarField(buf, off, 100);
    if (name === "") break; // end-of-archive zero block
    const size = Number.parseInt(tarField(buf, off + 124, 12).trim() || "0", 8) || 0;
    const type = String.fromCharCode(buf[off + 156] ?? 0x30);
    const dataStart = off + 512;
    const next = dataStart + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "g") {
      if (type === "x") {
        const m = /\d+ path=([^\n]*)\n/.exec(buf.toString("utf8", dataStart, dataStart + size));
        if (m) longName = m[1];
      }
      off = next;
      continue;
    }
    if (type === "L") {
      longName = tarField(buf, dataStart, size);
      off = next;
      continue;
    }
    if (type === "0" || type === "\0") {
      const prefix = tarField(buf, off + 345, 155);
      const full = longName ?? (prefix ? `${prefix}/${name}` : name);
      const mode = tarField(buf, off + 100, 8).trim();
      files.push({
        name: sanitizeTarPath(full),
        data: new Uint8Array(buf.subarray(dataStart, dataStart + size)),
        mode: mode || undefined,
      });
    }
    longName = undefined;
    off = next;
  }
  return files;
}

/**
 * Fetch + pin + extract a pack to a fresh temp dir. Resolves the ref to an
 * immutable SHA, downloads the GitHub tarball, gunzips + parses it
 * ({@link parseUstarTarGzip}), strips the leading `<repo>-<sha>/` wrapper, and
 * writes each file under a temp dir via {@link safeResolve} (zip-slip-safe).
 * Honours `ref.subdir` as the pack root. Returns the dir to hand to `installPack`
 * plus the pinned SHA.
 */
export async function fetchPack(
  ref: PackRef,
  io: BytesIo,
  fetcher: PackFetcher,
): Promise<{ dir: string; sha: string }> {
  const sha = await fetcher.resolveSha(ref);
  const bytes = await fetcher.downloadTarball(ref, sha);
  const entries = parseUstarTarGzip(bytes);
  const root = await io.mkdtemp("bp-add-");

  // Strip GitHub's "<repo>-<sha>/" wrapper, then optional subdir.
  const stripPrefix = `${ref.repo}-${sha}/`;
  const subPrefix = ref.subdir ? `${ref.subdir.replace(/\/$/, "")}/` : "";

  let wrote = 0;
  for (const e of entries) {
    if (!e.name.startsWith(stripPrefix)) continue;
    let rel = e.name.slice(stripPrefix.length);
    if (subPrefix) {
      if (!rel.startsWith(subPrefix)) continue;
      rel = rel.slice(subPrefix.length);
    }
    if (!rel) continue;
    const dest = safeResolve(root, rel);
    await io.ensureDir(dirname(dest));
    await io.writeBytes(dest, e.data, e.mode);
    wrote++;
  }
  if (wrote === 0)
    throw new PackFetchError(`pack at ${ref.owner}/${ref.repo} is empty or subdir not found.`);
  return { dir: root, sha };
}
