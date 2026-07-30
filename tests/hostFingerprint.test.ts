import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHostKeyFingerprint } from '../electron/main/hostFingerprint';

test('formats OpenSSH SHA256 host fingerprints without base64 padding', () => {
  assert.equal(
    formatHostKeyFingerprint(Buffer.from('abc')),
    'SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0',
  );
});
