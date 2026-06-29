import { isAbsolute, resolve, sep } from "node:path";
import { UnsafePackEntryError } from "../install/errors.js";

/**
 * Resolve `entry` (a tar member name) under `root`, guaranteeing the result stays
 * inside `root`. Rejects empty names, absolute paths, and any `..` traversal.
 * Returns the absolute on-disk path. Pure (no I/O).
 */
export function safeResolve(root: string, entry: string): string {
  if (!entry || isAbsolute(entry)) throw new UnsafePackEntryError(entry);
  const abs = resolve(root, entry);
  const prefix = resolve(root) + sep;
  if (abs !== resolve(root) && !abs.startsWith(prefix)) {
    throw new UnsafePackEntryError(entry);
  }
  return abs;
}
