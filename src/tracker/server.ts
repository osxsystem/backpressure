import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStatus } from "../core/task.js";
import { selectNextTask } from "./select.js";
import type { TaskStore } from "./store.js";

/** Zod raw shapes for each tool's input. Kept here so the schema is the single
 * source of truth for both runtime validation and the MCP JSON Schema. */
export const nextInputShape = {} as const;

export const createInputShape = {
  id: z.string(),
  title: z.string(),
  status: TaskStatus.optional(),
  acceptance: z.string(),
  scope: z.string(),
  deps: z.array(z.string()).optional(),
} as const;

export const updateInputShape = {
  id: z.string(),
  title: z.string().optional(),
  status: TaskStatus.optional(),
  acceptance: z.string().optional(),
  scope: z.string().optional(),
  deps: z.array(z.string()).optional(),
} as const;

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Build the issue-tracker MCP server. Exposes three tools backed by the given
 * {@link TaskStore}:
 *
 * - `next`   — return the next eligible task (first open task whose deps are done).
 * - `create` — add a new task.
 * - `update` — patch an existing task by id.
 *
 * The store is injected so the server can be unit-tested without touching disk.
 */
export function buildTrackerServer(store: TaskStore): McpServer {
  const server = new McpServer({
    name: "backpressure-tracker",
    version: "0.0.0",
  });

  server.registerTool(
    "next",
    {
      description: "Return the next eligible task (first open task whose deps are all done).",
      inputSchema: nextInputShape,
    },
    async () => {
      const tasks = await store.list();
      const next = selectNextTask(tasks);
      return jsonContent(next ?? null);
    },
  );

  server.registerTool(
    "create",
    {
      description: "Create a new task in the tracker.",
      inputSchema: createInputShape,
    },
    async (args) => {
      const created = await store.create({
        id: args.id,
        title: args.title,
        status: args.status ?? "open",
        acceptance: args.acceptance,
        scope: args.scope,
        deps: args.deps ?? [],
      });
      return jsonContent(created);
    },
  );

  server.registerTool(
    "update",
    {
      description: "Update an existing task by id with the provided fields.",
      inputSchema: updateInputShape,
    },
    async (args) => {
      const { id, ...patch } = args;
      const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const updated = await store.update(id, cleaned);
      return jsonContent(updated);
    },
  );

  return server;
}
