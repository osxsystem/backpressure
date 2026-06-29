import { describe, expect, it } from "vitest";
import { parseRef } from "../../src/add/ref.js";
import { InvalidPackRefError } from "../../src/install/errors.js";

describe("parseRef", () => {
  it("parses owner/repo", () => {
    expect(parseRef("osxsystem/backpressure")).toEqual({
      owner: "osxsystem",
      repo: "backpressure",
    });
  });
  it("parses an @ref", () => {
    expect(parseRef("osxsystem/backpressure@v1.2.0")).toEqual({
      owner: "osxsystem",
      repo: "backpressure",
      ref: "v1.2.0",
    });
  });
  it("parses a subdir before the @ref", () => {
    expect(parseRef("osxsystem/backpressure/packs/loop@main")).toEqual({
      owner: "osxsystem",
      repo: "backpressure",
      subdir: "packs/loop",
      ref: "main",
    });
  });
  it.each(["", "noslash", "owner/", "/repo", "owner/repo@", "a/b/../c"])("rejects %j", (bad) =>
    expect(() => parseRef(bad)).toThrow(InvalidPackRefError));
});
