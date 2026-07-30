import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBoundedUtf8, materializeBoundedUtf8 } from '../src/utils/boundedText';
import { isLatestSessionRequest } from '../src/utils/requestSequence';
import { createSequentialQueue } from '../src/utils/sequentialQueue';
import { disposeTerminalResources } from '../src/utils/terminalResourceCleanup';

test('dialog requests resolve sequentially without overwriting the active request', async () => {
  const queue = createSequentialQueue<string, boolean | null>();
  const first = queue.enqueue<boolean>('first');
  const second = queue.enqueue<boolean>('second');

  assert.equal(first.activated, true);
  assert.equal(second.activated, false);
  assert.equal(queue.resolveActive(true), 'second');
  assert.equal(await first.promise, true);
  assert.equal(queue.resolveActive(false), null);
  assert.equal(await second.promise, false);
});

test('dialog requests can be cancelled by request identity while preserving queue order', async () => {
  const queue = createSequentialQueue<{ key: string }, boolean | null>();
  const first = queue.enqueue<boolean>({ key: 'expired' });
  const second = queue.enqueue<boolean>({ key: 'keep' });
  const third = queue.enqueue<boolean>({ key: 'expired' });

  const cancelled = queue.cancelWhere((item) => item.key === 'expired', null);
  assert.equal(cancelled.cancelledCount, 2);
  assert.equal(cancelled.activeCancelled, true);
  assert.equal(cancelled.next?.key, 'keep');
  assert.equal(await first.promise, null);
  assert.equal(await third.promise, null);
  assert.equal(queue.resolveActive(true), null);
  assert.equal(await second.promise, true);
});

test('paused terminal output keeps the newest valid UTF-8 bytes', () => {
  const value = appendBoundedUtf8(appendBoundedUtf8(undefined, 'old-', 8), '你好-new', 8);
  const text = materializeBoundedUtf8(value);
  assert.equal(value.byteLength <= 8, true);
  assert.equal(new TextEncoder().encode(text).byteLength, value.byteLength);
  assert.equal(text.endsWith('-new'), true);
  assert.equal(value.truncated, true);
});

test('paused terminal output drops complete old chunks before trimming the boundary chunk', () => {
  let value = appendBoundedUtf8(undefined, 'old', 12);
  const oldChunk = value.chunks[0];
  value = appendBoundedUtf8(value, 'middle-', 12);
  value = appendBoundedUtf8(value, 'newest', 12);

  assert.equal(value.chunks.slice(value.head).includes(oldChunk), false);
  assert.equal(materializeBoundedUtf8(value), 'iddle-newest');
  assert.equal(value.byteLength, 12);
});

test('stale session and request sequence responses are rejected', () => {
  assert.equal(isLatestSessionRequest(7, 7, 3, 3), true);
  assert.equal(isLatestSessionRequest(8, 7, 3, 3), false);
  assert.equal(isLatestSessionRequest(7, 7, 4, 3), false);
});

test('terminal cleanup cancels resources and disposes exactly once', () => {
  let disposed = 0;
  const frames: number[] = [];
  const timers: unknown[] = [];
  const timerA = setTimeout(() => undefined, 60_000);
  const timerB = setTimeout(() => undefined, 60_000);
  const map = <T>(value: T) => new Map<number, T>([[9, value]]);
  const resources = {
    terminal: map({ dispose: () => { disposed += 1; } }),
    fit: map({}),
    fitFrame: map(1),
    writeFrame: map(2),
    pauseFrame: map(3),
    stabilizedTimers: map([timerA]),
    inputTimer: map(timerB),
    selectionTimer: new Map<number, ReturnType<typeof setTimeout>>(),
    pendingOutput: map('output'),
    pendingWrite: map('write'),
    pendingInput: map('input'),
    pausedByScroll: map(true),
    autoCopySelection: map(true),
    disconnected: map(false),
  };
  disposeTerminalResources(9, resources, (frame) => frames.push(frame), (timer) => {
    timers.push(timer);
    clearTimeout(timer);
  });
  assert.deepEqual(frames, [1, 2, 3]);
  assert.equal(timers.length, 2);
  assert.equal(disposed, 1);
  assert.equal(resources.terminal.size, 0);
  assert.equal(resources.pendingOutput.size, 0);
});
