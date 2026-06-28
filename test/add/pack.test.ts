import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/add/manifest.js";
import { planPack } from "../../src/add/pack.js";

const pack = "/pack";
const base = "/repo";
const manifest = parseManifest(
  JSON.stringify({
    name: "p",
    version: "1.0.0",
    targets: ["claude", "codex"],
    items: [
      { type: "skill", name: "loop", path: "skills/loop" },
      { type: "command", name: "loop", path: "commands/loop.md" },
      { type: "hook", event: "Stop", command: "./scripts/gate.sh" },
    ],
    scripts: ["scripts/gate.sh"],
  }),
);

describe("planPack", () => {
  it("plans Claude: skill copyTree, command copyFile, hook→settings.json, script→.backpressure", () => {
    const { ops } = planPack(pack, manifest, "claude", base);
    expect(ops).toContainEqual({
      op: "copyTree",
      from: join(pack, "skills/loop"),
      to: join(base, ".claude/skills/loop"),
    });
    expect(ops).toContainEqual({
      op: "copyFile",
      from: join(pack, "commands/loop.md"),
      to: join(base, ".claude/commands/loop.md"),
    });
    expect(ops).toContainEqual({
      op: "copyFile",
      from: join(pack, "scripts/gate.sh"),
      to: join(base, ".backpressure/scripts/gate.sh"),
    });
    const settings = ops.find(
      (o) => o.op === "writeText" && o.path === join(base, ".claude/settings.json"),
    );
    expect(settings && settings.op === "writeText" && settings.contents).toContain(
      ".backpressure/scripts/gate.sh",
    );
  });

  it("skips commands on Codex and emits one config.toml", () => {
    const { ops, notices } = planPack(pack, manifest, "codex", base);
    expect(ops.some((o) => (o.op !== "writeText" ? false : o.path.endsWith("config.toml")))).toBe(
      true,
    );
    expect(ops.some((o) => "to" in o && o.to.includes("commands"))).toBe(false);
    expect(notices.join(" ")).toContain("command");
  });

  it("for 'other' materialises skills under .backpressure and skips compiled items", () => {
    const { ops, notices } = planPack(pack, manifest, "other", base);
    expect(ops).toContainEqual({
      op: "copyTree",
      from: join(pack, "skills/loop"),
      to: join(base, ".backpressure/skills/loop"),
    });
    expect(ops.some((o) => o.op === "writeText")).toBe(false);
    expect(notices.length).toBeGreaterThan(0);
  });
});
