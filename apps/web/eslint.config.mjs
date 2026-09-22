import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const compat = new FlatCompat({
  baseDirectory: currentDirectory,
  // pnpm keeps Next's lint plugins beside its config, not in this app's node_modules.
  resolvePluginsRelativeTo: dirname(require.resolve("eslint-config-next"))
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  { ignores: [".next/**", ".next-*/**", "dist/**", "next-env.d.ts"] }
];

export default eslintConfig;
