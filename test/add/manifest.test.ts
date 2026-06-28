import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/add/manifest.js";
import { InvalidPackManifestError } from "../../src/install/errors.js";

const valid = JSON.stringify({
  name: "backpressure-loop",
  version: "1.0.0",
  targets: ["claude", "codex"],
  items: [
    { type: "skill", name: "backpressure-loop", path: "skills/backpressure-loop" },
    { type: "command", name: "backpressure-loop", path: "commands/backpressure-loop.md" },
    {
      type: "agent",
      name: "reviewer",
      description: "Reviews.",
      prompt: "Review.",
      tools: ["Read"],
    },
    { type: "hook", event: "Stop", command: "./scripts/backpressure-gate.sh" },
  ],
  scripts: ["scripts/backpressure-gate.sh"],
});

describe("parseManifest", () => {
  it("parses a valid manifest and defaults scripts to []", () => {
    const m = parseManifest(valid);
    expect(m.name).toBe("backpressure-loop");
    expect(m.items).toHaveLength(4);
    expect(
      parseManifest(JSON.stringify({ name: "p", version: "1", targets: ["claude"], items: [] }))
        .scripts,
    ).toEqual([]);
  });

  it("rejects non-JSON", () => {
    expect(() => parseManifest("{not json")).toThrow(InvalidPackManifestError);
  });

  it("rejects an unknown item type", () => {
    const bad = JSON.stringify({
      name: "p",
      version: "1",
      targets: ["claude"],
      items: [{ type: "widget" }],
    });
    expect(() => parseManifest(bad)).toThrow(InvalidPackManifestError);
  });

  it("rejects an unsupported target", () => {
    const bad = JSON.stringify({ name: "p", version: "1", targets: ["vim"], items: [] });
    expect(() => parseManifest(bad)).toThrow(InvalidPackManifestError);
  });
});
