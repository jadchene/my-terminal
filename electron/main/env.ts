import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';
import { db } from './db';

export const isDev = !app.isPackaged;

export const devAppRoot = path.resolve(__dirname, '..', '..', '..');

export const appRoot = isDev ? devAppRoot : app.getAppPath();

export const runtimeDir = isDev ? devAppRoot : path.dirname(process.execPath);

export const userDataPath = path.join(runtimeDir, 'user-data');

export const dbPath = path.join(runtimeDir, 'app.db');

export const windowStatePath = path.join(userDataPath, 'window-state.json');

export const preloadCandidates = [
  path.join(appRoot, 'electron', 'preload.js'),
  path.join(appRoot, 'dist-electron', 'electron', 'preload.js'),
  path.join(__dirname, '..', 'preload.js'),
];

export const preloadPath = preloadCandidates.find((candidate) => fs.existsSync(candidate)) || preloadCandidates[0];