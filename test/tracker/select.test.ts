import { describe, expect, it } from "vitest";
import type { Task } from "../../src/core/task.js";
import { selectNextTask } from "../../src/tracker/select.js";

function task(partial: Partial<Task> & Pick<Task, "id" | "status">): Task {
  return {
    title: `Task ${partial.id}`,
    acceptance: "n/a",
    scope: "n/a",
    deps: [],
    ...partial,
  };
}

describe("selectNextTask", () => {
  it("returns the first open task whose deps are all done", () => {
    const tasks: Task[] = [
      task({ id: "T1", status: "done" }),
      // T2 is open and depends only on the done T1 -> eligible.
      task({ id: "T2", status: "open", deps: ["T1"] }),
      task({ id: "T3", status: "open", deps: ["T2"] }),
    ];

    expect(selectNextTask(tasks)?.id).toBe("T2");
  });

  it("skips an open task with an unmet dependency", () => {
    const tasks: Task[] = [
      // T1 depends on T0 which is still open -> not eligible, must be skipped.
      task({ id: "T0", status: "open" }),
      task({ id: "T1", status: "open", deps: ["T0"] }),
      task({ id: "T2", status: "done" }),
      // T3's only dep (T2) is done -> this is the correct selection.
      task({ id: "T3", status: "open", deps: ["T2"] }),
    ];

    const next = selectNextTask(tasks);
    expect(next?.id).toBe("T0");
    expect(next?.id).not.toBe("T1");
  });

  it("returns undefined when no open task is eligible", () => {
    const tasks: Task[] = [
      task({ id: "T1", status: "done" }),
      task({ id: "T2", status: "blocked" }),
      task({ id: "T3", status: "open", deps: ["T2"] }), // dep is blocked, not done
    ];

    expect(selectNextTask(tasks)).toBeUndefined();
  });
});
