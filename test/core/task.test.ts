import { describe, expect, it } from "vitest";
import { TaskSchema } from "../../src/core/task.js";

describe("TaskSchema", () => {
  it("validates a well-formed task", () => {
    const task = {
      id: "T3",
      title: "Define the Task schema with zod",
      status: "open",
      acceptance: "a test validates a well-formed task",
      scope: "src/core/task.ts",
      deps: ["T1", "T2"],
    };

    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(task);
    }
  });

  it("rejects a task with a bad status", () => {
    const bad = {
      id: "T3",
      title: "Define the Task schema with zod",
      status: "in-progress", // not in [open|done|blocked]
      acceptance: "a test validates a well-formed task",
      scope: "src/core/task.ts",
      deps: [],
    };

    const result = TaskSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
