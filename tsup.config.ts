import { defineConfig } from "tsup";

// Bundle config. The CLI bin (src/cli.ts) ships alongside the library entry; its
// `#!/usr/bin/env node` shebang is preserved and dist/cli.js is marked executable.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
});
