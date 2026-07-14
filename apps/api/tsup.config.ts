import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  format: ["esm"],
  noExternal: ["@callassist/contracts"],
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  target: "node22"
});
