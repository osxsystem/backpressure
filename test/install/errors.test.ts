import { describe, expect, it } from "vitest";
import {
  InstallError,
  isEnoent,
  MissingSkillSourceError,
  SkillVerificationError,
  UnknownSkillError,
} from "../../src/install/errors.js";

describe("MissingSkillSourceError", () => {
  it("renders the message exactly", () => {
    const err = new MissingSkillSourceError("building-adaptive-ui", "/some/dir");
    expect(err.message).toBe('skill "building-adaptive-ui" not found in /some/dir');
  });

  it("sets skillName and sourceDir fields", () => {
    const err = new MissingSkillSourceError("building-adaptive-ui", "/some/dir");
    expect(err.skillName).toBe("building-adaptive-ui");
    expect(err.sourceDir).toBe("/some/dir");
  });

  it("is instanceof MissingSkillSourceError, InstallError, and Error", () => {
    const err = new MissingSkillSourceError("building-adaptive-ui", "/some/dir");
    expect(err).toBeInstanceOf(MissingSkillSourceError);
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const err = new MissingSkillSourceError("building-adaptive-ui", "/some/dir");
    expect(err.name).toBe("MissingSkillSourceError");
  });
});

describe("UnknownSkillError", () => {
  it("renders a message listing the available skills", () => {
    const err = new UnknownSkillError("skil-creator", ["building-adaptive-ui", "skill-creator"]);
    expect(err.message).toBe(
      'skill "skil-creator" is not bundled. Available: building-adaptive-ui, skill-creator',
    );
  });

  it("renders (none) when nothing is available", () => {
    const err = new UnknownSkillError("anything", []);
    expect(err.message).toBe('skill "anything" is not bundled. Available: (none)');
  });

  it("is an InstallError carrying the name and available list", () => {
    const err = new UnknownSkillError("x", ["a", "b"]);
    expect(err).toBeInstanceOf(InstallError);
    expect(err.name).toBe("UnknownSkillError");
    expect(err.skillName).toBe("x");
    expect(err.available).toEqual(["a", "b"]);
  });
});

describe("SkillVerificationError", () => {
  it("is an InstallError", () => {
    const err = new SkillVerificationError([{ skill: "x", message: "broken" }]);
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const err = new SkillVerificationError([]);
    expect(err.name).toBe("SkillVerificationError");
  });

  it("exposes problems on the readonly field", () => {
    const problems = [
      { skill: "a", message: "SKILL.md not found" },
      { skill: "b", message: "invalid frontmatter: Required" },
    ];
    const err = new SkillVerificationError(problems);
    expect(err.problems).toEqual(problems);
  });

  it("renders a human-readable message listing every problem", () => {
    const err = new SkillVerificationError([
      { skill: "bad-one", message: "SKILL.md not found" },
      { skill: "bad-two", message: "invalid frontmatter: Required" },
    ]);
    expect(err.message).toContain("skill verification failed");
    expect(err.message).toContain("bad-one");
    expect(err.message).toContain("SKILL.md not found");
    expect(err.message).toContain("bad-two");
    expect(err.message).toContain("invalid frontmatter");
  });

  it("renders correctly with an empty problems list", () => {
    const err = new SkillVerificationError([]);
    expect(err.message).toContain("skill verification failed");
    expect(err.problems).toHaveLength(0);
  });
});

describe("InstallError", () => {
  it("has the correct name", () => {
    const err = new InstallError("something went wrong");
    expect(err.name).toBe("InstallError");
  });
});

describe("isEnoent", () => {
  it("returns true for a plain object with code ENOENT", () => {
    expect(isEnoent({ code: "ENOENT" })).toBe(true);
  });

  it("returns true for a real Error with .code = ENOENT", () => {
    const e = new Error("no such file") as NodeJS.ErrnoException;
    e.code = "ENOENT";
    expect(isEnoent(e)).toBe(true);
  });

  it("returns false for a plain Error without a code", () => {
    expect(isEnoent(new Error("boom"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isEnoent(null)).toBe(false);
  });

  it("returns false for a non-ENOENT code", () => {
    const e = new Error("permission denied") as NodeJS.ErrnoException;
    e.code = "EACCES";
    expect(isEnoent(e)).toBe(false);
  });
});
