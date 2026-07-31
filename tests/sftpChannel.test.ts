import assert from 'node:assert/strict';
import test from 'node:test';
import type { SFTPWrapper, TransferOptions } from 'ssh2';
import { createSftpTransferChannel } from '../electron/main/sftpChannel';

test('SFTP transfer workers use independent channels on one SSH transport', async () => {
  const calls: string[] = [];
  const createChannel = (id: number) => ({
    fastGet: (_remote: string, _local: string, _options: TransferOptions, callback: (error?: Error) => void) => {
      calls.push(`get:${id}`);
      callback();
    },
    fastPut: (_local: string, _remote: string, _options: TransferOptions, callback: (error?: Error) => void) => {
      calls.push(`put:${id}`);
      callback();
    },
    end: () => calls.push(`end:${id}`),
  }) as unknown as SFTPWrapper;
  let channelId = 0;
  const transport = {
    sftp: (callback: (error: Error | undefined, channel: SFTPWrapper) => void) => {
      channelId += 1;
      callback(undefined, createChannel(channelId));
    },
  };

  const first = await createSftpTransferChannel(transport);
  const second = await createSftpTransferChannel(transport);
  await Promise.all([
    first.fastPut('a.local', 'a.remote', {}),
    second.fastGet('b.remote', 'b.local', {}),
  ]);
  await Promise.all([first.end(), second.end()]);

  assert.deepEqual(calls, ['put:1', 'get:2', 'end:1', 'end:2']);
});

test('SFTP channel creation reports transport errors', async () => {
  const failure = new Error('channel rejected');
  await assert.rejects(
    createSftpTransferChannel({
      sftp: (callback) => callback(failure, undefined as unknown as SFTPWrapper),
    }),
    failure,
  );
});
