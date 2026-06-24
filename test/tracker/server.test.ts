import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Task } from "../../src/core/task.js";
import { buildTrackerServer } from "../../src/tracker/server.js";
import type { TaskStore } from "../../src/tracker/store.js";

/** Minimal in-memory store so the server test never touches disk. */
function fakeStore(initial: Task[] = []): TaskStore {
  const tasks = [...initial];
  return {
    async create(task) {
      tasks.push(task);
      return task;
    },
    async get(id) {
      return tasks.find((t) => t.id === id);
    },
    async list() {
      return [...tasks];
    },
    async update(id, patch) {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`not found: ${id}`);
      const next = { ...(tasks[idx] as Task), ...patch, id } as Task;
      tasks[idx] = next;
      return next;
    },
  };
}

async function connectedClient(store: TaskStore) {
  const server = buildTrackerServer(store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("buildTrackerServer", () => {
  it("registers next, create and update tools with input schemas", async () => {
    const client = await connectedClient(fakeStore());

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    for (const name of ["next", "create", "update"]) {
      const tool = byName.get(name);
      expect(tool, `tool "${name}" should be registered`).toBeDefined();
      // Each tool exposes a JSON Schema derived from its zod input shape.
      expect(tool?.inputSchema).toBeDefined();
      expect(tool?.inputSchema.type).toBe("object");
    }

    // create/update require an `id`; next takes no input.
    expect(byName.get("create")?.inputSchema.properties).toHaveProperty("id");
    expect(byName.get("update")?.inputSchema.properties).toHaveProperty("id");

    await client.close();
  });

  it("wires tools to the store: create then next returns the new task", async () => {
    const client = await connectedClient(fakeStore());

    await client.callTool({
      name: "create",
      arguments: {
        id: "T6",
        title: "MCP server",
        acceptance: "tools registered",
        scope: "src/tracker/server.ts",
      },
    });

    const result = await client.callTool({ name: "next", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? "null";
    const next = JSON.parse(text) as Task | null;

    expect(next?.id).toBe("T6");
    expect(next?.status).toBe("open");

    await client.close();
  });
});
