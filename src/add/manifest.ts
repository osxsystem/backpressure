import { z } from "zod";
import { InvalidPackManifestError } from "../install/errors.js";

const SkillItem = z.object({ type: z.literal("skill"), name: z.string(), path: z.string() });
const CommandItem = z.object({ type: z.literal("command"), name: z.string(), path: z.string() });
const AgentItem = z.object({
  type: z.literal("agent"),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
});
const HookItem = z.object({
  type: z.literal("hook"),
  event: z.string(),
  command: z.string(),
  matcher: z.string().optional(),
});
const McpItem = z.object({
  type: z.literal("mcp"),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
});

/** One declared capability in a pack. Discriminated on `type`. */
export const PackItemSchema = z.discriminatedUnion("type", [
  SkillItem,
  CommandItem,
  AgentItem,
  HookItem,
  McpItem,
]);
export type PackItem = z.infer<typeof PackItemSchema>;

/** The validated `backpressure.json` contract. */
export const PackManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  targets: z.array(z.enum(["claude", "codex"])).nonempty(),
  items: z.array(PackItemSchema),
  scripts: z.array(z.string()).default([]),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

/** Parse + validate a `backpressure.json` body. Throws InvalidPackManifestError. */
export function parseManifest(text: string): PackManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidPackManifestError("not valid JSON");
  }
  const result = PackManifestSchema.safeParse(json);
  if (!result.success) {
    throw new InvalidPackManifestError(result.error.message);
  }
  return result.data;
}
