import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { safeResolve } from "../../src/add/safejoin.js";
import { UnsafePackEntryError } from "../../src/install/errors.js";

const root = resolve("/tmp/extract-root");

describe("safeResolve", () => {
  it("resolves a normal nested entry under root", () => {
    expect(safeResolve(root, "a/b/c.txt")).toBe(join(root, "a/b/c.txt"));
  });
  it.each(["../escape", "a/../../escape", "/etc/passwd", "", "a/../.."])("rejects %j", (bad) =>
    expect(() => safeResolve(root, bad)).toThrow(UnsafePackEntryError));
});
