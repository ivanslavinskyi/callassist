import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve("eslint-config-next"));
const pluginRequire = createRequire(configRequire.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js") as {
  getRootDirs(context: { cwd: string; settings: { next?: { rootDir?: string | string[] } } }): string[];
};
const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const web = `${repository}/apps/web`;
const api = `${repository}/apps/api`;
const roots = (rootDir?: string | string[]) => getRootDirs({ cwd: web, settings: { next: { rootDir } } })
  .map(path => path.replace(/\\/g, "/")).sort();

describe("Next ESLint glob dependency replacement", () => {
  it("loads glob through the scoped fast-glob alias", () => {
    expect(pluginRequire("fast-glob/package.json")).toMatchObject({ name: "glob", version: "13.0.6" });
  });

  it("keeps the default and explicit directory as one root, without descendants", () => {
    expect(roots()).toEqual([web]);
    expect(roots(web)).toEqual([web]);
    expect(roots(`${web}/`)).toEqual([web]);
  });

  it("supports wildcards, brace alternatives and arrays of roots", () => {
    expect(roots(`${repository}/apps/w*b`)).toEqual([web]);
    expect(roots(`${repository}/apps/{api,web}`)).toEqual([api, web]);
    expect(roots([web, api])).toEqual([api, web]);
  });

  it("normalizes Windows separators and preserves relative directory matching", () => {
    expect(roots(web.replace(/\//g, "\\"))).toEqual([web]);
    expect(roots("../web").map(path => resolve(path).replace(/\\/g, "/"))).toEqual([web]);
  });

  it("does not return files or nonexistent directories", () => {
    expect(roots(`${web}/package.json`)).toEqual([]);
    expect(roots(`${web}/no-such-next-root`)).toEqual([]);
  });

  it("recognizes a directory reached through a package symlink or junction", () => {
    expect(roots(`${web}/node_modules/next`)).toEqual([`${web}/node_modules/next`]);
  });
});
