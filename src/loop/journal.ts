import { appendFile } from "node:fs/promises";

/**
 * One iteration's record in the loop journal. Written as a single JSON line
 * (JSONL) so a run's history is an append-only, line-delimited log.
 */
export interface JournalEntry {
  /** 1-based iteration number within the run. */
  iteration: number;
  /** The id of the task attempted in this iteration. */
  taskId: string;
  /** The outcome of the iteration (e.g. "done", "blocked", "failed"). */
  result: string;
  /** Wall-clock duration of the iteration in milliseconds. */
  duration: number;
}

/**
 * The append seam {@link writeJournalEntry} depends on. Mirrors the slice of
 * `node:fs/promises` we use, but injectable so tests can capture writes (and
 * read them back) without touching disk.
 */
export type AppendFn = (path: string, data: string) => Promise<void>;

/** Default {@link AppendFn} backed by `node:fs/promises` appendFile (UTF-8). */
export const nodeAppendFn: AppendFn = async (path, data) => {
  await appendFile(path, data, "utf8");
};

/** Options for {@link writeJournalEntry}: just the injectable append seam. */
export interface WriteJournalOptions {
  /** Append implementation; defaults to {@link nodeAppendFn}. Injected in tests. */
  append?: AppendFn;
}

/**
 * Append one {@link JournalEntry} to the JSONL journal at `path` as a single
 * `JSON.stringify(entry)` line terminated by a newline. All I/O goes through
 * the injected {@link AppendFn}, so the serialization is unit-testable.
 */
export async function writeJournalEntry(
  path: string,
  entry: JournalEntry,
  options: WriteJournalOptions = {},
): Promise<void> {
  const { append = nodeAppendFn } = options;
  await append(path, `${JSON.stringify(entry)}\n`);
}
