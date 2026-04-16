import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';

type AppSettings = {
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
  };
  ui: {
    sidebarVisible: boolean;
    sftpVisible: boolean;
    showHiddenFiles: boolean;
    sidebarWidth: number;
  };
};

type Session = {
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

type SshConnectionState = {
  client: Client;
  shell?: any;
};

type SftpProgressPayload = {
  sessionId: number;
  batchId: string;
  direction: 'upload' | 'download';
  index: number;
  totalCount: number;
  name: string;
  transferred: number;
  total: number;
};

type PendingCwdProbe = {
  token: string;
  buffer: string;
  timer: NodeJS.Timeout;
  resolve: (cwd: string) => void;
  reject: (error: Error) => void;
};

type PendingPwdCapture = {
  buffer: string;
  timer: NodeJS.Timeout;
  resolve: (cwd: string) => void;
  reject: (error: Error) => void;
};

const defaultSettings: AppSettings = {
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

const isDev = !app.isPackaged;
const devAppRoot = path.resolve(__dirname, '..', '..');
const appRoot = isDev ? devAppRoot : app.getAppPath();
const runtimeDir = isDev ? devAppRoot : path.dirname(process.execPath);
const userDataPath = path.join(runtimeDir, 'user-data');
const configPath = path.join(runtimeDir, 'config.json');
const dbPath = path.join(runtimeDir, 'app.db');
const windowStatePath = path.join(userDataPath, 'window-state.json');
const preloadCandidates = [
  path.join(appRoot, 'electron', 'preload.js'),
  path.join(appRoot, 'dist-electron', 'electron', 'preload.js'),
  path.join(__dirname, 'preload.js'),
];
const preloadPath = preloadCandidates.find((candidate) => fs.existsSync(candidate)) || preloadCandidates[0];

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}
app.setPath('userData', userDataPath);

const db = new sqlite3.Database(dbPath);
const sshStateMap = new Map<number, SshConnectionState>();
const sftpMap = new Map<number, any>();
const connectionSessionMap = new Map<number, Session>();
const connectionHomeMap = new Map<number, string>();
const pendingCwdProbeMap = new Map<number, PendingCwdProbe>();
const pendingPwdCaptureMap = new Map<number, PendingPwdCapture>();
const lastKnownCwdMap = new Map<number, string>();

let mainWindow: BrowserWindow | null = null;
let settingsWatcher: fs.FSWatcher | null = null;
let metricsTimer: NodeJS.Timeout | null = null;
let metricsCollecting = false;
let metricsSessionId: number | null = null;
let metricsInactiveSent = false;

type RemoteMetricsSnapshot = {
  cpuTotal: number;
  cpuIdle: number;
  netRx: number;
  netTx: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  at: number;
};

const remoteMetricsSnapshotMap = new Map<number, RemoteMetricsSnapshot>();

type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
};

function readWindowState(): WindowState | null {
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

function persistWindowState(target: BrowserWindow | null) {
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

function clearPendingCwdProbe(connectionId: number, error?: Error) {
  const pending = pendingCwdProbeMap.get(connectionId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingCwdProbeMap.delete(connectionId);
  if (error) {
    pending.reject(error);
  }
}

function clearPendingPwdCapture(connectionId: number, error?: Error) {
  const pending = pendingPwdCaptureMap.get(connectionId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingPwdCaptureMap.delete(connectionId);
  if (error) {
    pending.reject(error);
  }
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function resolveHomeToken(connectionId: number, tokenPath: string): string {
  const session = connectionSessionMap.get(connectionId);
  const fallbackHome = session?.username === 'root' ? '/root' : session?.username ? `/home/${session.username}` : '/';
  const home = connectionHomeMap.get(connectionId) || fallbackHome;
  if (tokenPath === '~') return home;
  if (tokenPath.startsWith('~/')) return path.posix.normalize(path.posix.join(home, tokenPath.slice(2)));
  return tokenPath;
}

function updateCwdFromPrompt(connectionId: number, shellChunk: string) {
  const clean = stripAnsi(shellChunk);
  const lines = clean.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const matched = line.match(/\[[^\]\r\n]*?\s([~\/][^\]\r\n]*)\]\s*[#$]\s*$/);
    if (!matched?.[1]) continue;
    const cwd = resolveHomeToken(connectionId, matched[1].trim());
    if (cwd) {
      lastKnownCwdMap.set(connectionId, cwd);
    }
  }
}

function processShellDataForPwdCapture(connectionId: number, shellChunk: string) {
  const pending = pendingPwdCaptureMap.get(connectionId);
  if (!pending) return;
  const clean = stripAnsi(shellChunk);
  pending.buffer += `\n${clean}`;
  if (pending.buffer.length > 20000) {
    pending.buffer = pending.buffer.slice(-20000);
  }
  const lines = pending.buffer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !!line);
  const pwdLine = [...lines].reverse().find((line) => line.startsWith('/'));
  if (!pwdLine) return;
  clearTimeout(pending.timer);
  pendingPwdCaptureMap.delete(connectionId);
  lastKnownCwdMap.set(connectionId, pwdLine);
  pending.resolve(pwdLine);
}

async function getShellPwd(connectionId: number): Promise<string> {
  const state = sshStateMap.get(connectionId);
  if (!state?.shell) throw new Error('SSH 未连接');
  clearPendingPwdCapture(connectionId, new Error('目录采集被新的请求中断'));
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingPwdCaptureMap.delete(connectionId);
      reject(new Error('获取当前目录超时'));
    }, 6000);
    pendingPwdCaptureMap.set(connectionId, {
      buffer: '',
      timer,
      resolve,
      reject,
    });
    state.shell.write('pwd\n');
  });
}

function processShellDataForCwdProbe(connectionId: number, chunk: string): string {
  const pending = pendingCwdProbeMap.get(connectionId);
  if (!pending) return chunk;
  pending.buffer += chunk;
  if (pending.buffer.length > 20000) {
    pending.buffer = pending.buffer.slice(-20000);
  }
  const begin = `__CODEX_CWD_BEGIN_${pending.token}__`;
  const end = `__CODEX_CWD_END_${pending.token}__`;
  const endAt = pending.buffer.lastIndexOf(end);
  const beginAt = endAt >= 0 ? pending.buffer.lastIndexOf(begin, endAt) : -1;
  if (beginAt >= 0 && endAt > beginAt) {
    const raw = pending.buffer.slice(beginAt + begin.length, endAt);
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => !!line && !line.includes(begin) && !line.includes(end));
    const pathLine =
      lines.find((line) => line.startsWith('/')) ||
      lines.find((line) => line.startsWith('~')) ||
      lines[lines.length - 1] ||
      '/';
    const cwd = pathLine.trim();
    clearTimeout(pending.timer);
    pendingCwdProbeMap.delete(connectionId);
    lastKnownCwdMap.set(connectionId, cwd || '/');
    pending.resolve(cwd || '/');
  }
  // During probe, suppress output chunks to avoid printing probe markers in terminal.
  return '';
}

async function getInteractiveShellCwd(connectionId: number): Promise<string> {
  const state = sshStateMap.get(connectionId);
  if (!state?.shell) throw new Error('SSH 未连接');
  clearPendingCwdProbe(connectionId, new Error('目录探测被新的请求中断'));
  return new Promise<string>((resolve, reject) => {
    const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      pendingCwdProbeMap.delete(connectionId);
      reject(new Error('获取当前目录超时'));
    }, 8000);
    pendingCwdProbeMap.set(connectionId, {
      token,
      buffer: '',
      timer,
      resolve,
      reject,
    });
    state.shell.write(`echo "__CODEX_CWD_BEGIN_${token}__"; pwd; echo "__CODEX_CWD_END_${token}__"\n`);
  });
}

function safeSend(channel: string, payload?: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (wc.isDestroyed()) return;
  if (payload === undefined) {
    wc.send(channel);
    return;
  }
  wc.send(channel, payload);
}

function run(sql: string, params: any[] = []): Promise<void> {
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

function all<T>(sql: string, params: any[] = []): Promise<T[]> {
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

function get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
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

function toSftpPath(input: string): string {
  return (input || '.').replace(/\\/g, '/');
}

function buildRemotePath(parent: string, name: string): string {
  const raw = toSftpPath(parent || '~');
  if (raw === '/') return `/${name}`;
  const normalized = raw.replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') return name;
  return `${normalized}/${name}`;
}

function createBatchId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emitSftpProgress(payload: SftpProgressPayload) {
  safeSend('sftp:progress', payload);
}

function getDefaultDownloadDir(): string {
  const settings = readSettings();
  const configured = String(settings.behavior.defaultDownloadDir || '').trim();
  return configured || app.getPath('downloads');
}

async function ensureUniqueLocalPath(targetDir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let index = 0;
  while (index < 1000) {
    const nextName = index === 0 ? `${base}${ext}` : `${base} (${index})${ext}`;
    const nextPath = path.join(targetDir, nextName);
    try {
      await fs.promises.access(nextPath, fs.constants.F_OK);
      index += 1;
    } catch {
      return nextPath;
    }
  }
  return path.join(targetDir, `${base}-${Date.now()}${ext}`);
}

function isSftpDir(attrs: any): boolean {
  if (!attrs) return false;
  if (typeof attrs.isDirectory === 'function') return attrs.isDirectory();
  if (typeof attrs.isDirectory === 'boolean') return attrs.isDirectory;
  if (attrs.type === 'd') return true;
  if (typeof attrs.mode === 'number') return (attrs.mode & 0o170000) === 0o040000;
  return false;
}

type UploadTask = {
  localPath: string;
  remotePath: string;
  name: string;
  size: number;
};

async function collectUploadTasks(localPath: string, remoteDir: string, tasks: UploadTask[]) {
  const stat = await fs.promises.stat(localPath);
  if (!stat.isDirectory()) {
    tasks.push({
      localPath,
      remotePath: buildRemotePath(remoteDir, path.basename(localPath)),
      name: path.basename(localPath),
      size: stat.size,
    });
    return;
  }

  const rootRemoteDir = buildRemotePath(remoteDir, path.basename(localPath));
  const walk = async (currentLocalDir: string, currentRemoteDir: string) => {
    const entries = await fs.promises.readdir(currentLocalDir, { withFileTypes: true });
    for (const entry of entries) {
      const localChild = path.join(currentLocalDir, entry.name);
      const remoteChild = buildRemotePath(currentRemoteDir, entry.name);
      if (entry.isDirectory()) {
        await walk(localChild, remoteChild);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileStat = await fs.promises.stat(localChild);
      tasks.push({
        localPath: localChild,
        remotePath: remoteChild,
        name: path.relative(localPath, localChild).replace(/\\/g, '/'),
        size: fileStat.size,
      });
    }
  };

  await walk(localPath, rootRemoteDir);
}

type DownloadTask = {
  remotePath: string;
  localPath: string;
  name: string;
  size: number;
};

async function collectDownloadTasks(
  client: any,
  remotePath: string,
  localPath: string,
  tasks: DownloadTask[],
  displayRootPath: string,
  displayRootName: string,
) {
  const attrs = await client.stat(remotePath);
  const normalizedCurrent = remotePath.replace(/\/+$/, '');
  const normalizedRoot = displayRootPath.replace(/\/+$/, '');
  const rel = normalizedCurrent.startsWith(`${normalizedRoot}/`)
    ? normalizedCurrent.slice(normalizedRoot.length + 1)
    : '';
  const displayName = rel ? `${displayRootName}/${rel}` : displayRootName;
  if (!isSftpDir(attrs)) {
    tasks.push({
      remotePath,
      localPath,
      name: displayName,
      size: Number(attrs?.size || 0),
    });
    return;
  }

  await fs.promises.mkdir(localPath, { recursive: true });
  const items = await client.list(remotePath);
  for (const item of items) {
    if (item.name === '.' || item.name === '..') continue;
    const childRemote = buildRemotePath(remotePath, item.name);
    const childLocal = path.join(localPath, item.name);
    if (item.type === 'd') {
      await collectDownloadTasks(client, childRemote, childLocal, tasks, displayRootPath, displayRootName);
      continue;
    }
    tasks.push({
      remotePath: childRemote,
      localPath: childLocal,
      name: `${displayRootName}/${childRemote.replace(/\/+$/, '').slice(normalizedRoot.length + 1)}`,
      size: Number(item.size || 0),
    });
  }
}

async function resolveRemotePath(client: any, input: string): Promise<string> {
  const normalized = toSftpPath(input || '.').trim();
  if (!normalized || normalized === '.') {
    const cwd = await client.cwd().catch(() => '.');
    return typeof cwd === 'string' && cwd.trim() ? cwd.trim() : '.';
  }
  if (normalized === '~' || normalized.startsWith('~/')) {
    const home = await client.cwd().catch(() => '.');
    const safeHome = typeof home === 'string' && home.trim() ? home.trim() : '.';
    if (normalized === '~') return safeHome;
    return buildRemotePath(safeHome, normalized.slice(2));
  }
  return normalized;
}

function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...defaultSettings,
      ...parsed,
      theme: { ...defaultSettings.theme, ...(parsed.theme || {}) },
      behavior: { ...defaultSettings.behavior, ...(parsed.behavior || {}) },
      ui: { ...defaultSettings.ui, ...(parsed.ui || {}) },
    };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(nextSettings: AppSettings) {
  fs.writeFileSync(configPath, JSON.stringify(nextSettings, null, 2), 'utf8');
}

async function initStorage() {
  if (!fs.existsSync(configPath)) {
    saveSettings(defaultSettings);
  }

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
}

async function loadSession(sessionId: number): Promise<Session> {
  const session = await get<Session>('SELECT * FROM session WHERE id = ?', [sessionId]);
  if (!session) {
    throw new Error('会话不存在');
  }
  return session;
}

async function getOrCreateSftp(connectionId: number, session: Session): Promise<any> {
  const old = sftpMap.get(connectionId);
  if (old) {
    try {
      await old.cwd();
      return old;
    } catch {
      try {
        await old.end();
      } catch {
        // Ignore close errors.
      }
      sftpMap.delete(connectionId);
    }
  }
  const client = new SftpClient();
  await client.connect({
    host: session.host,
    port: session.port,
    username: session.username,
    password: session.password,
    readyTimeout: 20000,
  });
  const cwd = await client.cwd().catch(() => '');
  if (cwd && typeof cwd === 'string') {
    connectionHomeMap.set(connectionId, cwd.trim());
  }
  sftpMap.set(connectionId, client);
  return client;
}

async function getSessionForConnection(connectionId: number): Promise<Session> {
  const mapped = connectionSessionMap.get(connectionId);
  if (mapped) return mapped;
  return loadSession(connectionId);
}

function requireConnected(connectionId: number) {
  if (!sshStateMap.has(connectionId)) {
    throw new Error('SSH 未连接');
  }
}

async function cleanupConnectionState(connectionId: number) {
  clearPendingCwdProbe(connectionId, new Error('连接已关闭'));
  clearPendingPwdCapture(connectionId, new Error('连接已关闭'));
  const sshState = sshStateMap.get(connectionId);
  if (sshState) {
    try {
      sshState.client.end();
    } catch {
      // Ignore close errors.
    }
  }
  sshStateMap.delete(connectionId);
  connectionSessionMap.delete(connectionId);
  connectionHomeMap.delete(connectionId);
  lastKnownCwdMap.delete(connectionId);
  remoteMetricsSnapshotMap.delete(connectionId);
  if (metricsSessionId === connectionId) {
    metricsSessionId = null;
  }
  const sftp = sftpMap.get(connectionId);
  if (sftp) {
    try {
      await sftp.end();
    } catch {
      // Ignore close errors.
    }
    sftpMap.delete(connectionId);
  }
}

async function runSftpUploadBatch(payload: { sessionId: number; remoteDir: string; localPaths: string[] }): Promise<boolean> {
  if (!payload.localPaths.length) return false;
  const connectionId = payload.sessionId;
  requireConnected(connectionId);
  const session = await getSessionForConnection(connectionId);
  const client = await getOrCreateSftp(connectionId, session);
  const remoteDir = await resolveRemotePath(client, payload.remoteDir);
  const batchId = createBatchId();
  emitSftpProgress({
    sessionId: payload.sessionId,
    batchId,
    direction: 'upload',
    index: 0,
    totalCount: 0,
    name: '准备中',
    transferred: 0,
    total: 0,
  });
  const tasks: UploadTask[] = [];
  let successCount = 0;
  let failedCount = 0;
  try {
    for (const localPath of payload.localPaths) {
      await collectUploadTasks(localPath, remoteDir, tasks);
    }
    if (tasks.length > 0) {
      emitSftpProgress({
        sessionId: payload.sessionId,
        batchId,
        direction: 'upload',
        index: 0,
        totalCount: tasks.length,
        name: tasks[0].name,
        transferred: 0,
        total: tasks[0].size || 0,
      });
    }
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      try {
        await client.mkdir(path.posix.dirname(task.remotePath), true);
        await client.fastPut(task.localPath, task.remotePath, {
          step: (transferred: number, _chunk: number, total: number) => {
            emitSftpProgress({
              sessionId: payload.sessionId,
              batchId,
              direction: 'upload',
              index,
              totalCount: tasks.length,
              name: task.name,
              transferred,
              total: total || task.size || 0,
            });
          },
        });
        successCount += 1;
        emitSftpProgress({
          sessionId: payload.sessionId,
          batchId,
          direction: 'upload',
          index,
          totalCount: tasks.length,
          name: task.name,
          transferred: task.size,
          total: task.size,
        });
      } catch (error) {
        failedCount += 1;
        safeSend('sftp:batch-error', {
          sessionId: payload.sessionId,
          batchId,
          direction: 'upload',
          name: task.name,
          error: String(error),
        });
      }
    }
  } catch (error) {
    failedCount += 1;
    safeSend('sftp:batch-error', {
      sessionId: payload.sessionId,
      batchId,
      direction: 'upload',
      name: 'batch',
      error: String(error),
    });
  }
  safeSend('sftp:batch-complete', {
    sessionId: payload.sessionId,
    batchId,
    direction: 'upload',
    totalCount: tasks.length,
    successCount,
    failedCount,
  });
  return successCount > 0 || tasks.length === 0;
}

async function runSftpDownloadBatch(payload: { sessionId: number; remotePaths: string[]; localDir?: string }): Promise<boolean> {
  if (!payload.remotePaths.length) return false;
  const connectionId = payload.sessionId;
  requireConnected(connectionId);
  const session = await getSessionForConnection(connectionId);
  const client = await getOrCreateSftp(connectionId, session);
  const batchId = createBatchId();
  emitSftpProgress({
    sessionId: payload.sessionId,
    batchId,
    direction: 'download',
    index: 0,
    totalCount: 0,
    name: '准备中',
    transferred: 0,
    total: 0,
  });
  const targetDir = payload.localDir || app.getPath('downloads');
  const tasks: DownloadTask[] = [];
  let successCount = 0;
  let failedCount = 0;
  try {
    for (const rawPath of payload.remotePaths) {
      const remotePath = await resolveRemotePath(client, rawPath);
      const normalizedRemote = remotePath.replace(/\/+$/, '') || '/';
      const fileName = path.basename(normalizedRemote);
      const localPath = path.join(targetDir, fileName);
      await collectDownloadTasks(client, remotePath, localPath, tasks, normalizedRemote, fileName || '/');
    }
    if (tasks.length > 0) {
      emitSftpProgress({
        sessionId: payload.sessionId,
        batchId,
        direction: 'download',
        index: 0,
        totalCount: tasks.length,
        name: tasks[0].name,
        transferred: 0,
        total: tasks[0].size || 0,
      });
    }
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      try {
        await fs.promises.mkdir(path.dirname(task.localPath), { recursive: true });
        await client.fastGet(task.remotePath, task.localPath, {
          step: (transferred: number, _chunk: number, total: number) => {
            emitSftpProgress({
              sessionId: payload.sessionId,
              batchId,
              direction: 'download',
              index,
              totalCount: tasks.length,
              name: task.name,
              transferred,
              total: total || task.size,
            });
          },
        });
        successCount += 1;
        emitSftpProgress({
          sessionId: payload.sessionId,
          batchId,
          direction: 'download',
          index,
          totalCount: tasks.length,
          name: task.name,
          transferred: task.size,
          total: task.size,
        });
      } catch (error) {
        failedCount += 1;
        safeSend('sftp:batch-error', {
          sessionId: payload.sessionId,
          batchId,
          direction: 'download',
          name: task.name,
          error: String(error),
        });
      }
    }
  } catch (error) {
    failedCount += 1;
    safeSend('sftp:batch-error', {
      sessionId: payload.sessionId,
      batchId,
      direction: 'download',
      name: 'batch',
      error: String(error),
    });
  }
  safeSend('sftp:batch-complete', {
    sessionId: payload.sessionId,
    batchId,
    direction: 'download',
    totalCount: tasks.length,
    successCount,
    failedCount,
  });
  return successCount > 0 || tasks.length === 0;
}

function createWindow() {
  if (!fs.existsSync(preloadPath)) {
    throw new Error(`preload.js not found. tried: ${preloadCandidates.join(' | ')}`);
  }
  const savedState = readWindowState();
  mainWindow = new BrowserWindow({
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
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(appRoot, 'dist', 'index.html'));
  }
  mainWindow.webContents.on('did-fail-load', (_, code, desc, url) => {
    console.error('Renderer load failed:', { code, desc, url });
  });
  mainWindow.on('maximize', () => {
    persistWindowState(mainWindow);
    safeSend('window:maximized-changed', true);
  });
  mainWindow.on('unmaximize', () => {
    persistWindowState(mainWindow);
    safeSend('window:maximized-changed', false);
  });
  mainWindow.on('resize', () => persistWindowState(mainWindow));
  mainWindow.on('move', () => persistWindowState(mainWindow));
  if (savedState?.maximized) {
    mainWindow.maximize();
  }
  mainWindow.on('closed', () => {
    persistWindowState(mainWindow);
    mainWindow = null;
  });
  Menu.setApplicationMenu(null);
}

function watchSettings() {
  settingsWatcher?.close();
  settingsWatcher = fs.watch(configPath, () => {
    safeSend('settings:changed', readSettings());
  });
}

function subscribeMetrics() {
  metricsTimer = setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed() || metricsCollecting) return;
    metricsCollecting = true;
    try {
      if (!metricsSessionId || !sshStateMap.has(metricsSessionId)) {
        if (!metricsInactiveSent) {
          safeSend('system:metrics', {
            cpu: 0,
            cpuCores: 0,
            cpuMhz: 0,
            memory: { usedGb: 0, totalGb: 0, percent: 0 },
            network: { upload: 0, download: 0 },
            disk: { upload: 0, download: 0 },
            gpu: { available: false, items: [] },
          });
          metricsInactiveSent = true;
        }
      } else {
        const payload = await collectRemoteMetrics(metricsSessionId);
        safeSend('system:metrics', payload);
        metricsInactiveSent = false;
      }
    } catch (error) {
      // Keep metrics loop alive even if a probe fails once.
      if (!metricsInactiveSent) {
        safeSend('system:metrics', {
          cpu: 0,
          cpuCores: 0,
          cpuMhz: 0,
          memory: { usedGb: 0, totalGb: 0, percent: 0 },
          network: { upload: 0, download: 0 },
          disk: { upload: 0, download: 0 },
          gpu: { available: false, items: [] },
        });
        metricsInactiveSent = true;
      }
    } finally {
      metricsCollecting = false;
    }
  }, 1000);
}

function parseCpu(line: string): { total: number; idle: number } {
  const parts = line.trim().split(/\s+/).slice(1).map((x) => Number(x) || 0);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((acc, n) => acc + n, 0);
  return { total, idle };
}

function parseCpuInfo(lines: string[]): { cores: number; mhz: number } {
  let cores = 0;
  const mhzValues: number[] = [];
  for (const line of lines) {
    if (line.startsWith('processor')) {
      cores += 1;
    }
    if (line.startsWith('cpu MHz')) {
      const matched = line.match(/:\s*([0-9.]+)/);
      if (matched?.[1]) {
        mhzValues.push(Number(matched[1]) || 0);
      }
    }
  }
  const mhz = mhzValues.length > 0 ? mhzValues.reduce((acc, n) => acc + n, 0) / mhzValues.length : 0;
  return { cores, mhz: Number(mhz.toFixed(0)) };
}

function parseMem(lines: string[]): { total: number; available: number } {
  let total = 0;
  let available = 0;
  for (const line of lines) {
    if (line.startsWith('MemTotal:')) {
      const v = Number(line.replace(/[^0-9]/g, '')) || 0;
      total = v * 1024;
    }
    if (line.startsWith('MemAvailable:')) {
      const v = Number(line.replace(/[^0-9]/g, '')) || 0;
      available = v * 1024;
    }
  }
  return { total, available };
}

function parseNet(lines: string[]): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of lines) {
    if (!line.includes(':')) continue;
    const [ifaceRaw, rest] = line.split(':');
    const iface = ifaceRaw.trim();
    if (iface === 'lo') continue;
    const fields = rest.trim().split(/\s+/).map((x) => Number(x) || 0);
    rx += fields[0] || 0;
    tx += fields[8] || 0;
  }
  return { rx, tx };
}

function parseDisk(lines: string[]): { readBytes: number; writeBytes: number } {
  let readSectors = 0;
  let writeSectors = 0;
  for (const line of lines) {
    const f = line.trim().split(/\s+/);
    if (f.length < 11) continue;
    const name = f[2];
    if (!/^sd[a-z]+$|^vd[a-z]+$|^xvd[a-z]+$|^nvme\d+n\d+$/.test(name)) continue;
    readSectors += Number(f[5]) || 0;
    writeSectors += Number(f[9]) || 0;
  }
  return { readBytes: readSectors * 512, writeBytes: writeSectors * 512 };
}

function parseGpu(lines: string[]) {
  const items = lines
    .map((line, index) => {
      const raw = String(line || '').trim();
      if (!raw) return null;
      const parts = raw.split(',').map((x) => x.trim());
      if (parts.length < 4) return null;
      const name = parts[0];
      const load = Number(parts[1]) || 0;
      const memUsedMb = Number(parts[2]) || 0;
      const memTotalMb = Number(parts[3]) || 0;
      return {
        index,
        name,
        memoryUsedGb: Number((memUsedMb / 1024).toFixed(2)),
        memoryTotalGb: Number((memTotalMb / 1024).toFixed(2)),
        memoryPercent: memTotalMb ? Number(((memUsedMb / memTotalMb) * 100).toFixed(1)) : 0,
        load: Number(load.toFixed(1)),
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
  return {
    available: items.length > 0,
    items,
  } as const;
}

function execOnSession(sessionId: number, command: string): Promise<string> {
  const state = sshStateMap.get(sessionId);
  if (!state) {
    return Promise.reject(new Error('SSH 未连接'));
  }
  return new Promise((resolve, reject) => {
    state.client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      stream.on('close', () => {
        if (stderr.trim()) {
          resolve(stdout);
          return;
        }
        resolve(stdout);
      });
    });
  });
}

async function collectRemoteMetrics(sessionId: number) {
  const script = [
    'echo "__CPU__"; head -n1 /proc/stat 2>/dev/null || echo ""',
    'echo "__CPUINFO__"; (cat /proc/cpuinfo 2>/dev/null || true)',
    'echo "__MEM__"; (grep -E "MemTotal|MemAvailable" /proc/meminfo 2>/dev/null || true)',
    'echo "__NET__"; (cat /proc/net/dev 2>/dev/null || true)',
    'echo "__DISK__"; (cat /proc/diskstats 2>/dev/null || true)',
    'echo "__GPU__"; (command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits || true)',
  ].join('; ');

  const output = await execOnSession(sessionId, script);
  const lines = output.split(/\r?\n/);
  const section: Record<string, string[]> = {
    CPU: [],
    CPUINFO: [],
    MEM: [],
    NET: [],
    DISK: [],
    GPU: [],
  };
  let current: keyof typeof section | null = null;
  for (const line of lines) {
    if (line === '__CPU__') current = 'CPU';
    else if (line === '__CPUINFO__') current = 'CPUINFO';
    else if (line === '__MEM__') current = 'MEM';
    else if (line === '__NET__') current = 'NET';
    else if (line === '__DISK__') current = 'DISK';
    else if (line === '__GPU__') current = 'GPU';
    else if (current) section[current].push(line);
  }

  const cpuLine = section.CPU[0] || '';
  const cpuStat = parseCpu(cpuLine);
  const cpuInfo = parseCpuInfo(section.CPUINFO);
  const memStat = parseMem(section.MEM);
  const netStat = parseNet(section.NET);
  const diskStat = parseDisk(section.DISK);
  const gpuStat = parseGpu(section.GPU);

  const now = Date.now();
  const prev = remoteMetricsSnapshotMap.get(sessionId);
  let cpu = 0;
  let netDownload = 0;
  let netUpload = 0;
  let diskRead = 0;
  let diskWrite = 0;

  if (prev) {
    const totalDelta = cpuStat.total - prev.cpuTotal;
    const idleDelta = cpuStat.idle - prev.cpuIdle;
    cpu = totalDelta > 0 ? Number((((totalDelta - idleDelta) / totalDelta) * 100).toFixed(1)) : 0;
    const sec = Math.max((now - prev.at) / 1000, 0.001);
    netDownload = Math.max((netStat.rx - prev.netRx) / sec, 0);
    netUpload = Math.max((netStat.tx - prev.netTx) / sec, 0);
    diskRead = Math.max((diskStat.readBytes - prev.diskReadBytes) / sec, 0);
    diskWrite = Math.max((diskStat.writeBytes - prev.diskWriteBytes) / sec, 0);
  }

  remoteMetricsSnapshotMap.set(sessionId, {
    cpuTotal: cpuStat.total,
    cpuIdle: cpuStat.idle,
    netRx: netStat.rx,
    netTx: netStat.tx,
    diskReadBytes: diskStat.readBytes,
    diskWriteBytes: diskStat.writeBytes,
    at: now,
  });

  const memUsed = Math.max(memStat.total - memStat.available, 0);
  return {
    cpu,
    cpuCores: cpuInfo.cores,
    cpuMhz: cpuInfo.mhz,
    memory: {
      usedGb: Number((memUsed / 1024 / 1024 / 1024).toFixed(2)),
      totalGb: Number((memStat.total / 1024 / 1024 / 1024).toFixed(2)),
      percent: memStat.total ? Number(((memUsed / memStat.total) * 100).toFixed(1)) : 0,
    },
    network: {
      upload: Number(netUpload.toFixed(0)),
      download: Number(netDownload.toFixed(0)),
    },
    disk: {
      upload: Number(diskWrite.toFixed(0)),
      download: Number(diskRead.toFixed(0)),
    },
    gpu: gpuStat,
  };
}

function registerIpc() {
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
    saveSettings(merged);
    return merged;
  });

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:is-maximized', () => {
    if (!mainWindow) return false;
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('metrics:set-session', async (_, sessionId: number | null) => {
    metricsSessionId = sessionId;
    metricsInactiveSent = false;
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

  ipcMain.handle('session:list', async () => all('SELECT * FROM session ORDER BY id ASC'));
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
          payload.password,
          payload.remember_password,
          payload.default_session,
        ],
      );
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
        payload.password,
        payload.remember_password,
        payload.default_session,
        payload.id,
      ],
    );
    return true;
  });
  ipcMain.handle('session:delete', async (_, sessionId: number) => {
    await run('DELETE FROM session WHERE id = ?', [sessionId]);
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
              run('UPDATE session SET password = ?, remember_password = 1 WHERE id = ?', [connectPayload.password, profileSessionId])
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
      }));
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
  ipcMain.handle('dialog:pick-directory', async (_, defaultPath?: string) => {
    const picked = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath && defaultPath.trim() ? defaultPath : undefined,
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return picked.filePaths[0];
  });

  ipcMain.handle('app:runtime-paths', async () => ({ runtimeDir, userDataPath, configPath, dbPath, os: os.platform() }));
}

app.whenReady().then(async () => {
  await initStorage();
  registerIpc();
  createWindow();
  watchSettings();
  subscribeMetrics();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  settingsWatcher?.close();
  if (metricsTimer) clearInterval(metricsTimer);

  for (const [, state] of sshStateMap) state.client.end();
  sshStateMap.clear();
  connectionSessionMap.clear();
  connectionHomeMap.clear();
  lastKnownCwdMap.clear();
  for (const [connectionId] of pendingCwdProbeMap) {
    clearPendingCwdProbe(connectionId, new Error('应用即将退出'));
  }
  for (const [connectionId] of pendingPwdCaptureMap) {
    clearPendingPwdCapture(connectionId, new Error('应用即将退出'));
  }

  for (const [, sftp] of sftpMap) await sftp.end();
  sftpMap.clear();
  db.close();
});


