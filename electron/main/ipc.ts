import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';
import { AppSettings, Session } from './types';
import { runtimeDir, userDataPath, dbPath } from './env';
import { run, all, get } from './db';
import { SETTINGS_KEY, readSettings, saveSettings } from './settings';
import { sshStateMap, sftpBatchControlMap, connectionSessionMap, lastKnownCwdMap, sharedState } from './state';
import { runSftpUploadBatch, runSftpDownloadBatch, ensureUniqueLocalPath, getDefaultDownloadDir, resolveRemotePath, getOrCreateSftp } from './sftp';
import { setSessionPasswordToKeytar, deleteSessionPasswordFromKeytar, toPublicSession, loadSession, getSessionForConnection, requireConnected, cleanupConnectionState } from './session';
import { getShellPwd, processShellDataForPwdCapture, updateCwdFromPrompt } from './ssh';
import { safeSend } from './window';

export function registerIpc() {
  ipcMain.handle('settings:get', async () => readSettings());
  ipcMain.handle('settings:update', async (_, partial: Partial<AppSettings>) => {
    const current = readSettings();
    const merged: AppSettings = {
      ...current,
      ...partial,
      theme: { ...current.theme, ...(partial.theme || {}) },
      behavior: { ...current.behavior, ...(partial.behavior || {}) },
      ui: { ...current.ui, ...(partial.ui || {}) },
    };
    await saveSettings(merged);
    safeSend('settings:changed', merged);
    return merged;
  });

  ipcMain.handle('window:minimize', () => sharedState.mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!sharedState.mainWindow) return false;
    if (sharedState.mainWindow.isMaximized()) {
      sharedState.mainWindow.unmaximize();
    } else {
      sharedState.mainWindow.maximize();
    }
    return sharedState.mainWindow.isMaximized();
  });
  ipcMain.handle('window:is-maximized', () => {
    if (!sharedState.mainWindow) return false;
    return sharedState.mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => sharedState.mainWindow?.close());
  ipcMain.handle('metrics:set-session', async (_, sessionId: number | null) => {
    sharedState.metricsSessionId = sessionId;
    sharedState.metricsInactiveSent = false;
    return true;
  });

  ipcMain.handle('folder:list', async () => all('SELECT * FROM session_folder ORDER BY id ASC'));
  ipcMain.handle('folder:create', async (_, payload: { name: string; parentId: number | null }) => {
    await run('INSERT INTO session_folder(name, parent_id) VALUES(?, ?)', [payload.name, payload.parentId]);
    return true;
  });
  ipcMain.handle('folder:update', async (_, payload: { id: number; name: string }) => {
    await run('UPDATE session_folder SET name = ? WHERE id = ?', [payload.name, payload.id]);
    return true;
  });
  ipcMain.handle('folder:delete', async (_, folderId: number) => {
    const childFolderCount = await get<{ count: number }>(
      'SELECT COUNT(1) AS count FROM session_folder WHERE parent_id = ?',
      [folderId],
    );
    if ((childFolderCount?.count || 0) > 0) {
      throw new Error('目录下存在子目录，无法删除');
    }
    const sessionCount = await get<{ count: number }>(
      'SELECT COUNT(1) AS count FROM session WHERE folder_id = ?',
      [folderId],
    );
    if ((sessionCount?.count || 0) > 0) {
      throw new Error('目录下存在会话，无法删除');
    }
    await run('DELETE FROM session_folder WHERE id = ?', [folderId]);
    return true;
  });

  ipcMain.handle('session:list', async () => {
    const list = await all<Session>('SELECT * FROM session ORDER BY id ASC');
    return list.map(toPublicSession);
  });
  ipcMain.handle(
    'session:create',
    async (_, payload: Omit<Session, 'id'>) => {
      if (payload.default_session === 1) {
        await run('UPDATE session SET default_session = 0');
      }
      await run(
        `INSERT INTO session(folder_id, name, host, port, username, password, remember_password, default_session)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.folder_id,
          payload.name,
          payload.host,
          payload.port,
          payload.username,
          '',
          payload.remember_password,
          payload.default_session,
        ],
      );
      const inserted = await get<{ id: number }>('SELECT last_insert_rowid() AS id');
      const sessionId = Number(inserted?.id || 0);
      if (sessionId > 0) {
        const trimmedPassword = String(payload.password || '').trim();
        if (payload.remember_password === 1 && trimmedPassword) {
          await setSessionPasswordToKeytar(sessionId, trimmedPassword);
        } else {
          await deleteSessionPasswordFromKeytar(sessionId);
        }
      }
      return true;
    },
  );
  ipcMain.handle('session:update', async (_, payload: Session) => {
    if (payload.default_session === 1) {
      await run('UPDATE session SET default_session = 0');
    }
    await run(
      `UPDATE session
       SET folder_id = ?, name = ?, host = ?, port = ?, username = ?, password = ?, remember_password = ?, default_session = ?
       WHERE id = ?`,
      [
        payload.folder_id,
        payload.name,
        payload.host,
        payload.port,
        payload.username,
        '',
        payload.remember_password,
        payload.default_session,
        payload.id,
      ],
    );
    const trimmedPassword = String(payload.password || '').trim();
    if (payload.remember_password !== 1) {
      await deleteSessionPasswordFromKeytar(payload.id);
    } else if (trimmedPassword) {
      await setSessionPasswordToKeytar(payload.id, trimmedPassword);
    }
    return true;
  });
  ipcMain.handle('session:delete', async (_, sessionId: number) => {
    await run('DELETE FROM session WHERE id = ?', [sessionId]);
    await deleteSessionPasswordFromKeytar(sessionId);
    return true;
  });

  ipcMain.handle(
    'ssh:connect',
    async (
      _,
      payload: number | { sessionId: number; connectionId?: number; password?: string; savePassword?: boolean },
    ) => {
      const connectPayload = typeof payload === 'number' ? { sessionId: payload } : payload;
      const profileSessionId = connectPayload.sessionId;
      const connectionId = connectPayload.connectionId ?? profileSessionId;
      const session = await loadSession(profileSessionId);
      const password = connectPayload.password ?? session.password;
      const savePassword = !!connectPayload.savePassword && !!connectPayload.password;
      await cleanupConnectionState(connectionId);
    return new Promise<boolean>((resolve, reject) => {
      const client = new Client();
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        void cleanupConnectionState(connectionId);
        reject(err);
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        resolve(true);
      };
      client
        .on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
          if (!prompts || prompts.length === 0) {
            finish([]);
            return;
          }
          // Fallback for servers that require keyboard-interactive auth.
          if (prompts.length === 1) {
            finish([password]);
            return;
          }
          finish(
            prompts.map((prompt: { prompt?: string }) => {
              const label = String(prompt?.prompt || '').toLowerCase();
              if (
                label.includes('password') ||
                label.includes('passcode') ||
                label.includes('passwd') ||
                label.includes('密码')
              ) {
                return password;
              }
              return '';
            }),
          );
        })
        .on('ready', () => {
          client.shell({ term: 'xterm-256color' }, (err, stream) => {
            if (err) {
              fail(err);
              return;
            }
            connectionSessionMap.set(connectionId, { ...session, password });
            sshStateMap.set(connectionId, { client, shell: stream });
            stream.on('data', (data: Buffer) => {
              const text = data.toString('utf8');
              processShellDataForPwdCapture(connectionId, text);
              updateCwdFromPrompt(connectionId, text);
              safeSend('ssh:data', { sessionId: connectionId, data: text });
            });
            stream.on('close', () => {
              void cleanupConnectionState(connectionId).finally(() => {
                safeSend('ssh:closed', { sessionId: connectionId });
              });
            });
            if (savePassword) {
              const latestPassword = String(connectPayload.password || '');
              Promise.all([
                setSessionPasswordToKeytar(profileSessionId, latestPassword),
                run('UPDATE session SET password = ?, remember_password = 1 WHERE id = ?', ['', profileSessionId]),
              ])
                .then(() => ok())
                .catch((dbErr) => fail(dbErr));
              return;
            }
            ok();
          });
        })
        .on('error', (err) => fail(err))
        .connect({
          host: session.host,
          port: session.port,
          username: session.username,
          password,
          tryKeyboard: true,
          keepaliveInterval: 10000,
          readyTimeout: 20000,
        });
    });
    },
  );

  ipcMain.handle('ssh:send', async (_, payload: { sessionId: number; input: string }) => {
    const state = sshStateMap.get(payload.sessionId);
    if (!state?.shell) throw new Error('SSH 未连接');
    state.shell.write(payload.input);
    return true;
  });
  ipcMain.handle('ssh:resize', async (_, payload: { sessionId: number; cols: number; rows: number }) => {
    const state = sshStateMap.get(payload.sessionId);
    if (!state?.shell) return false;
    const cols = Math.max(2, Number(payload.cols || 0));
    const rows = Math.max(2, Number(payload.rows || 0));
    try {
      state.shell.setWindow(rows, cols, 0, 0);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('ssh:disconnect', async (_, sessionId: number) => {
    await cleanupConnectionState(sessionId);
    return true;
  });
  ipcMain.handle('ssh:get-cwd', async (_, sessionId: number) => {
    const state = sshStateMap.get(sessionId);
    if (!state) return '/';
    const cached = lastKnownCwdMap.get(sessionId);
    try {
      const live = await getShellPwd(sessionId);
      const resolvedLive = live.trim();
      if (resolvedLive) return resolvedLive;
    } catch {
      // Fall through to cached/exec fallback.
    }
    if (cached && cached.trim()) return cached.trim();
    return new Promise<string>((resolve) => {
      state.client.exec('pwd', (err, stream) => {
        if (err) {
          resolve('/');
          return;
        }
        let output = '';
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        stream.on('close', () => {
          const resolved = output.trim() || '/';
          lastKnownCwdMap.set(sessionId, resolved);
          resolve(resolved);
        });
      });
    });
  });

  ipcMain.handle('sftp:list', async (_, payload: { sessionId: number; path: string; showHidden: boolean }) => {
    try {
      requireConnected(payload.sessionId);
      const session = await getSessionForConnection(payload.sessionId);
      const client = await getOrCreateSftp(payload.sessionId, session);
      const targetPath = await resolveRemotePath(client, payload.path);
      const list = await client.list(targetPath);
      return list
        .filter((item: { name: string }) => payload.showHidden || !item.name.startsWith('.'))
        .map((item: any) => ({
          type: item.type,
          name: item.name,
          size: Number(item.size || 0),
          modifyTime: Number(item.modifyTime || 0),
          accessTime: Number(item.accessTime || 0),
          rights: item.rights || undefined,
          owner: item.owner,
          group: item.group,
          longname: item.longname,
        }))
        .sort((a: { type: string; name: string }, b: { type: string; name: string }) => {
          const aDir = a.type === 'd' ? 0 : 1;
          const bDir = b.type === 'd' ? 0 : 1;
          if (aDir !== bDir) return aDir - bDir;
          return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
        });
    } catch (error) {
      const msg = String(error).toLowerCase();
      if (msg.includes('no such file') || msg.includes('not connected') || msg.includes('closed') || msg.includes('stream.on')) {
        console.warn(`[SFTP] List suppressed for sessionId ${payload.sessionId}: ${msg}`);
        return [];
      }
      throw error;
    }
  });
  ipcMain.handle('sftp:home', async (_, sessionId: number) => {
    requireConnected(sessionId);
    const session = await getSessionForConnection(sessionId);
    const client = await getOrCreateSftp(sessionId, session);
    const cwd = await client.cwd().catch(() => '~');
    return typeof cwd === 'string' && cwd.trim() ? cwd.trim() : '~';
  });
  ipcMain.handle('sftp:mkdir', async (_, payload: { sessionId: number; path: string }) => {
    requireConnected(payload.sessionId);
    const session = await getSessionForConnection(payload.sessionId);
    const client = await getOrCreateSftp(payload.sessionId, session);
    const targetPath = await resolveRemotePath(client, payload.path);
    await client.mkdir(targetPath, true);
    return true;
  });
  ipcMain.handle('sftp:rename', async (_, payload: { sessionId: number; from: string; to: string }) => {
    requireConnected(payload.sessionId);
    const session = await getSessionForConnection(payload.sessionId);
    const client = await getOrCreateSftp(payload.sessionId, session);
    const fromPath = await resolveRemotePath(client, payload.from);
    const toPath = await resolveRemotePath(client, payload.to);
    await client.rename(fromPath, toPath);
    return true;
  });
  ipcMain.handle('sftp:delete', async (_, payload: { sessionId: number; path: string; isDir: boolean }) => {
    requireConnected(payload.sessionId);
    const session = await getSessionForConnection(payload.sessionId);
    const client = await getOrCreateSftp(payload.sessionId, session);
    const targetPath = await resolveRemotePath(client, payload.path);
    if (payload.isDir) await client.rmdir(targetPath, true);
    else await client.delete(targetPath);
    return true;
  });
  ipcMain.handle('sftp:upload', async (_, payload: { sessionId: number; remoteDir: string }) => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'] });
    if (picked.canceled || picked.filePaths.length === 0) return false;
    return runSftpUploadBatch({ sessionId: payload.sessionId, remoteDir: payload.remoteDir, localPaths: [picked.filePaths[0]] });
  });
  ipcMain.handle('sftp:download', async (_, payload: { sessionId: number; remotePath: string }) => {
    requireConnected(payload.sessionId);
    const session = await getSessionForConnection(payload.sessionId);
    const client = await getOrCreateSftp(payload.sessionId, session);
    const remotePath = await resolveRemotePath(client, payload.remotePath);
    const fileName = path.basename(remotePath.replace(/\/+$/, '')) || path.basename(remotePath);
    const downloadDir = getDefaultDownloadDir();
    await fs.promises.mkdir(downloadDir, { recursive: true });
    const localPath = await ensureUniqueLocalPath(downloadDir, fileName || 'download');
    await client.fastGet(remotePath, localPath);
    return true;
  });
  ipcMain.handle('sftp:upload-batch', async (_, payload: { sessionId: number; remoteDir: string; localPaths?: string[] }) => {
    let localPaths = payload.localPaths || [];
    if (!localPaths.length) {
      const picked = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory', 'multiSelections'] });
      if (picked.canceled || picked.filePaths.length === 0) return false;
      localPaths = picked.filePaths;
    }
    return runSftpUploadBatch({ sessionId: payload.sessionId, remoteDir: payload.remoteDir, localPaths });
  });
  ipcMain.handle('sftp:download-batch', async (_, payload: { sessionId: number; remotePaths: string[]; localDir?: string }) => {
    if (!payload.remotePaths.length) return false;
    const localDir = payload.localDir || getDefaultDownloadDir();
    await fs.promises.mkdir(localDir, { recursive: true });
    const ok = await runSftpDownloadBatch({ sessionId: payload.sessionId, remotePaths: payload.remotePaths, localDir });
    return ok;
  });
  ipcMain.handle('sftp:cancel-batch', async (_, payload: { sessionId: number; batchId: string }) => {
    const batch = sftpBatchControlMap.get(payload.batchId);
    if (!batch || batch.sessionId !== payload.sessionId) return false;
    batch.cancelled = true;
    if (batch.client && batch.ownsClient) {
      try {
        await batch.client.end();
      } catch {
        // Ignore close errors when cancelling transfer.
      }
      batch.client = undefined;
    }
    return true;
  });
  ipcMain.handle('dialog:pick-directory', async (_, defaultPath?: string) => {
    const picked = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath && defaultPath.trim() ? defaultPath : undefined,
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return picked.filePaths[0];
  });

  ipcMain.handle('app:runtime-paths', async () => ({
    runtimeDir,
    userDataPath,
    settingsStorage: `sqlite:${dbPath}#app_setting.${SETTINGS_KEY}`,
    dbPath,
    os: os.platform(),
  }));
}