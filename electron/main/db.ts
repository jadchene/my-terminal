import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';
import { Session } from './types';
import { dbPath } from './env';
import { defaultSettings, SETTINGS_KEY, normalizeSettings, saveSettings, readAppSetting, writeAppSetting } from './settings';
import { PASSWORD_MIGRATION_KEY, sharedState } from './state';
import { setSessionPasswordToKeytar, deleteSessionPasswordFromKeytar } from './session';

export const db = new sqlite3.Database(dbPath);

export function run(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function all<T>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows as T[]);
    });
  });
}

export function get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row as T | undefined);
    });
  });
}

export async function migrateSessionPasswordsToKeytarIfNeeded() {
  const flag = await readAppSetting(PASSWORD_MIGRATION_KEY);
  if (flag === '1') return;
  const sessions = await all<Session>('SELECT * FROM session');
  for (const session of sessions) {
    const plainPassword = String(session.password || '');
    if (session.remember_password === 1 && plainPassword) {
      await setSessionPasswordToKeytar(session.id, plainPassword);
    } else {
      await deleteSessionPasswordFromKeytar(session.id);
    }
    await run('UPDATE session SET password = ? WHERE id = ?', ['', session.id]);
  }
  await writeAppSetting(PASSWORD_MIGRATION_KEY, '1');
}

export async function initStorage() {
  await run(
    `CREATE TABLE IF NOT EXISTS session_folder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      name TEXT NOT NULL
    )`,
  );
  await run(
    `CREATE TABLE IF NOT EXISTS session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT,
      remember_password INTEGER DEFAULT 1,
      default_session INTEGER DEFAULT 0
    )`,
  );
  await run(
    `CREATE TABLE IF NOT EXISTS app_setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );
  const existing = await get<{ value: string }>('SELECT value FROM app_setting WHERE key = ?', [SETTINGS_KEY]);
  if (existing?.value) {
    try {
      sharedState.settingsCache = normalizeSettings(JSON.parse(existing.value));
    } catch {
      await saveSettings(defaultSettings);
    }
  } else {
    await saveSettings(defaultSettings);
  }
  await migrateSessionPasswordsToKeytarIfNeeded();
}