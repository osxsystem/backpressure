import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../../src/install/init.js";
import {
  type CapabilityEntry,
  type ExistsIo,
  formatInventory,
  inventory,
} from "../../src/install/inventory.js";
import { planInstall } from "../../src/install/plan.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsSourceDir = join(repoRoot, "skills");

describe("inventory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-inv-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("@acceptance inventory lists every planned capability as absent on a clean repo", async () => {
    const entries = await inventory("claude", { baseDir: dir });
    expect(entries).toHaveLength(planInstall("claude", dir).length);
    expect(entries.every((e) => !e.present)).toBe(true);
  });

  it("@acceptance inventory marks hooks+reviewer+skill present after init('claude') and omits .mcp.json", async () => {
    await init("claude", dir, { skillsSourceDir });
    const entries = await inventory("claude", { baseDir: dir });
    const byKind = (k: CapabilityEntry["kind"]) => entries.filter((e) => e.kind === k);
    expect(byKind("hooks").every((e) => e.present)).toBe(true);
    expect(byKind("agent").every((e) => e.present)).toBe(true);
    expect(byKind("skill").every((e) => e.present)).toBe(true);
    expect(entries.some((e) => e.path.endsWith(".mcp.json"))).toBe(false);
  });

  it("@acceptance inventory is read-only (fresh baseDir stays empty; only existence checks run)", async () => {
    const seen: string[] = [];
    const spy: ExistsIo = {
      async exists(p) {
        seen.push(p);
        return false;
      },
    };
    const entries = await inventory("claude", { baseDir: dir, io: spy });
    expect(entries.length).toBeGreaterThan(0);
    expect(seen.length).toBe(entries.length); // one existence check per planned file
    expect(await readdir(dir)).toEqual([]); // nothing created
  });

  it("@acceptance inventory('codex') lists config.toml + skills via planInstall with no per-target branch", async () => {
    const entries = await inventory("codex", { baseDir: dir });
    expect(entries.some((e) => e.path.endsWith(join(".codex", "config.toml")))).toBe(true);
    expect(entries.some((e) => e.path.includes(".claude"))).toBe(false);

    const src = await readFile(join(repoRoot, "src", "install", "inventory.ts"), "utf8");
    expect(src).not.toMatch(/target\s*===|if\s*\(\s*target\b/);
  });

  it("@acceptance inventory reports mixed install state (hooks present, agent+skill absent)", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.json"), "{}"); // only the hooks file
    const entries = await inventory("claude", { baseDir: dir });
    expect(entries.find((e) => e.kind === "hooks")?.present).toBe(true);
    expect(entries.filter((e) => e.kind === "agent").every((e) => !e.present)).toBe(true);
    expect(entries.filter((e) => e.kind === "skill").every((e) => !e.present)).toBe(true);
  });

  it("@acceptance formatInventory renders [x]/[ ] markers, the path, and an N/M summary", () => {
    const out = formatInventory([
      { kind: "hooks", path: "/r/.claude/settings.json", present: true },
      { kind: "skill", path: "/r/.claude/skills/x/SKILL.md", present: false },
    ]);
    expect(out).toContain("[x] hooks");
    expect(out).toContain("[ ] skill");
    expect(out).toContain("/r/.claude/settings.json"); // each entry's path is rendered
    expect(out).toContain("/r/.claude/skills/x/SKILL.md");
    expect(out).toContain("1/2 capabilities installed");
  });

  it("@acceptance inventory entries are the JSON shape the --json branch emits ({kind,path,present}[])", async () => {
    await init("claude", dir, { skillsSourceDir });
    const entries = await inventory("claude", { baseDir: dir });
    // The CLI's `--json` branch prints JSON.stringify(entries); assert it round-trips
    // to exactly the {kind, path, present} shape.
    const roundTripped = JSON.parse(JSON.stringify(entries)) as CapabilityEntry[];
    expect(roundTripped).toEqual(entries);
    for (const e of roundTripped) {
      expect(Object.keys(e).sort()).toEqual(["kind", "path", "present"]);
    }
  });
});
