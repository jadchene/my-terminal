import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appRoot, rendererDevUrl } from './env';

type TrustedIpcEvent = IpcMainEvent | IpcMainInvokeEvent;

const rendererEntryPath = path.resolve(appRoot, 'dist', 'index.html');

export const isTrustedRendererUrl = (input: string): boolean => {
  try {
    const url = new URL(input);
    if (rendererDevUrl && url.origin === rendererDevUrl) return true;
    if (url.protocol !== 'file:') return false;
    return path.resolve(fileURLToPath(url)) === rendererEntryPath;
  } catch {
    return false;
  }
};

export const assertTrustedIpcEvent = (event: TrustedIpcEvent): void => {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('已拒绝非主框架 IPC 请求');
  }
  if (!isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('已拒绝非受信页面 IPC 请求');
  }
};

export const registerTrustedHandle = (
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
): void => {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcEvent(event);
    return listener(event, ...args);
  });
};

export const registerTrustedOn = (
  channel: string,
  listener: (event: IpcMainEvent, ...args: any[]) => void,
): void => {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertTrustedIpcEvent(event);
      listener(event, ...args);
    } catch (error) {
      console.warn(`[IPC] Rejected ${channel}:`, error);
    }
  });
};
