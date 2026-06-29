import { InvalidPackRefError } from "../install/errors.js";

/** A parsed `owner/repo[/subdir][@ref]` GitHub pack reference. */
export interface PackRef {
  owner: string;
  repo: string;
  /** Path within the repo to the pack root (where backpressure.json lives). */
  subdir?: string;
  /** Branch, tag, or SHA; undefined → the repo's default branch. */
  ref?: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Parse `owner/repo[/subdir][@ref]`. Throws {@link InvalidPackRefError}. */
export function parseRef(arg: string): PackRef {
  const at = arg.indexOf("@");
  const ref = at === -1 ? undefined : arg.slice(at + 1);
  const path = at === -1 ? arg : arg.slice(0, at);
  if (at !== -1 && !ref) throw new InvalidPackRefError(arg);

  const parts = path.split("/");
  if (parts.length < 2) throw new InvalidPackRefError(arg);

  const owner = parts[0] as string;
  const repo = parts[1] as string;
  const rest = parts.slice(2);
  const subdir = rest.length ? rest.join("/") : undefined;

  const all = [owner, repo, ...rest, ...(ref ? [ref] : [])];
  if (all.some((s) => !s || !SEGMENT.test(s) || s === "." || s === ".."))
    throw new InvalidPackRefError(arg);

  return { owner, repo, ...(subdir ? { subdir } : {}), ...(ref ? { ref } : {}) };
}
