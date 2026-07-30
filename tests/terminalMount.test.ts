import assert from 'node:assert/strict';
import test from 'node:test';
import { mountTerminal } from '../src/utils/terminalMount';

test('an opened terminal is reattached without calling open again', () => {
  const mountedChildren: unknown[] = [];
  const container = {
    replaceChildren: () => {
      mountedChildren.length = 0;
    },
    appendChild: (child: unknown) => {
      mountedChildren.push(child);
      return child;
    },
  } as unknown as HTMLElement;
  const element = {} as HTMLElement;
  let openCalls = 0;
  const terminal = {
    element,
    open: () => {
      openCalls += 1;
    },
  };

  mountTerminal(container, terminal);

  assert.equal(openCalls, 0);
  assert.deepEqual(mountedChildren, [element]);
});

test('a new terminal is opened exactly once', () => {
  let replaceCalls = 0;
  let openCalls = 0;
  const container = {
    replaceChildren: () => {
      replaceCalls += 1;
    },
  } as unknown as HTMLElement;

  mountTerminal(container, {
    open: (parent) => {
      assert.equal(parent, container);
      openCalls += 1;
    },
  });

  assert.equal(replaceCalls, 1);
  assert.equal(openCalls, 1);
});
