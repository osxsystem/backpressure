import { describe, expect, it } from "vitest";
import type { InstalledManifest } from "../../src/add/installed.js";
import { serializeInstalled } from "../../src/add/installed.js";

describe("serializeInstalled", () => {
  it("returns pretty JSON ending in a trailing newline", () => {
    const m: InstalledManifest = {
      name: "loop",
      version: "1.0.0",
      choice: "claude",
      files: [".claude/commands/loop.md"],
      hooks: [{ event: "Stop", command: ".backpressure/scripts/gate.sh" }],
    };
    const out = serializeInstalled(m);
    expect(out.endsWith("\n")).toBe(true);
    // Pretty-printed JSON has indentation
    expect(out).toContain("  ");
  });

  it("round-trips name/version/choice/files/hooks through JSON.parse", () => {
    const m: InstalledManifest = {
      name: "my-pack",
      version: "2.3.4",
      choice: "codex",
      files: ["a/b.md", "c/d.toml"],
      hooks: [
        { event: "Start", command: "echo hi" },
        { event: "Stop", command: "run.sh", matcher: "*.ts" },
      ],
    };
    const parsed = JSON.parse(serializeInstalled(m)) as InstalledManifest;
    expect(parsed.name).toBe(m.name);
    expect(parsed.version).toBe(m.version);
    expect(parsed.choice).toBe(m.choice);
    expect(parsed.files).toEqual(m.files);
    expect(parsed.hooks).toEqual(m.hooks);
  });
});
