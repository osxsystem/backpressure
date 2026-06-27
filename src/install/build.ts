import { dirname } from "node:path";
import type { AgentTarget } from "../seam/targets.js";
import {
  bundledSkillsDir,
  compileArtifacts,
  DEFAULT_HOOKS,
  type InstallIo,
  nodeInstallIo,
  type WriteOp,
} from "./init.js";
import { DEFAULT_CAPABILITIES, type InstallCapabilities, planInstall } from "./plan.js";

/** Options for {@link build}. */
export interface BuildOptions {
  /** Capabilities to compile; defaults to {@link DEFAULT_CAPABILITIES}. */
  capabilities?: InstallCapabilities;
  /** Bundled skills source dir; defaults to the pack's {@link bundledSkillsDir}. */
  skillsSourceDir?: string;
  /** Filesystem wrapper; defaults to {@link nodeInstallIo}. Injected in tests. */
  io?: InstallIo;
  /**
   * When set, STAGE the compiled config artifacts under this dir (a scratch dir,
   * never a live target repo). When unset, `build` is read-only: it returns the
   * ops and writes nothing.
   */
  out?: string;
}

/**
 * Compile the per-target config artifacts from the single source of truth — the
 * read-only "compile per target" command behind `backpressure build`.
 *
 * Routes through the SAME {@link compileArtifacts} + {@link planInstall} as
 * `init`, so the bytes are byte-identical to what `init` would write **for the
 * default gate** (build previews the default install; an `init --gate X` is not
 * reflected) and there is no second per-target branch here. Unlike `init` it
 * does NOT install into a live repo: with no `out` it returns the
 * {@link WriteOp}s and touches nothing; with `out` it stages only the config
 * (`op: "write"`) artifacts under that dir. An empty/whitespace `out` is treated
 * as unset (read-only preview), so an unset env var cannot enable cwd writes.
 *
 * Distinct from `pnpm run build` (tsup): this never runs tsup and writes no
 * `dist/`. See `specs/build-command.md`.
 */
export async function build(target: AgentTarget, opts: BuildOptions = {}): Promise<WriteOp[]> {
  const {
    capabilities = DEFAULT_CAPABILITIES,
    skillsSourceDir = bundledSkillsDir(),
    io = nodeInstallIo,
    out,
  } = opts;

  // Treat an empty/whitespace `out` as unset so it can never enable writes into
  // cwd (the read-only default is what stops `build` from clobbering a live
  // install). base "" -> relative artifact paths; `stage` stages under it.
  const stage = out !== undefined && out.trim() !== "" ? out : undefined;
  const base = stage ?? "";
  const plan = planInstall(target, base, capabilities);
  const ops = await compileArtifacts(
    target,
    plan,
    capabilities,
    DEFAULT_HOOKS,
    skillsSourceDir,
    io,
  );

  if (stage !== undefined) {
    for (const op of ops) {
      if (op.op === "write") {
        await io.ensureDir(dirname(op.path));
        await io.writeText(op.path, op.contents);
      }
    }
  }

  return ops;
}

/**
 * Render compiled {@link WriteOp}s for stdout: each config (`op: "write"`) gets a
 * `// <relpath>` header followed by its raw contents; each portable skill file
 * (`op: "copy"`) is a `// copy <relpath>` reference line only (skills are copied
 * verbatim by `init`, not "compiled per target", so their bytes aren't dumped).
 */
export function formatArtifacts(ops: WriteOp[]): string {
  return ops
    .map((op) => (op.op === "write" ? `// ${op.path}\n${op.contents}` : `// copy ${op.path}\n`))
    .join("\n");
}
