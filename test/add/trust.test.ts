import { describe, expect, it } from "vitest";
import { confirmInstall, summarizeTrust } from "../../src/add/trust.js";
import { InstallError } from "../../src/install/errors.js";

const manifest = {
  name: "loop",
  version: "1",
  targets: ["claude"],
  items: [{ type: "hook", event: "Stop", command: "./scripts/gate.sh" }],
  scripts: ["scripts/gate.sh"],
} as never;

describe("trust", () => {
  it("summary names the source@sha and every hook command + script", () => {
    const s = summarizeTrust(manifest, "o/r", "a".repeat(40));
    expect(s).toContain(`o/r@${"a".repeat(40)}`);
    expect(s).toContain("./scripts/gate.sh"); // hook command
    expect(s).toContain("scripts/gate.sh"); // executable script
  });
  it("--yes skips the prompt", async () => {
    await expect(
      confirmInstall(manifest, "o/r", "x", { confirm: async () => false }, { yes: true }),
    ).resolves.toBeUndefined();
  });
  it("throws when the prompt is declined", async () => {
    await expect(
      confirmInstall(manifest, "o/r", "x", { confirm: async () => false }, {}),
    ).rejects.toThrow(InstallError);
  });
});
