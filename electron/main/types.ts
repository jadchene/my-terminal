import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';

export type AppSettings = {
  theme: {
    backgroundColor: string;
    foregroundColor: string;
    uiFontFamily: string;
    uiFontSize: number;
    terminalFontFamily: string;
    terminalFontSize: number;
    terminalCursorStyle: 'block' | 'underline' | 'bar';
    terminalCursorBlink: boolean;
    terminalCursorWidth: number;
  };
  behavior: {
    autoCopySelection: boolean;
    rightClickPaste: boolean;
    multilineWarning: boolean;
    defaultDownloadDir: string;
    singleInstance: boolean;
    autoSwitchEnglishInputMethod: boolean;
  };
  ui: {
    sidebarVisible: boolean;
    sftpVisible: boolean;
    showHiddenFiles: boolean;
    sidebarWidth: number;
  };
};

export type Session = {
  id: number;
  folder_id: number | null;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  remember_password: number;
  default_session: number;
};

export type SshConnectionState = {
  client: Client;
  shell?: any;
};

export type SftpProgressPayload = {
  sessionId: number;
  batchId: string;
  direction: 'upload' | 'download';
  index: number;
  totalCount: number;
  name: string;
  transferred: number;
  total: number;
};

export type SftpBatchControl = {
  sessionId: number;
  connectionId: number;
  cancelled: boolean;
  client?: any;
  ownsClient?: boolean;
};

export type SftpProgressThrottleState = {
  at: number;
  transferred: number;
  total: number;
};

export type PendingCwdProbe = {
  token: string;
  buffer: string;
  timer: NodeJS.Timeout;
  resolve: (cwd: string) => void;
  reject: (error: Error) => void;
};

export type PendingPwdCapture = {
  buffer: string;
  timer: NodeJS.Timeout;
  resolve: (cwd: string) => void;
  reject: (error: Error) => void;
};

export type RemoteMetricsSnapshot = {
  cpuTotal: number;
  cpuIdle: number;
  netRx: number;
  netTx: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  at: number;
};

export type RemoteMetricsPayload = {
  system: { version: string; arch: string };
  cpu: number;
  cpuName: string;
  cpuCores: number;
  memory: { usedGb: number; totalGb: number; percent: number };
  network: { upload: number; download: number; ips: string[] };
  disk: { totalGb: number; usedGb: number; percent: number; upload: number; download: number };
  gpu:
    | { available: false; items: [] }
    | {
        available: true;
        items: Array<{
          index: number;
          name: string;
          memoryUsedGb: number;
          memoryTotalGb: number;
          memoryPercent: number;
          load: number;
        }>;
      };
};

export type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
};

export type UploadTask = {
  localPath: string;
  remotePath: string;
  name: string;
  size: number;
};

export type DownloadTask = {
  remotePath: string;
  localPath: string;
  name: string;
  size: number;
};
