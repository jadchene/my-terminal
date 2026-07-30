import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  allocateUniqueLocalPath,
  assertPathInside,
  createTemporaryDownloadPath,
  sanitizeLocalFileName,
} from '../electron/main/downloadPath';

test('sanitizes hostile and reserved Windows download names', () => {
  assert.equal(sanitizeLocalFileName('../CON.txt'), '_CON.txt');
  assert.equal(sanitizeLocalFileName('bad<>:"/\\|?*.txt '), '___.txt');
  assert.equal(sanitizeLocalFileName('...'), 'download');
});

test('confines, allocates unique names, and creates same-directory temporary paths', async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'my-terminal-download-'));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  assert.throws(() => assertPathInside(root, path.join(root, '..', 'escape.txt')));
  const existing = path.join(root, 'report.txt');
  await fs.promises.writeFile(existing, 'existing');
  const reserved = new Set<string>();
  const first = await allocateUniqueLocalPath(root, 'report.txt', reserved);
  const second = await allocateUniqueLocalPath(root, 'report.txt', reserved);
  assert.equal(path.basename(first), 'report (2).txt');
  assert.equal(path.basename(second), 'report (3).txt');
  const temporary = createTemporaryDownloadPath(first);
  assert.equal(path.dirname(temporary), root);
  assert.match(path.basename(temporary), /^\.report \(2\)\.txt\..+\.part$/);
});
