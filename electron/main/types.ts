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
  clients?: any[];
  ownsClient?: boolean;
};

export type SftpProgressThrottleState = {
  at: number;
  transferred: number;
  total: number;
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
  sessionId: number | null;
  sequence: number;
  stale: boolean;
  sampledAt: number;
  system: { version: string; arch: string };
  cpu: number;
  cpuName: string;
  cpuPhysicalCores: number;
  cpuLogicalCores: number;
  cpuTemp: number | null;
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
          temperature: number;
          memoryUsedGb: number;
          memoryTotalGb: number;
          memoryPercent: number;
          load: number;
          powerDraw: number | null;
          powerLimit: number | null;
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
