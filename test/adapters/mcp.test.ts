import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { emitClaudeMcp } from "../../src/adapters/claude/mcp.js";
import { emitCodexMcp } from "../../src/adapters/codex/mcp.js";
import type { McpServerDefinition } from "../../src/adapters/common/mcp.js";

const tracker: McpServerDefinition = {
  name: "tracker",
  command: "node",
  args: ["dist/tracker/server.js"],
  env: { TRACKER_FILE: "tasks.json" },
};

describe("MCP emitters (one shared definition -> two targets)", () => {
  it("emitClaudeMcp produces a .mcp.json mcpServers object", () => {
    expect(emitClaudeMcp([tracker])).toEqual({
      mcpServers: {
        tracker: {
          command: "node",
          args: ["dist/tracker/server.js"],
          env: { TRACKER_FILE: "tasks.json" },
        },
      },
    });
  });

  it("emitCodexMcp stringifies an [mcp_servers.<name>] table that round-trips", () => {
    const toml = emitCodexMcp([tracker]);
    expect(typeof toml).toBe("string");

    const parsed = parse(toml) as unknown as {
      mcp_servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(parsed.mcp_servers.tracker).toEqual({
      command: "node",
      args: ["dist/tracker/server.js"],
      env: { TRACKER_FILE: "tasks.json" },
    });
  });

  it("both outputs derive from the same server definition", () => {
    const claude = emitClaudeMcp([tracker]);
    const codex = parse(emitCodexMcp([tracker])) as unknown as {
      mcp_servers: Record<string, { command: string; args: string[] }>;
    };

    expect(claude.mcpServers.tracker?.command).toBe(tracker.command);
    expect(claude.mcpServers.tracker?.args).toEqual(tracker.args);
    expect(codex.mcp_servers.tracker?.command).toBe(tracker.command);
    expect(codex.mcp_servers.tracker?.args).toEqual(tracker.args);
  });

  it("omits env when the definition has none", () => {
    const noEnv: McpServerDefinition = { name: "echo", command: "echo", args: ["hi"] };

    expect(emitClaudeMcp([noEnv]).mcpServers.echo).not.toHaveProperty("env");

    const codex = parse(emitCodexMcp([noEnv])) as unknown as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(codex.mcp_servers.echo).not.toHaveProperty("env");
  });
});
