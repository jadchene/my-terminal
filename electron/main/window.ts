import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';
import { WindowState } from './types';
import { isDev, appRoot, windowStatePath, preloadCandidates, preloadPath } from './env';
import { sharedState } from './state';

export function readWindowState(): WindowState | null {
  try {
    const raw = fs.readFileSync(windowStatePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    const width = Math.max(900, Number(parsed.width || 1400));
    const height = Math.max(600, Number(parsed.height || 900));
    const hasX = Number.isFinite(parsed.x);
    const hasY = Number.isFinite(parsed.y);
    return {
      width,
      height,
      x: hasX ? Number(parsed.x) : undefined,
      y: hasY ? Number(parsed.y) : undefined,
      maximized: !!parsed.maximized,
    };
  } catch {
    return null;
  }
}

export function persistWindowState(target: BrowserWindow | null) {
  if (!target || target.isDestroyed()) return;
  const normalBounds = target.getNormalBounds();
  const payload: WindowState = {
    x: normalBounds.x,
    y: normalBounds.y,
    width: normalBounds.width,
    height: normalBounds.height,
    maximized: target.isMaximized(),
  };
  try {
    fs.writeFileSync(windowStatePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('failed to persist window state:', error);
  }
}

export function safeSend(channel: string, payload?: unknown) {
  if (!sharedState.mainWindow || sharedState.mainWindow.isDestroyed()) return;
  const wc = sharedState.mainWindow.webContents;
  if (wc.isDestroyed()) return;
  try {
    if (payload === undefined) {
      wc.send(channel);
      return;
    }
    wc.send(channel, payload);
  } catch (error) {
    const message = String(error || '').toLowerCase();
    if (message.includes('object has been destroyed') || message.includes('ipc') || message.includes('channel')) {
      return;
    }
    console.warn('safeSend failed:', { channel, error });
  }
}

export function createWindow() {
  if (!fs.existsSync(preloadPath)) {
    throw new Error(`preload.js not found. tried: ${preloadCandidates.join(' | ')}`);
  }
  const savedState = readWindowState();
  sharedState.mainWindow = new BrowserWindow({
    width: savedState?.width || 1400,
    height: savedState?.height || 900,
    x: savedState?.x,
    y: savedState?.y,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (isDev) {
    sharedState.mainWindow.loadURL('http://localhost:5173');
  } else {
    sharedState.mainWindow.loadFile(path.join(appRoot, 'dist', 'index.html'));
  }
  sharedState.mainWindow.webContents.on('did-fail-load', (_, code, desc, url) => {
    console.error('Renderer load failed:', { code, desc, url });
  });
  sharedState.mainWindow.on('maximize', () => {
    persistWindowState(sharedState.mainWindow);
    safeSend('window:maximized-changed', true);
  });
  sharedState.mainWindow.on('unmaximize', () => {
    persistWindowState(sharedState.mainWindow);
    safeSend('window:maximized-changed', false);
  });
  sharedState.mainWindow.on('resize', () => persistWindowState(sharedState.mainWindow));
  sharedState.mainWindow.on('move', () => persistWindowState(sharedState.mainWindow));
  if (savedState?.maximized) {
    sharedState.mainWindow.maximize();
  }
  sharedState.mainWindow.on('closed', () => {
    persistWindowState(sharedState.mainWindow);
    sharedState.mainWindow = null;
  });
  Menu.setApplicationMenu(null);
}