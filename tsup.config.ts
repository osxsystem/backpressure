import { defineConfig } from "tsup";

// Bundle config. The entry list grows as modules land (CLI bin arrives in T18/T21).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
});
