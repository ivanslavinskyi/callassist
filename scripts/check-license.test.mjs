// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Ivan Slavinskyi. All rights reserved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLicense } from './check-license.mjs';

test('rejects missing notice, wrong owner, permissive own package and future unsupported workspace patterns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'callassist-license-'));
  try {
    await mkdir(join(root, 'apps', 'first-party'), { recursive: true });
    await mkdir(join(root, 'apps', 'first-party', 'node_modules', 'vendor'), { recursive: true });
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    await writeFile(join(root, 'package.json'), '{"license":"UNLICENSED"}');
    await writeFile(join(root, 'apps', 'first-party', 'package.json'), '{"license":"UNLICENSED"}');
    await writeFile(join(root, 'apps', 'first-party', 'node_modules', 'vendor', 'package.json'), '{"license":"MIT"}');
    assert.ok((await checkLicense(root)).errors.some(error => error.includes('missing')));
    const notice = '© 2026 Ivan Slavinskyi. All rights reserved.\nUse is permitted only with the prior written consent of the copyright holder.';
    await writeFile(join(root, 'LICENSE'), notice);
    assert.deepEqual(await checkLicense(root), { errors: [], packages: 2 });
    await writeFile(join(root, 'apps', 'first-party', 'package.json'), '{"license":"MIT"}');
    assert.ok((await checkLicense(root)).errors.some(error => error.includes('first-party license')));
    await writeFile(join(root, 'LICENSE'), notice.replace('Ivan Slavinskyi', 'Other Owner'));
    assert.ok((await checkLicense(root)).errors.some(error => error.includes('must name')));
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/**\n');
    assert.ok((await checkLicense(root)).errors.some(error => error.includes('Unsupported')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
