import { describe, expect, it } from "vitest";
import { emitGate, GENERATED_MARKER } from "../../src/install/gate.js";
import type { StackProfile } from "../../src/install/stack.js";

const shapeOk = (s: string) =>
  s.startsWith("#!/usr/bin/env bash") &&
  s.includes(GENERATED_MARKER) &&
  s.includes("set -euo pipefail") &&
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
