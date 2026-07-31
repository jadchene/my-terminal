import assert from 'node:assert/strict';
import test from 'node:test';
import { canWriteTerminalOutputImmediately } from '../src/utils/terminalOutput';

test('small ANSI terminal updates can be written without waiting for another frame', () => {
  assert.equal(canWriteTerminalOutputImmediately('\x1b[2K\rupdated'), true);
  assert.equal(canWriteTerminalOutputImmediately('\x1b[1;1H\x1b[32mvi\x1b[0m'), true);
});

test('large terminal output remains on the chunked write path', () => {
  assert.equal(canWriteTerminalOutputImmediately('x'.repeat(2 * 1024)), true);
  assert.equal(canWriteTerminalOutputImmediately('x'.repeat(2 * 1024 + 1)), false);
});
