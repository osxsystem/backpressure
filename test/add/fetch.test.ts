import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createTarGzip } from "nanotar";
import { describe, expect, it } from "vitest";
import type { PackFetcher } from "../../src/add/fetch.js";
import { fetchPack, ghError, nodeBytesIo } from "../../src/add/fetch.js";
import { safeResolve } from "../../src/add/safejoin.js";
import { PackFetchError, UnsafePackEntryError } from "../../src/install/errors.js";

// GitHub tarballs wrap everything in a top-level "<repo>-<sha>/" dir.
// NOTE: nanotar's TarFileAttrs.mode is a string (e.g. "755"), not a number.
async function fakeTarball(prefix: string): Promise<Uint8Array> {
  return createTarGzip([
    { name: `${prefix}/backpressure.json`, data: '{"name":"p"}' },
    { name: `${prefix}/scripts/gate.sh`, data: "#!/bin/sh\n", attrs: { mode: "755" } },
  ]);
}

/**
 * Build a POSIX **ustar** tar (gzipped) where each entry's path is split into the
 * `prefix` field (header bytes 345–499, the dirname) and the `name` field (bytes
 * 0–99, the basename) — exactly how GitHub's codeload server stores any path over
 * 100 chars. nanotar's own `createTarGzip` cannot produce this (it only writes the
 * 100-byte name field), so a hand-built header is the only faithful repro.
 */
function ustarPrefixSplitGzip(
  entries: { dir: string; base: string; data: string; mode: string }[],
) {
  const blocks = entries.map(({ dir, base, data, mode }) => {
    const h = Buffer.alloc(512);
    h.write(base, 0, 100, "ascii"); // name (basename only)
    h.write(`${mode.padStart(7, "0")}\0`, 100, 8, "ascii"); // mode
    h.write("0001750\0", 108, 8, "ascii"); // uid
    h.write("0001750\0", 116, 8, "ascii"); // gid
    const size = Buffer.byteLength(data);
    h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii"); // size
    h.write("00000000000\0", 136, 12, "ascii"); // mtime
    h.write("0", 156, 1, "ascii"); // typeflag = regular file
    h.write("ustar\0", 257, 6, "ascii"); // magic
    h.write("00", 263, 2, "ascii"); // version
    h.write(dir, 345, 155, "ascii"); // prefix (dirname) — the ustar split
    h.write("        ", 148, 8, "ascii"); // checksum field = spaces while summing
    let sum = 0;
    for (const byte of h) sum += byte;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii"); // checksum
    const body = Buffer.alloc(Math.ceil(size / 512) * 512);
    body.write(data, 0, "utf8");
    return Buffer.concat([h, body]);
  });
  return new Uint8Array(gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])));
}

describe("fetchPack", () => {
  it("pins the sha, strips the top dir, and extracts files to a temp dir", async () => {
    const sha = "a".repeat(40);
    const fetcher: PackFetcher = {
      resolveSha: async () => sha,
      downloadTarball: async () => fakeTarball(`backpressure-${sha}`),
    };
    const { dir, sha: pinned } = await fetchPack(
      { owner: "o", repo: "backpressure" },
      nodeBytesIo,
      fetcher,
    );
    expect(pinned).toBe(sha);
    expect(await readFile(join(dir, "backpressure.json"), "utf8")).toContain('"name":"p"');
    expect(await readFile(join(dir, "scripts/gate.sh"), "utf8")).toContain("#!/bin/sh");
    const { mode } = await stat(join(dir, "scripts/gate.sh"));
    expect(mode & 0o111).toBeGreaterThan(0); // at least one exec bit set
  });

  // SECURITY FINDING: nanotar's parseTarGzip normalises "../" out of entry names
  // before fetchPack ever calls safeResolve. E.g. `backpressure-<sha>/../../../evil`
  // is parsed as `evil`, which then fails the stripPrefix filter and is silently
  // dropped — so path traversal cannot be exercised end-to-end through nanotar.
  // The safeResolve guard is defence-in-depth for raw tar inputs that bypass
  // nanotar normalisation (e.g. a future tar parser or a crafted Uint8Array).
  it("safeResolve guard rejects path-traversal entries that bypass nanotar normalisation", () => {
    const root = "/tmp/test-pack";
    // Guard rejects "../" traversal
    expect(() => safeResolve(root, "../../../escape.sh")).toThrow(UnsafePackEntryError);
    // Guard rejects absolute paths
    expect(() => safeResolve(root, "/etc/passwd")).toThrow(UnsafePackEntryError);
    // Guard allows legitimate relative paths
    expect(() => safeResolve(root, "subdir/file.txt")).not.toThrow();
  });

  it("@acceptance extracts files whose tarball path is ustar prefix-split (GitHub long paths > 100 chars)", async () => {
    // Regression for the nanotar-0.3.0 ustar-prefix bug: a deep path (>100 chars)
    // is split prefix/name by GitHub; the file must still survive extraction.
    const sha = "b".repeat(40);
    const wrapper = `backpressure-${sha}`;
    const tar = ustarPrefixSplitGzip([
      { dir: wrapper, base: "backpressure.json", data: '{"name":"p"}', mode: "644" },
      {
        dir: `${wrapper}/packs/backpressure-loop/scripts`,
        base: "backpressure-gate.sh",
        data: "#!/bin/sh\necho gate\n",
        mode: "755",
      },
    ]);
    const fetcher: PackFetcher = {
      resolveSha: async () => sha,
      downloadTarball: async () => tar,
    };
    const { dir } = await fetchPack(
      { owner: "o", repo: "backpressure", subdir: "packs/backpressure-loop" },
      nodeBytesIo,
      fetcher,
    );
    const script = join(dir, "scripts", "backpressure-gate.sh");
    expect(await readFile(script, "utf8")).toContain("echo gate");
    const { mode } = await stat(script);
    expect(mode & 0o111).toBeGreaterThan(0); // exec bit preserved through the split
  });

  it("nanotar normalises zip-slip entry names so fetchPack silently drops them", async () => {
    // Empirical confirmation: nanotar parses `prefix/../../../evil` as `evil`,
    // which fails the stripPrefix check — only the legitimate ok.txt is extracted.
    const sha = "c".repeat(40);
    const fetcher: PackFetcher = {
      resolveSha: async () => sha,
      downloadTarball: async () =>
        createTarGzip([
          { name: `backpressure-${sha}/../../../escape.sh`, data: "evil" },
          { name: `backpressure-${sha}/ok.txt`, data: "ok" },
        ]),
    };
    const { dir } = await fetchPack({ owner: "o", repo: "backpressure" }, nodeBytesIo, fetcher);
    // Only ok.txt is written; escape.sh is silently dropped (never reaches safeResolve).
    await expect(readFile(join(dir, "ok.txt"), "utf8")).resolves.toBe("ok");
  });
});

describe("ghError", () => {
  it("404 without a token suggests setting GITHUB_TOKEN", () => {
    const e = ghError(404, "cannot resolve o/r@main", false);
    expect(e).toBeInstanceOf(PackFetchError);
    expect(e.message).toContain("set GITHUB_TOKEN");
    expect(e.message).toContain("cannot resolve o/r@main");
  });

  it("@acceptance 404 WITH a token does not re-suggest setting GITHUB_TOKEN (points at scope)", () => {
    // The QA finding: telling a user who already set GITHUB_TOKEN to "set
    // GITHUB_TOKEN" is confusing — point at access/scope instead.
    const e = ghError(404, "cannot resolve o/r@main", true);
    expect(e.message).not.toContain("set GITHUB_TOKEN");
    expect(e.message.toLowerCase()).toContain("scope");
  });

  it("403 hint is token-aware too", () => {
    expect(ghError(403, "x", false).message).toContain("set GITHUB_TOKEN");
    expect(ghError(403, "x", true).message).not.toContain("set GITHUB_TOKEN");
  });
});
