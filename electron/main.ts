import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';
import { userDataPath } from './main/env';
import { db, all, initStorage } from './main/db';
import { sshStateMap, sftpMap, sftpBatchControlMap, connectionSessionMap, connectionHomeMap, pendingCwdProbeMap, pendingPwdCaptureMap, lastKnownCwdMap, remoteMetricsSnapshotMap, remoteMetricsPayloadMap, sharedState } from './main/state';
import { subscribeMetrics } from './main/metrics';
import { clearPendingPwdCapture, clearPendingCwdProbe } from './main/ssh';
import { createWindow } from './main/window';
import { registerIpc } from './main/ipc';

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

app.setPath('userData', userDataPath);

app.whenReady().then(async () => {
  await initStorage();
  registerIpc();
  createWindow();
  subscribeMetrics();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (sharedState.metricsTimer) clearInterval(sharedState.metricsTimer);

  for (const [, state] of sshStateMap) state.client.end();
  sshStateMap.clear();
  connectionSessionMap.clear();
  connectionHomeMap.clear();
  lastKnownCwdMap.clear();
  remoteMetricsPayloadMap.clear();
  remoteMetricsSnapshotMap.clear();
  for (const [connectionId] of pendingCwdProbeMap) {
    clearPendingCwdProbe(connectionId, new Error('应用即将退出'));
  }
  for (const [connectionId] of pendingPwdCaptureMap) {
    clearPendingPwdCapture(connectionId, new Error('应用即将退出'));
  }

  for (const [, sftp] of sftpMap) await sftp.end();
  sftpMap.clear();
  sftpBatchControlMap.clear();
  db.close();
});