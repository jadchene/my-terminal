import type { SFTPWrapper, TransferOptions } from 'ssh2';

export type SftpChannelSource = {
  sftp: (callback: (error: Error | undefined, channel: SFTPWrapper) => void) => unknown;
};

export type SftpTransferClient = {
  fastGet: (remotePath: string, localPath: string, options: TransferOptions) => Promise<void>;
  fastPut: (localPath: string, remotePath: string, options: TransferOptions) => Promise<void>;
  end: () => Promise<void>;
};

const runTransfer = (
  channel: SFTPWrapper,
  method: 'fastGet' | 'fastPut',
  sourcePath: string,
  targetPath: string,
  options: TransferOptions,
): Promise<void> => new Promise((resolve, reject) => {
  channel[method](sourcePath, targetPath, options, (error) => {
    if (error) reject(error);
    else resolve();
  });
});

export const createSftpTransferChannel = (source: SftpChannelSource): Promise<SftpTransferClient> =>
  new Promise((resolve, reject) => {
    source.sftp((error, channel) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        fastGet: (remotePath, localPath, options) =>
          runTransfer(channel, 'fastGet', remotePath, localPath, options),
        fastPut: (localPath, remotePath, options) =>
          runTransfer(channel, 'fastPut', localPath, remotePath, options),
        end: async () => {
          channel.end();
        },
      });
    });
  });
