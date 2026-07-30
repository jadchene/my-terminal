import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldApplyCwdCalibration } from '../src/utils/sftpCwd';

test('live cwd calibrates only while the original SFTP location is still active', () => {
  assert.equal(shouldApplyCwdCalibration(7, '/cached', { sessionId: 7, path: '/cached' }, '/live'), true);
  assert.equal(shouldApplyCwdCalibration(7, '/cached/', { sessionId: 7, path: '/cached' }, '/live/'), true);
  assert.equal(shouldApplyCwdCalibration(7, '/cached', { sessionId: 8, path: '/cached' }, '/live'), false);
  assert.equal(shouldApplyCwdCalibration(7, '/cached', { sessionId: 7, path: '/manual' }, '/live'), false);
  assert.equal(shouldApplyCwdCalibration(7, '/cached', { sessionId: 7, path: '/cached' }, '/cached/'), false);
  assert.equal(shouldApplyCwdCalibration(7, '/cached', { sessionId: 7, path: '/cached' }, ''), false);
});
