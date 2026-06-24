import { z } from "zod";

/**
 * The status of a task in the issue tracker.
 *
 * - `open`    — not yet done; eligible for selection once its deps are done.
 * - `done`    — completed; satisfies dependencies of other tasks.
 * - `blocked` — cannot proceed (e.g. a hard failure was recorded).
 */
export const TaskStatus = z.enum(["open", "done", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * A single unit of work in the build queue. One schema drives both runtime
 * validation and (via zod) JSON Schema generation for the MCP tools.
 */
export const TaskSchema = z.object({
  /** Stable identifier, e.g. "T3". */
  id: z.string(),
  /** Human-readable summary of the work. */
  title: z.string(),
  /** Lifecycle state of the task. */
  status: TaskStatus,
  /** The machine-checkable acceptance criterion (a test that must pass). */
  acceptance: z.string(),
  /** What the task is allowed to touch; keeps changes focused. */
  scope: z.string(),
  /** IDs of tasks that must be `done` before this one is eligible. */
  deps: z.array(z.string()),
});

export type Task = z.infer<typeof TaskSchema>;
