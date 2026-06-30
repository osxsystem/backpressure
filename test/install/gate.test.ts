import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InstallError } from "../../src/install/errors.js";
import { emitGate, GENERATED_MARKER, writeTunedGate } from "../../src/install/gate.js";
import type { InstallIo } from "../../src/install/init.js";
import type { StackProfile } from "../../src/install/stack.js";

// repo root: this test file is at <root>/test/install/gate.test.ts
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const shapeOk = (s: string) =>
  s.startsWith("#!/usr/bin/env bash") &&
  s.includes(GENERATED_MARKER) &&
  s.includes("set -euo pipefail") &&
  s.includes('echo "== secret scan =="') &&
  s.includes('echo "gate: GREEN"');

describe("emitGate (@acceptance)", () => {
  it("emits a Rust gate using cargo, keeping the shape", () => {
    const out = emitGate({ kind: "rust" });
    expect(shapeOk(out)).toBe(true);
    expect(out).toContain("cargo fmt --check");
    expect(out).toContain("cargo clippy --all-targets -- -D warnings");
    expect(out).toContain("cargo test");
    expect(out).toContain("cargo build");
  });

  it("emits a Node gate with the detected pm + jest, dropping typecheck when no tsconfig", () => {
    const p: StackProfile = {
      kind: "node",
      pm: "npm",
      testRunner: "jest",
      hasTsconfig: false,
      hasBuildScript: true,
      linter: "biome",
    };
    const out = emitGate(p);
    expect(shapeOk(out)).toBe(true);
    expect(out).toContain("npm exec biome check .");
    expect(out).toContain("npm test");
    expect(out).toContain("npm run build");
    expect(out).not.toContain("tsc --noEmit"); // no tsconfig → no typecheck stage
  });

  it("emits the generic gate + loud TUNE-ME banner for an unknown stack (fail-closed)", () => {
    const out = emitGate({ kind: "unknown" });
    expect(shapeOk(out)).toBe(true);
    expect(out).toContain("TUNE THIS GATE TO YOUR STACK");
  });

  it("is deterministic", () => {
    expect(emitGate({ kind: "rust" })).toBe(emitGate({ kind: "rust" }));
  });
});

/** In-memory InstallIo capturing writes; readText throws ENOENT for absent paths. */
function memIo(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const made: string[] = [];
  const io: InstallIo = {
    async readText(p) {
      for (const [k, v] of files) if (p.endsWith(k)) return v;
      const e = new Error("ENOENT") as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    },
    async writeText(p, d) {
      files.set(p, d);
    },
    async ensureDir() {},
    async listFiles() {
      return [];
    },
    async copyFile() {},
    async makeExecutable(p) {
      made.push(p);
    },
  };
  return { io, files, made };
}

it("@acceptance bundled fallback gate equals emitGate(unknown) (no drift)", async () => {
  const bundled = await readFile(
    join(repoRoot, "packs/backpressure-loop/scripts/backpressure-gate.sh"),
    "utf8",
  );
  expect(bundled).toBe(emitGate({ kind: "unknown" }));
});

describe("writeTunedGate (@acceptance)", () => {
  it("detects, emits, writes a tuned gate and marks it executable; idempotent", async () => {
    const { io, files, made } = memIo({ "Cargo.toml": "[package]\n" });
    const a = await writeTunedGate("/repo", io, { force: true });
    expect(a.path.endsWith(".backpressure/scripts/backpressure-gate.sh")).toBe(true);
    expect(a.profile.kind).toBe("rust");
    expect(files.get(a.path)).toContain("cargo test");
    expect(made).toContain(a.path);
    const first = files.get(a.path);
    await writeTunedGate("/repo", io, { force: true });
    expect(files.get(a.path)).toBe(first); // byte-identical re-run
  });

  it("refuses a hand-edited (marker-less) gate unless --force", async () => {
    const gate = "/repo/.backpressure/scripts/backpressure-gate.sh";
    const { io } = memIo({
      "Cargo.toml": "[package]\n",
      [gate]: "#!/usr/bin/env bash\n# my own gate\n",
    });
    await expect(writeTunedGate("/repo", io)).rejects.toBeInstanceOf(InstallError);
    await expect(writeTunedGate("/repo", io, { force: true })).resolves.toBeDefined();
  });
});
