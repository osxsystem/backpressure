import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../../src/core/task.js";
import { JsonFileStore } from "../../src/tracker/store.js";

describe("JsonFileStore", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-store-"));
    storePath = join(dir, "tasks.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips create -> get -> update -> list against a temp file", async () => {
    const store = new JsonFileStore(storePath);

    const task: Task = {
      id: "T4",
      title: "Task store",
      status: "open",
      acceptance: "round-trip test",
      scope: "src/tracker/store.ts",
      deps: ["T3"],
    };

    // create
    const created = await store.create(task);
    expect(created).toEqual(task);

    // get
    const fetched = await store.get("T4");
    expect(fetched).toEqual(task);

    // update
    const updated = await store.update("T4", { status: "done" });
    expect(updated.status).toBe("done");
    expect(updated.id).toBe("T4");

    // list reflects the update (and persisted to a fresh store instance)
    const reloaded = new JsonFileStore(storePath);
    const all = await reloaded.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe("done");
  });

  it("returns undefined for a missing task and an empty list before any writes", async () => {
    const store = new JsonFileStore(storePath);
    expect(await store.get("nope")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });
});
