import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: {
    index: "src/index.ts",
    "db/migrate": "src/db/migrate.ts",
    "db/set-outbound-calls": "src/db/set-outbound-calls.ts"
  },
  format: ["esm"],
  noExternal: ["@callassist/contracts"],
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  target: "node22"
});
