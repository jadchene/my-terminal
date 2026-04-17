import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';
import { AppSettings } from './types';
import { run, get } from './db';
import { sharedState } from './state';

export const defaultSettings: AppSettings = {
  theme: {
    backgroundColor: '#000000',
    foregroundColor: '#FFFFFF',
    uiFontFamily: 'Microsoft YaHei, Segoe UI, sans-serif',
    uiFontSize: 13,
    terminalFontFamily: 'Consolas, Courier New, monospace',
    terminalFontSize: 16,
    terminalCursorStyle: 'block',
    terminalCursorBlink: true,
    terminalCursorWidth: 2,
  },
  behavior: {
    autoCopySelection: true,
    rightClickPaste: true,
    multilineWarning: true,
    defaultDownloadDir: '',
  },
  ui: {
    sidebarVisible: true,
    sftpVisible: true,
    showHiddenFiles: false,
    sidebarWidth: 300,
  },
};

export const SETTINGS_KEY = 'app_settings';

export async function readAppSetting(key: string): Promise<string | null> {
  const row = await get<{ value: string }>('SELECT value FROM app_setting WHERE key = ?', [key]);
  if (!row?.value) return null;
  return String(row.value);
}

export async function writeAppSetting(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO app_setting(key, value)
     VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export function readSettings(): AppSettings {
  return sharedState.settingsCache;
}

export function normalizeSettings(parsed: any): AppSettings {
  return {
    ...defaultSettings,
    ...(parsed || {}),
    theme: { ...defaultSettings.theme, ...((parsed && parsed.theme) || {}) },
    behavior: { ...defaultSettings.behavior, ...((parsed && parsed.behavior) || {}) },
    ui: { ...defaultSettings.ui, ...((parsed && parsed.ui) || {}) },
  };
}

export async function loadSettingsFromDb(): Promise<AppSettings> {
  const row = await get<{ value: string }>('SELECT value FROM app_setting WHERE key = ?', [SETTINGS_KEY]);
  if (!row?.value) return defaultSettings;
  try {
    const parsed = JSON.parse(row.value);
    return normalizeSettings(parsed);
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(nextSettings: AppSettings) {
  const normalized = normalizeSettings(nextSettings);
  sharedState.settingsCache = normalized;
  await run(
    `INSERT INTO app_setting(key, value)
     VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_KEY, JSON.stringify(normalized)],
  );
}

sharedState.settingsCache = defaultSettings;