import { describe, expect, it } from "vitest";
import type { InstallIo } from "../../src/install/init.js";
import { detectStack } from "../../src/install/stack.js";

/** Fake InstallIo over an in-memory file map. readText throws ENOENT when absent. */
function fakeIo(files: Record<string, string>): InstallIo {
  return {
    async readText(path) {
      const key = Object.keys(files).find((f) => path.endsWith(f));
      if (key === undefined) {
        const e = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      }
      return files[key] as string;
    },
    async listFiles() {
      return [];
    },
    async ensureDir() {},
    async writeText() {},
    async copyFile() {},
  };
}

describe("detectStack (@acceptance)", () => {
  it("detects a Rust crate from Cargo.toml", async () => {
    const io = fakeIo({ "Cargo.toml": "[package]\nname='x'\n" });
    expect(await detectStack("/repo", io)).toEqual({ kind: "rust" });
  });

  it("detects a Node project with jest + npm, tsconfig, and a build script", async () => {
    const io = fakeIo({
      "package.json": JSON.stringify({
        scripts: { test: "jest", build: "tsc" },
        devDependencies: { jest: "^29", "@biomejs/biome": "^2" },
      }),
      "package-lock.json": "{}",
      "tsconfig.json": "{}",
    });
    expect(await detectStack("/repo", io)).toEqual({
      kind: "node",
      pm: "npm",
      testRunner: "jest",
      hasTsconfig: true,
      hasBuildScript: true,
      linter: "biome",
    });
  });

  it("returns unknown when neither Cargo.toml nor package.json is present", async () => {
    expect(await detectStack("/repo", fakeIo({}))).toEqual({ kind: "unknown" });
  });
});
