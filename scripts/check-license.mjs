// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Ivan Slavinskyi. All rights reserved.
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkLicense(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const errors = [];
  const license = await readFile(join(root, 'LICENSE'), 'utf8').catch(() => '');
  if (!license) errors.push('Root LICENSE is missing or empty.');
  if (!license.includes('© 2026 Ivan Slavinskyi. All rights reserved.')) errors.push('LICENSE must name © 2026 Ivan Slavinskyi. All rights reserved.');
  if (!license.includes('только с предварительного письменного согласия правообладателя')) errors.push('LICENSE must require prior written permission.');
  const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const section = workspace.match(/^packages:\s*\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m)?.[1] ?? '';
  const patterns = [...section.matchAll(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map(match => match[1]);
  // Deliberately only inspect workspace manifests, never dependency/vendor trees.
  const manifests = ['package.json'];
  for (const pattern of patterns) {
    if (!/^[a-z][a-z0-9_-]*\/\*$/.test(pattern)) { errors.push(`Unsupported workspace pattern: ${pattern}; update license checker.`); continue; }
    const folder = pattern.slice(0, -2);
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = `${folder}/${entry.name}/package.json`;
      try { await readFile(join(root, path)); manifests.push(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  if (!patterns.length) errors.push('No workspace package patterns found.');
  for (const path of manifests) {
    const value = JSON.parse(await readFile(join(root, path), 'utf8'));
    if (value.license !== 'UNLICENSED' || value.licenses !== undefined) errors.push(`${path}: first-party license must be UNLICENSED with no legacy licenses field.`);
  }
  return { errors, packages: manifests.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkLicense();
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`License check passed: LICENSE owner and ${result.packages} first-party packages.`);
}
