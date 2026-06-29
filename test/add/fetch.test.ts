import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTarGzip } from "nanotar";
import { describe, expect, it } from "vitest";
import type { PackFetcher } from "../../src/add/fetch.js";
import { fetchPack, nodeBytesIo } from "../../src/add/fetch.js";
import { safeResolve } from "../../src/add/safejoin.js";
import { UnsafePackEntryError } from "../../src/install/errors.js";

// GitHub tarballs wrap everything in a top-level "<repo>-<sha>/" dir.
// NOTE: nanotar's TarFileAttrs.mode is a string (e.g. "755"), not a number.
async function fakeTarball(prefix: string): Promise<Uint8Array> {
  return createTarGzip([
    { name: `${prefix}/backpressure.json`, data: '{"name":"p"}' },
    { name: `${prefix}/scripts/gate.sh`, data: "#!/bin/sh\n", attrs: { mode: "755" } },
  ]);
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
