import type commander from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("buildProgram", () => {
  it("registers the init, build, and index subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c: commander.Command) => c.name());
    expect(names).toEqual(expect.arrayContaining(["init", "build", "index"]));
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
  });
});
