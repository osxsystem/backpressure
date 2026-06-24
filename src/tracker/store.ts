import { readFile, writeFile } from "node:fs/promises";
import { type Task, TaskSchema } from "../core/task.js";

/**
 * The persistence contract for tasks. Implementations are free to back this
 * with a JSON file (v0) or a database (planned post-v0), so callers depend
 * only on this interface.
 */
export interface TaskStore {
  /** Persist a new task. Rejects if a task with the same id already exists. */
  create(task: Task): Promise<Task>;
  /** Fetch one task by id, or `undefined` if absent. */
  get(id: string): Promise<Task | undefined>;
  /** Return all tasks, in insertion order. */
  list(): Promise<Task[]>;
  /** Merge `patch` into an existing task and persist it. Rejects if absent. */
  update(id: string, patch: Partial<Omit<Task, "id">>): Promise<Task>;
}

/**
 * The slice of the filesystem the JSON store needs. Injectable so tests can
 * supply an in-memory fake instead of touching disk.
 */
export interface FileIo {
  readText(path: string): Promise<string>;
  writeText(path: string, data: string): Promise<void>;
}

/** Default {@link FileIo} backed by `node:fs/promises`. */
export const nodeFileIo: FileIo = {
  async readText(path) {
    return readFile(path, "utf8");
  },
  async writeText(path, data) {
    await writeFile(path, data, "utf8");
  },
};

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * A {@link TaskStore} that persists the whole task list as a JSON array in a
 * single file. All filesystem access goes through the injected {@link FileIo}.
 */
export class JsonFileStore implements TaskStore {
  constructor(
    private readonly path: string,
    private readonly io: FileIo = nodeFileIo,
  ) {}

  private async readAll(): Promise<Task[]> {
    let raw: string;
    try {
      raw = await this.io.readText(this.path);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const trimmed = raw.trim();
    if (trimmed === "") return [];
    const parsed: unknown = JSON.parse(trimmed);
    return TaskSchema.array().parse(parsed);
  }

  private async writeAll(tasks: Task[]): Promise<void> {
    await this.io.writeText(this.path, `${JSON.stringify(tasks, null, 2)}\n`);
  }

  async create(task: Task): Promise<Task> {
    const valid = TaskSchema.parse(task);
    const tasks = await this.readAll();
    if (tasks.some((t) => t.id === valid.id)) {
      throw new Error(`Task already exists: ${valid.id}`);
    }
    tasks.push(valid);
    await this.writeAll(tasks);
    return valid;
  }

  async get(id: string): Promise<Task | undefined> {
    const tasks = await this.readAll();
    return tasks.find((t) => t.id === id);
  }

  async list(): Promise<Task[]> {
    return this.readAll();
  }

  async update(id: string, patch: Partial<Omit<Task, "id">>): Promise<Task> {
    const tasks = await this.readAll();
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found: ${id}`);
    }
    const current = tasks[index] as Task;
    const next = TaskSchema.parse({ ...current, ...patch, id: current.id });
    tasks[index] = next;
    await this.writeAll(tasks);
    return next;
  }
}
