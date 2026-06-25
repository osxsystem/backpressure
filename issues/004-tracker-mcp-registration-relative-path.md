# 004 — Default tracker MCP registration uses a relative path → dead in every consumer repo

- **Severity:** High (the headline feature ships non-functional by default)
- **Area:** `src/install/init.ts` (`DEFAULT_MCP_SERVERS`), `src/adapters/*/*Mcp`
- **Found by:** inspecting the emitted `.mcp.json` / `.codex/config.toml` from a consumer repo

## Problem
`init` registers the tracker server as:

```json
"tracker": { "command": "node", "args": ["dist/tracker/server.js"] }
```

Two layered defects:
1. **Not built.** `dist/tracker/server.js` is never produced by tsup, and
   `buildTrackerServer` has no stdio bootstrap (already noted in USER_GUIDE
   "Known limitations").
2. **Relative path → wrong repo (sharper than the docs admit).** Even once the
   server is built, the arg is relative. When the host CLI launches it from the
   *consumer's* repo, cwd is the consumer repo, so `node dist/tracker/server.js`
   resolves to `<consumer>/dist/tracker/server.js`, which never exists. The default
   registration therefore points into the wrong repo for every consumer.

## Repro
```bash
cd /tmp/my-app
node /path/to/backpressure/dist/cli.js init --target claude
cat .mcp.json          # args: ["dist/tracker/server.js"] — relative to my-app, not backpressure
ls /path/to/backpressure/dist/tracker/server.js   # also: does not exist
```

## Acceptance criterion
Either:
- **(a)** the tracker is not registered by default until it is runnable; a test
  asserts `DEFAULT_MCP_SERVERS` contains no entry pointing at a non-existent build
  artifact; **or**
- **(b)** the emitted `args` use an absolute/resolved path to the installed
  server, and a test asserts the emitted path is absolute (or resolved from the
  package location), not a bare `dist/...` relative string.

## Notes / fix direction
Pairs with the planned "add a stdio entry + tsup entry" tracker work — but that
work alone does **not** fix defect #2; the path resolution must change too.
