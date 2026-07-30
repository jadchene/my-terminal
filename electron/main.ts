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
import { sshStateMap, sftpMap, sftpBatchControlMap, connectionSessionMap, connectionHomeMap, cwdOutputTailMap, lastKnownCwdMap, remoteMetricsSnapshotMap, remoteMetricsPayloadMap, sharedState } from './main/state';
import { subscribeMetrics } from './main/metrics';
import { createWindow, flushWindowState } from './main/window';
import { registerIpc } from './main/ipc';
import { readSettings } from './main/settings';
import { applySingleInstancePreference } from './main/singleInstance';
import { cancelAllNativeFileDrags } from './main/nativeFileDrag';
import { cancelPendingHostKeyRequests } from './main/hostKey';
import { cancelPendingAuthChallenges } from './main/authChallenge';
import { cancelAllPendingConnectionAttempts } from './main/connectionAttempt';

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

app.setPath('userData', userDataPath);

async function startApp() {
  await initStorage();
  if (!applySingleInstancePreference(readSettings().behavior.singleInstance ?? true)) {
    app.quit();
    return;
  }

  await app.whenReady();
  registerIpc();
  createWindow();
  subscribeMetrics();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

void startApp().catch((error) => {
  console.error('Failed to start application:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let gracefulQuitStarted = false;
let gracefulQuitFinished = false;

async function cleanupBeforeQuit() {
  flushWindowState(sharedState.mainWindow);
  cancelAllNativeFileDrags();
  cancelPendingHostKeyRequests();
  cancelPendingAuthChallenges();
  cancelAllPendingConnectionAttempts();
  if (sharedState.metricsTimer) clearInterval(sharedState.metricsTimer);
  sharedState.metricsTimer = null;
  const clientsToClose = new Set<any>();
  for (const [, control] of sftpBatchControlMap) {
    control.cancelled = true;
    if (control.client) clientsToClose.add(control.client);
    for (const client of control.clients || []) clientsToClose.add(client);
  }
  for (const [, sftp] of sftpMap) clientsToClose.add(sftp);
  await Promise.all(Array.from(clientsToClose, async (client) => client.end().catch(() => undefined)));
  for (const [, state] of sshStateMap) {
    try {
      state.client.end();
    } catch {
      // Ignore connection shutdown errors.
    }
  }
  sshStateMap.clear();
  connectionSessionMap.clear();
  connectionHomeMap.clear();
  cwdOutputTailMap.clear();
  lastKnownCwdMap.clear();
  remoteMetricsPayloadMap.clear();
  remoteMetricsSnapshotMap.clear();
  sftpMap.clear();
  sftpBatchControlMap.clear();
  await new Promise<void>((resolve) => db.close(() => resolve()));
}

app.on('before-quit', (event) => {
  if (gracefulQuitFinished) return;
  event.preventDefault();
  if (gracefulQuitStarted) return;
  gracefulQuitStarted = true;
  void Promise.race([
    cleanupBeforeQuit(),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]).finally(() => {
    gracefulQuitFinished = true;
    app.quit();
  });
});
