import { describe, expect, it } from "vitest";
import { serializeLock } from "../../src/add/lock.js";

describe("serializeLock", () => {
  it("serializes a trailing-newline JSON lock", () => {
    const out = serializeLock({ source: "o/r", ref: "main", sha: "a".repeat(40) });
    expect(JSON.parse(out)).toEqual({ source: "o/r", ref: "main", sha: "a".repeat(40) });
    expect(out.endsWith("\n")).toBe(true);
  });
});
