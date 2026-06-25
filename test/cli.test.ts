import type commander from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram, cliErrorLine } from "../src/cli.js";
import { MissingSkillSourceError } from "../src/install/errors.js";

describe("cliErrorLine", () => {
  it("returns a backpressure: line for a MissingSkillSourceError", () => {
    const err = new MissingSkillSourceError("building-adaptive-ui", "/x");
    expect(cliErrorLine(err)).toBe('backpressure: skill "building-adaptive-ui" not found in /x');
  });

  it("returns null for a plain Error (selective catch / rethrow)", () => {
    expect(cliErrorLine(new Error("boom"))).toBeNull();
  });
});

describe("buildProgram", () => {
  it("registers the init, build, index, and remove subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c: commander.Command) => c.name());
    expect(names).toEqual(expect.arrayContaining(["init", "build", "index", "remove"]));
  });

  it("registers the --skill and --all-skills opt-in flags on init", () => {
    const program = buildProgram();
    const initCmd = program.commands.find((c: commander.Command) => c.name() === "init");
    const flags = initCmd?.options.map((o: { long?: string }) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--skill", "--all-skills"]));
  });

  it("registers --global on init", () => {
    const program = buildProgram();
    const initCmd = program.commands.find((c: commander.Command) => c.name() === "init");
    const flags = initCmd?.options.map((o: { long?: string }) => o.long);
    expect(flags).toContain("--global");
  });

  it("registers --skill, --all-skills, and --global on remove", () => {
    const program = buildProgram();
    const removeCmd = program.commands.find((c: commander.Command) => c.name() === "remove");
    const flags = removeCmd?.options.map((o: { long?: string }) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--skill", "--all-skills", "--global"]));
  });

  it("registers --dry-run on remove", () => {
    const program = buildProgram();
    const removeCmd = program.commands.find((c: commander.Command) => c.name() === "remove");
    const flags = removeCmd?.options.map((o: { long?: string }) => o.long);
    expect(flags).toContain("--dry-run");
  });

  it("lists the subcommands in --help output", () => {
    const program = buildProgram();
    // Prevent commander from calling process.exit when it prints help.
    program.exitOverride();

    let output = "";
    // commander 4 writes help via the program's output writer.
    program.outputHelp((text) => {
      output += text;
      return text;
    });

    expect(output).toContain("init");
    expect(output).toContain("build");
    expect(output).toContain("index");
    expect(output).toContain("remove");
  });
});
