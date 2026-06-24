import type { Task } from "../core/task.js";

/**
 * Pick the next task to work on: the first `open` task (in list order) whose
 * dependencies are all satisfied. A dependency is satisfied when a task with
 * that id exists and has status `done`.
 *
 * Pure function — no I/O — so it is trivially testable and order-deterministic.
 *
 * @returns the selected task, or `undefined` if none is eligible.
 */
export function selectNextTask(tasks: Task[]): Task | undefined {
  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));

  return tasks.find((task) => task.status === "open" && task.deps.every((dep) => doneIds.has(dep)));
}
