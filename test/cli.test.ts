import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type commander from "commander";
import { describe, expect, it, vi } from "vitest";
import { buildProgram, cliErrorLine, parseTarget } from "../src/cli.js";
import { build, formatArtifacts } from "../src/install/build.js";
import { InstallError, MissingSkillSourceError } from "../src/install/errors.js";
import { formatInventory, inventory } from "../src/install/inventory.js";

describe("cliErrorLine", () => {
  it("returns a backpressure: line for a MissingSkillSourceError", () => {
    const err = new MissingSkillSourceError("building-adaptive-ui", "/x");
    expect(cliErrorLine(err)).toBe('backpressure: skill "building-adaptive-ui" not found in /x');
  });

  it("returns null for a plain Error (selective catch / rethrow)", () => {
    expect(cliErrorLine(new Error("boom"))).toBeNull();
  });
});

describe("parseTarget", () => {
  it("narrows a known target", () => {
    expect(parseTarget("claude")).toBe("claude");
    expect(parseTarget("codex")).toBe("codex");
  });

  it("@acceptance throws an InstallError for an unknown target (clean CLI line, no stack)", () => {
    expect(() => parseTarget("vim")).toThrow(InstallError);
    let line: string | null = null;
    try {
      parseTarget("vim");
    } catch (e) {
      line = cliErrorLine(e);
    }
    expect(line).toBe('backpressure: unknown target "vim". Expected one of: claude, codex.');
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

  it("@acceptance init registers --gate with no hardcoded default (auto-detected per repo)", () => {
    const initCmd = buildProgram().commands.find((c: commander.Command) => c.name() === "init");
    const gate = initCmd?.options.find(
      (o: { long?: string; defaultValue?: unknown; description?: string }) => o.long === "--gate",
    );
    expect(gate).toBeDefined();
    // No fixed default: when --gate is omitted commander leaves the value
    // undefined, and init() detects the repo's package manager → `<pm> test`.
    expect(gate?.defaultValue).toBeUndefined();
    expect((gate?.description ?? "").toLowerCase()).toContain("auto-detected");
  });

  it("@acceptance build registers --target/--out and is no longer a stub", () => {
    const buildCmd = buildProgram().commands.find((c: commander.Command) => c.name() === "build");
    const flags = buildCmd?.options.map((o: { long?: string }) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--target", "--out"]));
    expect(buildCmd?.description()).not.toContain("stub");
  });

  it("@acceptance build compiles per-target config and never 'not yet implemented'", async () => {
    // The exact output the `build` action prints (asserted directly: commander 4
    // parseAsync does not await async action handlers).
    const printed = formatArtifacts(await build("claude"));
    expect(printed).not.toContain("not yet implemented");
    expect(printed).toContain("settings.json");
  });

  it("@acceptance index registers --target/--json and is no longer a stub", () => {
    const indexCmd = buildProgram().commands.find((c: commander.Command) => c.name() === "index");
    const flags = indexCmd?.options.map((o: { long?: string }) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--target", "--json"]));
    expect(indexCmd?.description()).not.toContain("stub");
  });

  it("@acceptance index reports an inventory and never 'not yet implemented'", async () => {
    const printed = formatInventory(await inventory("claude", { baseDir: process.cwd() }));
    expect(printed).not.toContain("not yet implemented");
    expect(printed).toContain("capabilities installed");
  });

  it("registers --global on init", () => {
    const program = buildProgram();
    const initCmd = program.commands.find((c: commander.Command) => c.name() === "init");
    const flags = initCmd?.options.map((o: { long?: string }) => o.long);
    expect(flags).toContain("--global");
  });

  it("registers the skills subcommand (discoverability, not a stub)", () => {
    const program = buildProgram();
    const names = program.commands.map((c: commander.Command) => c.name());
    expect(names).toContain("skills");
    const cmd = program.commands.find((c: commander.Command) => c.name() === "skills");
    expect(cmd?.description().toLowerCase()).not.toContain("not yet implemented");
    expect(cmd?.description().toLowerCase()).not.toContain("stub");
  });

  it("@acceptance `skills list` prints the bundled skills, marking the default", async () => {
    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    try {
      await buildProgram().parseAsync(["node", "backpressure", "skills", "list"]);
    } finally {
      spy.mockRestore();
    }
    const out = chunks.join("");
    expect(out).toContain("building-adaptive-ui"); // the default bundled skill
    expect(out).toContain("* building-adaptive-ui"); // marked as default
    expect(out).toContain("--all-skills"); // points users at the opt-in flags
    expect(out).not.toContain("not yet implemented");
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

describe("add subcommand", () => {
  it("@acceptance registers add with --target/--global/--yes and is not a stub", () => {
    const add = buildProgram().commands.find((c: commander.Command) => c.name() === "add");
    expect(add).toBeDefined();
    const flags = add?.options.map((o: { long?: string }) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--target", "--global", "--yes"]));
    expect(add?.description().toLowerCase()).not.toContain("not yet implemented");
  });
});

describe("init --from", () => {
  it("registers a --from option on init", () => {
    const init = buildProgram().commands.find((c: commander.Command) => c.name() === "init");
    expect(init?.options.some((o: { long?: string }) => o.long === "--from")).toBe(true);
  });

  it("@acceptance installs a local pack into the working dir", async () => {
    // Build a minimal pack directory.
    const packDir = await mkdtemp(join(tmpdir(), "bp-pack-"));
    await mkdir(join(packDir, "commands"), { recursive: true });
    await writeFile(
      join(packDir, "backpressure.json"),
      JSON.stringify({
        name: "demo-pack",
        version: "0.1.0",
        targets: ["claude"],
        items: [{ type: "command", name: "demo", path: "commands/demo.md" }],
        scripts: [],
      }),
    );
    await writeFile(join(packDir, "commands", "demo.md"), "# Demo Command\n");

    // Build a temp working dir so we don't pollute the repo root.
    const workDir = await mkdtemp(join(tmpdir(), "bp-work-"));
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      // commander 4's parseAsync awaits async action handlers via Promise.all.
      await buildProgram().parseAsync([
        "node",
        "backpressure",
        "init",
        "--from",
        packDir,
        "--target",
        "claude",
      ]);
      expect(existsSync(join(workDir, ".claude", "commands", "demo.md"))).toBe(true);
      expect(existsSync(join(workDir, ".backpressure", "installed.json"))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe("package manifest", () => {
  it("@acceptance publishes as a scoped, public package with the pack included", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.name).toBe("@osxsystem/backpressure");
    expect(pkg.private).toBe(false);
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "skills", "packs"]));
    expect(pkg.bin.backpressure).toBe("./dist/cli.js");
  });
});

describe("clean CLI errors end-to-end (no raw stack traces)", () => {
  // Drives the REAL program through parseAsync — not parseTarget in isolation —
  // because the e2e report (2026-06-25, §3.3) found the unit was fine while the
  // wiring still printed a raw Node stack trace on a mistyped --target. These
  // pin the action-handler catch end-to-end so that regression can't return: an
  // uncaught throw here surfaces as `threw === true`, and a stack trace would
  // break the exact single-line stderr assertion.
  async function runCli(args: string[]): Promise<{ stderr: string; threw: boolean }> {
    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    let threw = false;
    try {
      await buildProgram().parseAsync(["node", "backpressure", ...args]);
    } catch {
      threw = true; // an uncaught throw IS the raw-stack-trace regression
    } finally {
      spy.mockRestore();
    }
    return { stderr: chunks.join(""), threw };
  }

  for (const sub of ["init", "build", "index", "remove"]) {
    it(`@acceptance \`${sub} --target bogus\` fails with one clean backpressure: line (no stack, exit 1)`, async () => {
      const prevExit = process.exitCode;
      try {
        const { stderr, threw } = await runCli([sub, "--target", "bogus"]);
        expect(threw).toBe(false);
        expect(stderr).toBe(
          'backpressure: unknown target "bogus". Expected one of: claude, codex.\n',
        );
        expect(stderr).not.toContain(" at "); // no V8 stack frames
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = prevExit;
      }
    });
  }
});
