import { app, BrowserWindow, clipboard, dialog, Menu, shell } from 'electron';
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
import { applySingleInstancePreference } from './singleInstance';
import { sshStateMap, sftpBatchControlMap, connectionSessionMap, lastKnownCwdMap, sharedState } from './state';
import { runSftpUploadBatch, runSftpDownloadBatch, ensureUniqueLocalPath, getDefaultDownloadDir, resolveRemotePath, getOrCreateSftp } from './sftp';
import { setSessionPasswordToKeytar, deleteSessionPasswordFromKeytar, toPublicSession, loadSession, getSessionForConnection, requireConnected, cleanupConnectionState } from './session';
import { getRemoteShellCwd, updateCwdFromPrompt } from './ssh';
import { safeSend } from './window';
import { switchToEnglishInputMethod } from './inputMethod';
import { registerNativeFileDragIpc } from './nativeFileDrag';
import { registerTrustedHandle, registerTrustedOn } from './ipcSecurity';
import { cancelPendingHostKeyRequests, createHostVerifier, registerHostKeyIpc } from './hostKey';
import { cancelPendingAuthChallenges, registerAuthChallengeIpc, requestAuthChallengeAnswers } from './authChallenge';
import { isStoredPasswordPrompt } from './authPrompt';
import { toSftpErrorPayload } from './sftpError';
import { createTemporaryDownloadPath } from './downloadPath';
import {
  SSH_CONNECT_CANCELLED,
  beginConnectionAttempt,
  cancelPendingConnectionAttempt,
  releaseConnectionAttempt,
} from './connectionAttempt';

const ipcMain = {
  handle: (
    channel: string,
    listener: (event: import('electron').IpcMainInvokeEvent, ...args: any[]) => any,
  ) => registerTrustedHandle(channel, async (event, ...args) => {
    if (!channel.startsWith('sftp:')) return listener(event, ...args);
    try {
      return { ok: true, value: await listener(event, ...args) };
    } catch (error) {
      return { ok: false, error: toSftpErrorPayload(error) };
    }
  }),
  on: registerTrustedOn,
};

const SSH_DATA_FLUSH_DELAY_MS = 4;
const MAX_SSH_DATA_IPC_CHUNK = 64 * 1024;

export function registerIpc() {
  registerHostKeyIpc();
  registerAuthChallengeIpc();
  registerNativeFileDragIpc();
  const sshDataBufferMap = new Map<number, string>();
  const sshDataTimerMap = new Map<number, ReturnType<typeof setTimeout>>();
  const flushSshData = (connectionId: number, flushAll = false) => {
    const timer = sshDataTimerMap.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      sshDataTimerMap.delete(connectionId);
    }
    const data = sshDataBufferMap.get(connectionId);
    if (!data) return;
    if (data.length <= MAX_SSH_DATA_IPC_CHUNK) {
      sshDataBufferMap.delete(connectionId);
      safeSend('ssh:data', { sessionId: connectionId, data });
      return;
    }
    if (flushAll) {
      sshDataBufferMap.delete(connectionId);
      for (let start = 0; start < data.length; start += MAX_SSH_DATA_IPC_CHUNK) {
        safeSend('ssh:data', {
          sessionId: connectionId,
          data: data.slice(start, start + MAX_SSH_DATA_IPC_CHUNK),
        });
      }
      return;
    }
    const chunk = data.slice(0, MAX_SSH_DATA_IPC_CHUNK);
    const rest = data.slice(MAX_SSH_DATA_IPC_CHUNK);
    sshDataBufferMap.set(connectionId, rest);
    safeSend('ssh:data', { sessionId: connectionId, data: chunk });
    const nextTimer = setTimeout(() => flushSshData(connectionId), 0);
    sshDataTimerMap.set(connectionId, nextTimer);
  };
  const enqueueSshData = (connectionId: number, data: string) => {
    const current = sshDataBufferMap.get(connectionId) || '';
    const next = current + data;
    sshDataBufferMap.set(connectionId, next);
    if (next.length >= MAX_SSH_DATA_IPC_CHUNK) {
      flushSshData(connectionId);
      return;
    }
    if (sshDataTimerMap.has(connectionId)) return;
    const timer = setTimeout(() => flushSshData(connectionId), SSH_DATA_FLUSH_DELAY_MS);
    sshDataTimerMap.set(connectionId, timer);
  };

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
    if ((merged.behavior.singleInstance ?? true) && !applySingleInstancePreference(true)) {
      throw new Error('当前已有另一个实例占用单实例锁，无法启用单实例运行');
    }
    await saveSettings(merged);
    const saved = readSettings();
    if (!(merged.behavior.singleInstance ?? true)) {
      applySingleInstancePreference(false);
    }
    safeSend('settings:changed', saved);
    return saved;
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
  ipcMain.handle('clipboard:write-text', async (_, text: string) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
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
        const passwordValue = String(payload.password || '');
        if (payload.remember_password === 1 && passwordValue.length > 0) {
          await setSessionPasswordToKeytar(sessionId, passwordValue);
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
    const passwordValue = String(payload.password || '');
    if (payload.remember_password !== 1) {
      await deleteSessionPasswordFromKeytar(payload.id);
    } else if (passwordValue.length > 0) {
      await setSessionPasswordToKeytar(payload.id, passwordValue);
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
      cancelPendingHostKeyRequests(connectionId);
      cancelPendingAuthChallenges(connectionId);
      const attempt = beginConnectionAttempt(connectionId);
      flushSshData(connectionId);
      try {
        await cleanupConnectionState(connectionId);
        if (attempt.cancelled) throw new Error(SSH_CONNECT_CANCELLED);
        const session = await loadSession(profileSessionId);
        if (attempt.cancelled) throw new Error(SSH_CONNECT_CANCELLED);
        const password = connectPayload.password ?? session.password;
        const savePassword = !!connectPayload.savePassword && !!connectPayload.password;
        return await new Promise<boolean>((resolve, reject) => {
       const client = new Client();
       attempt.client = client;
       let settled = false;
       let hostKeyMismatch = false;
       const fail = (err: unknown) => {
         if (settled) return;
         settled = true;
         releaseConnectionAttempt(connectionId, attempt);
         void cleanupConnectionState(connectionId, client);
         if (attempt.cancelled) {
           reject(new Error(SSH_CONNECT_CANCELLED));
           return;
         }
         reject(hostKeyMismatch ? new Error('SSH_HOST_KEY_MISMATCH') : err);
       };
       attempt.reject = (error) => fail(error);
       const ok = () => {
         if (settled) return;
         if (attempt.cancelled) {
           fail(new Error(SSH_CONNECT_CANCELLED));
           return;
         }
         settled = true;
         releaseConnectionAttempt(connectionId, attempt);
         resolve(true);
       };
      client
        .on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
          if (attempt.cancelled) {
            finish([]);
            return;
          }
          if (!prompts || prompts.length === 0) {
            finish([]);
            return;
          }
          const answers = prompts.map(() => '');
          const unknownPrompts: Array<{ prompt: string; echo: boolean; index: number }> = [];
          prompts.forEach((prompt: { prompt?: string; echo?: boolean }, index: number) => {
            const label = String(prompt?.prompt || '认证信息');
            if (isStoredPasswordPrompt(label)) {
              answers[index] = password;
              return;
            }
            unknownPrompts.push({ prompt: String(prompt?.prompt || '认证信息'), echo: !!prompt?.echo, index });
          });
          if (unknownPrompts.length === 0) {
            finish(answers);
            return;
          }
          void requestAuthChallengeAnswers(
            connectionId,
            session.name,
            unknownPrompts.map(({ prompt, echo }) => ({ prompt, echo })),
          ).then((challengeAnswers) => {
            if (!challengeAnswers || challengeAnswers.length !== unknownPrompts.length) {
              finish([]);
              return;
            }
            unknownPrompts.forEach(({ index }, answerIndex) => {
              answers[index] = challengeAnswers[answerIndex];
            });
            finish(answers);
          }).catch(() => finish([]));
        })
        .on('ready', () => {
          if (attempt.cancelled) {
            client.destroy();
            return;
          }
          client.shell({ term: 'xterm-256color' }, (err, stream) => {
            if (err) {
              fail(err);
              return;
            }
            if (attempt.cancelled) {
              stream.close();
              client.destroy();
              return;
            }
            connectionSessionMap.set(connectionId, { ...session, password });
            sshStateMap.set(connectionId, { client, shell: stream });
            stream.on('data', (data: Buffer) => {
              const text = data.toString('utf8');
              updateCwdFromPrompt(connectionId, text);
              enqueueSshData(connectionId, text);
            });
            stream.on('close', () => {
              flushSshData(connectionId, true);
              void cleanupConnectionState(connectionId, client).then((cleaned) => {
                if (cleaned) safeSend('ssh:closed', { sessionId: connectionId });
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
          hostVerifier: createHostVerifier(
            session,
            () => {
              hostKeyMismatch = true;
            },
            connectionId,
          ),
        });
        });
      } catch (error) {
        releaseConnectionAttempt(connectionId, attempt);
        throw error;
      }
    },
  );

  const writeSshInput = (payload: { sessionId: number; input: string }) => {
    const state = sshStateMap.get(payload.sessionId);
    if (!state?.shell) throw new Error('SSH 未连接');
    state.shell.write(payload.input);
    return true;
  };
  ipcMain.on('ssh:input', (_, payload: { sessionId: number; input: string }) => {
    writeSshInput(payload);
  });
  ipcMain.handle('ssh:send', async (_, payload: { sessionId: number; input: string }) => {
    return writeSshInput(payload);
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
    cancelPendingHostKeyRequests(sessionId);
    cancelPendingAuthChallenges(sessionId);
    cancelPendingConnectionAttempt(sessionId);
    flushSshData(sessionId, true);
    await cleanupConnectionState(sessionId);
    return true;
  });
  ipcMain.handle('ssh:get-cwd', async (_, sessionId: number) => {
    const state = sshStateMap.get(sessionId);
    if (!state) return '';
    const cached = lastKnownCwdMap.get(sessionId);
    const live = await getRemoteShellCwd(state.client);
    if (live) {
      lastKnownCwdMap.set(sessionId, live);
      return live;
    }
    if (cached && cached.trim()) return cached.trim();
    return '';
  });
  ipcMain.handle('ssh:get-cached-cwd', async (_, sessionId: number) => {
    if (!sshStateMap.has(sessionId)) return '';
    return lastKnownCwdMap.get(sessionId)?.trim() || '';
  });

  ipcMain.handle('sftp:list', async (_, payload: {
    sessionId: number;
    requestSequence: number;
    path: string;
    showHidden: boolean;
  }) => {
    requireConnected(payload.sessionId);
    const session = await getSessionForConnection(payload.sessionId);
    const client = await getOrCreateSftp(payload.sessionId, session);
    const targetPath = await resolveRemotePath(client, payload.path);
    const list = await client.list(targetPath);
    const items = list
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
    return { sessionId: payload.sessionId, requestSequence: payload.requestSequence, items };
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
    let localPath = await ensureUniqueLocalPath(downloadDir, fileName || 'download');
    const temporaryPath = createTemporaryDownloadPath(localPath);
    try {
      await client.fastGet(remotePath, temporaryPath);
      try {
        await fs.promises.access(localPath, fs.constants.F_OK);
        localPath = await ensureUniqueLocalPath(downloadDir, path.basename(localPath));
      } catch {
        // The allocated final path is still free.
      }
      await fs.promises.rename(temporaryPath, localPath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
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
    const clients = new Set<any>([...(batch.clients || []), ...(batch.client ? [batch.client] : [])]);
    if (batch.ownsClient) await Promise.all(Array.from(clients, async (client) => client.end().catch(() => null)));
    batch.client = undefined;
    batch.clients = [];
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
  ipcMain.handle('app:open-external', async (_, url: string) => {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      await shell.openExternal(parsed.toString());
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('app:switch-to-english-input-method', async () => switchToEnglishInputMethod());
}
