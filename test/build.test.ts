import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The repo root, two levels up from this file (test/ -> repo root).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("pnpm run build", () => {
  it("produces an executable dist/cli.js", () => {
    execSync("pnpm run build", { cwd: repoRoot, stdio: "pipe" });

    const cliPath = join(repoRoot, "dist", "cli.js");
    const stats = statSync(cliPath);
    expect(stats.isFile()).toBe(true);
    // The shebang entry is marked executable (owner-exec bit set).
    expect(stats.mode & 0o100).not.toBe(0);
  }, 60_000);
});
