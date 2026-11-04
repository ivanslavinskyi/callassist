// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Ivan Slavinskyi. All rights reserved.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve the same pnpm dependency instances as the application's lint config.
const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const configRequire = createRequire(webRequire.resolve('eslint-config-next'));
const eslintRequire = createRequire(webRequire.resolve('eslint'));
const { Linter } = webRequire('eslint');
const plugins = {
  import: configRequire('eslint-plugin-import'),
  react: configRequire('eslint-plugin-react'),
  'jsx-a11y': configRequire('eslint-plugin-jsx-a11y'),
};
const reactRequire = createRequire(configRequire.resolve('eslint-plugin-react'));

function lint(code, rule, options) {
  return new Linter({ cwd: web }).verify(code, [{
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins,
    settings: { react: { version: '19.1' } },
    rules: { [rule]: ['error', options] },
  }], { filename: resolve(web, 'dependency-compat-fixture.js') });
}

function expectRuleErrors(messages, rule, count) {
  assert.equal(messages.length, count, JSON.stringify(messages));
  assert.ok(messages.every(message => !message.fatal && message.ruleId === rule));
}

test('patched minimatch keeps callable CommonJS and named APIs for ESLint plugins', () => {
  assert.equal(reactRequire('minimatch/package.json').version, '11.0.1');
  for (const plugin of ['eslint-plugin-import', 'eslint-plugin-react', 'eslint-plugin-jsx-a11y']) {
    const requirePlugin = createRequire(configRequire.resolve(plugin));
    const matcher = requirePlugin('minimatch');
    assert.equal(typeof matcher, 'function', plugin);
    assert.equal(matcher.minimatch, matcher);
    assert.equal(matcher('src/page.tsx', '**/*.{ts,tsx}'), true);
    assert.equal(matcher('src/page.js', '**/*.{ts,tsx}'), false);
    assert.equal(new matcher.Minimatch('src/**').match('src/page.tsx'), true);
    assert.deepEqual(matcher.match(['page.tsx', 'page.js'], '*.tsx'), ['page.tsx']);
    assert.equal(matcher.defaults({ nocase: true })('PAGE.TSX', '*.tsx'), true);
    assert.equal(typeof matcher.escape, 'function');
    assert.equal(typeof matcher.unescape, 'function');
  }
});

test('patched minimatch keeps ESM default and named imports used by config loaders', async () => {
  const packageFile = reactRequire.resolve('minimatch/package.json');
  const metadata = reactRequire('minimatch/package.json');
  const esm = await import(pathToFileURL(resolve(dirname(packageFile), metadata.exports['.'].import.default)).href);
  assert.equal(esm.default, esm.minimatch);
  assert.equal(esm.default('components/Button.tsx', '**/*.tsx'), true);
  assert.equal(new esm.Minimatch('*.tsx').match('Button.js'), false);
  assert.equal(esm.default.Minimatch, esm.Minimatch);

  // Their CommonJS entrypoints alone would not catch a missing ESM default export.
  const configArrayCjs = eslintRequire.resolve('@eslint/config-array');
  const configArray = await import(pathToFileURL(resolve(dirname(configArrayCjs), '../esm/index.js')).href);
  assert.equal(typeof configArray.ConfigArray, 'function');
  const eslintrcPackage = configRequire.resolve('@eslint/eslintrc/package.json');
  const eslintrc = await import(pathToFileURL(resolve(dirname(eslintrcPackage), 'lib/index.js')).href);
  assert.equal(typeof eslintrc.FlatCompat, 'function');
});

test('import/no-internal-modules preserves glob allow and forbid decisions', () => {
  const rule = 'import/no-internal-modules';
  const code = 'import "./lib/site-config.ts";';
  expectRuleErrors(lint(code, rule, { allow: ['lib/**'] }), rule, 0);
  expectRuleErrors(lint(code, rule, { allow: ['other/**'] }), rule, 1);
  expectRuleErrors(lint(code, rule, { forbid: ['lib/**'] }), rule, 1);
  expectRuleErrors(lint(code, rule, { forbid: ['other/**'] }), rule, 0);
  expectRuleErrors(lint('import "@scope/package/internal";', rule, { forbid: ['@scope/*/internal'] }), rule, 1);
});

test('import rules still execute callable minimatch for pattern exceptions', () => {
  const rule = 'import/no-namespace';
  const code = 'import * as icons from "./icons.js";';
  expectRuleErrors(lint(code, rule, { ignore: ['icons.*'] }), rule, 0);
  expectRuleErrors(lint(code, rule, { ignore: ['other.*'] }), rule, 1);
});

test('React glob exceptions still distinguish matching and nonmatching components', () => {
  const rule = 'react/jsx-pascal-case';
  const code = 'const element = <Widget_name />;';
  expectRuleErrors(lint(code, rule, { ignore: ['Widget_*'] }), rule, 0);
  expectRuleErrors(lint(code, rule, { ignore: ['Other_*'] }), rule, 1);
});

test('accessibility rules still recognize custom controls through glob patterns', () => {
  const rule = 'jsx-a11y/label-has-associated-control';
  const code = 'const element = <label>Name<CustomInput /></label>;';
  expectRuleErrors(lint(code, rule, { controlComponents: ['Custom*'], assert: 'nesting' }), rule, 0);
  expectRuleErrors(lint(code, rule, { controlComponents: ['Other*'], assert: 'nesting' }), rule, 1);
});

test('Next ESLint root lookup still excludes files and accepts directory globs', () => {
  const nextRequire = createRequire(configRequire.resolve('@next/eslint-plugin-next'));
  const { getRootDirs } = nextRequire('./utils/get-root-dirs.js');
  const normalizedWeb = web.replace(/\\/g, '/').replace(/\/$/, '');
  const roots = rootDir => getRootDirs({ cwd: normalizedWeb, settings: { next: { rootDir } } })
    .map(path => path.replace(/\\/g, '/')).sort();
  assert.deepEqual(roots(), [normalizedWeb]);
  assert.deepEqual(roots(`${normalizedWeb}/../w*b`), [normalizedWeb]);
  assert.deepEqual(roots(`${normalizedWeb}/package.json`), []);
  assert.deepEqual(roots(`${normalizedWeb}/no-such-next-root`), []);
});
