import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type JournalEntry, writeJournalEntry } from "../../src/loop/journal.js";

describe("writeJournalEntry", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-journal-"));
    path = join(dir, "journal.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends two entries as JSONL that read back as parsed objects", async () => {
    const first: JournalEntry = { iteration: 1, taskId: "T1", result: "done", duration: 120 };
    const second: JournalEntry = { iteration: 2, taskId: "T2", result: "blocked", duration: 50 };

    await writeJournalEntry(path, first);
    await writeJournalEntry(path, second);

    const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toEqual(first);
    expect(JSON.parse(lines[1] as string)).toEqual(second);
  });

  it("routes writes through an injected append seam", async () => {
    const captured: Array<{ path: string; data: string }> = [];
    const append = async (p: string, data: string): Promise<void> => {
      captured.push({ path: p, data });
    };
    const entry: JournalEntry = { iteration: 7, taskId: "T7", result: "failed", duration: 999 };

    await writeJournalEntry("/fake/journal.jsonl", entry, { append });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.path).toBe("/fake/journal.jsonl");
    expect(captured[0]?.data).toBe(`${JSON.stringify(entry)}\n`);
  });
});
