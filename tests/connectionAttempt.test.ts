import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SSH_CONNECT_CANCELLED,
  beginConnectionAttempt,
  cancelAllPendingConnectionAttempts,
  cancelPendingConnectionAttempt,
  releaseConnectionAttempt,
} from '../electron/main/connectionAttempt';
import { isSshConnectCancelledError } from '../src/utils/sshConnection';

test('closing a connecting tab destroys and rejects its pending SSH attempt', () => {
  cancelAllPendingConnectionAttempts();
  const attempt = beginConnectionAttempt(41);
  let destroyCalls = 0;
  let rejection = '';
  attempt.client = { destroy: () => { destroyCalls += 1; } };
  attempt.reject = (error) => { rejection = error.message; };

  assert.equal(cancelPendingConnectionAttempt(41), true);
  assert.equal(destroyCalls, 1);
  assert.equal(rejection, SSH_CONNECT_CANCELLED);
  assert.equal(cancelPendingConnectionAttempt(41), false);
});

test('releasing an old attempt cannot remove a newer connection attempt', () => {
  cancelAllPendingConnectionAttempts();
  const oldAttempt = beginConnectionAttempt(52);
  const currentAttempt = beginConnectionAttempt(52);
  releaseConnectionAttempt(52, oldAttempt);

  assert.equal(cancelPendingConnectionAttempt(52), true);
  assert.equal(currentAttempt.cancelled, true);
});

test('renderer recognizes the stable SSH cancellation sentinel', () => {
  assert.equal(isSshConnectCancelledError(new Error(SSH_CONNECT_CANCELLED)), true);
  assert.equal(isSshConnectCancelledError(new Error('Timed out while waiting for handshake')), false);
});
