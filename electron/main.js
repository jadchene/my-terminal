import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import si from 'systeminformation';
const isDev = !app.isPackaged;
const projectRoot = path.resolve(__dirname, '..');
const runtimeDir = isDev ? projectRoot : path.dirname(process.execPath);
const configPath = path.join(runtimeDir, 'config.json');
const dbPath = path.join(runtimeDir, 'app.db');
const preloadPath = path.join(__dirname, 'preload.js');
let mainWindow = null;
let settingsWatcher = null;
let metricsTimer = null;
const sshStateMap = new Map();
const sftpMap = new Map();
const defaultSettings = {
    theme: {
        backgroundColor: '#000000',
        foregroundColor: '#FFFFFF',
        fontFamily: 'Consolas, Courier New, monospace',
        fontSize: 14,
    },
    behavior: {
        autoCopySelection: true,
        rightClickPaste: true,
        multilineWarning: true,
    },
    ui: {
        sidebarVisible: true,
        sftpVisible: true,
        showHiddenFiles: false,
    },
};
const db = new sqlite3.Database(dbPath);
function run(sql, params = []) {
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
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows);
        });
    });
}
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}
async function initStorage() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify(defaultSettings, null, 2), 'utf8');
    }
    await run(CREATE, TABLE, IF, NOT, EXISTS, session_folder(id, INTEGER, PRIMARY, KEY, AUTOINCREMENT, parent_id, INTEGER, name, TEXT, NOT, NULL));
    await run(CREATE, TABLE, IF, NOT, EXISTS, session(id, INTEGER, PRIMARY, KEY, AUTOINCREMENT, folder_id, INTEGER, name, TEXT, NOT, NULL, host, TEXT, NOT, NULL, port, INTEGER, NOT, NULL, username, TEXT, NOT, NULL, password, TEXT, remember_password, INTEGER, DEFAULT, 1, default_session, INTEGER, DEFAULT, 0));
    const folderCount = await get('SELECT COUNT(1) as count FROM session_folder');
    if (!folderCount || folderCount.count === 0) {
        await run('INSERT INTO session_folder(name, parent_id) VALUES(?, ?)', ['默认目录', null]);
    }
}
function readSettings() {
    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        return { ...defaultSettings, ...JSON.parse(raw) };
    }
    catch {
        return defaultSettings;
    }
}
function saveSettings(nextSettings) {
    fs.writeFileSync(configPath, JSON.stringify(nextSettings, null, 2), 'utf8');
}
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
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
    }
    else {
        mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
    }
    Menu.setApplicationMenu(null);
}
function watchSettings() {
    settingsWatcher?.close();
    settingsWatcher = fs.watch(configPath, () => {
        const payload = readSettings();
        mainWindow?.webContents.send('settings:changed', payload);
    });
}
function subscribeMetrics() {
    metricsTimer = setInterval(async () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }
        const [currentLoad, mem, network, disk, graphics] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.networkStats(),
            si.disksIO(),
            si.graphics(),
        ]);
        const nic = network[0];
        const gpuController = graphics.controllers[0];
        mainWindow.webContents.send('system:metrics', {
            cpu: Number(currentLoad.currentLoad.toFixed(1)),
            memory: {
                usedGb: Number((mem.used / 1024 / 1024 / 1024).toFixed(2)),
                totalGb: Number((mem.total / 1024 / 1024 / 1024).toFixed(2)),
                percent: Number(((mem.used / mem.total) * 100).toFixed(1)),
            },
            network: {
                upload: nic ? nic.tx_sec : 0,
                download: nic ? nic.rx_sec : 0,
            },
            disk: {
                upload: disk.wIO_sec,
                download: disk.rIO_sec,
            },
            gpu: gpuController
                ? {
                    available: true,
                    name: gpuController.model,
                    memoryUsedGb: Number(((gpuController.memoryUsed || 0) / 1024).toFixed(2)),
                    memoryTotalGb: Number(((gpuController.memoryTotal || 0) / 1024).toFixed(2)),
                    memoryPercent: gpuController.memoryTotal
                        ? Number((((gpuController.memoryUsed || 0) / gpuController.memoryTotal) * 100).toFixed(1))
                        : 0,
                    load: Number((gpuController.utilizationGpu || 0).toFixed(1)),
                }
                : { available: false },
        });
    }, 1000);
}
function toSftpPath(input) {
    if (!input) {
        return '.';
    }
    return input.replace(/\\/g, '/');
}
async function getOrCreateSftp(sessionId, session) {
    const existing = sftpMap.get(sessionId);
    if (existing) {
        return existing;
    }
    const client = new SftpClient();
    await client.connect({
        host: session.host,
        port: session.port,
        username: session.username,
        password: session.password,
        readyTimeout: 20000,
    });
    sftpMap.set(sessionId, client);
    return client;
}
async function loadSession(sessionId) {
    const session = await get('SELECT * FROM session WHERE id = ?', [sessionId]);
    if (!session) {
        throw new Error('会话不存在');
    }
    return session;
}
async function registerIpc() {
    ipcMain.handle('settings:get', async () => readSettings());
    ipcMain.handle('settings:update', async (_, partial) => {
        const merged = {
            ...readSettings(),
            ...partial,
            theme: { ...readSettings().theme, ...(partial.theme || {}) },
            behavior: { ...readSettings().behavior, ...(partial.behavior || {}) },
            ui: { ...readSettings().ui, ...(partial.ui || {}) },
        };
        saveSettings(merged);
        return merged;
    });
    ipcMain.handle('window:minimize', () => mainWindow?.minimize());
    ipcMain.handle('window:close', () => mainWindow?.close());
    ipcMain.handle('folder:list', async () => all('SELECT * FROM session_folder ORDER BY id ASC'));
    ipcMain.handle('folder:create', async (_, payload) => {
        await run('INSERT INTO session_folder(name, parent_id) VALUES(?, ?)', [payload.name, payload.parentId]);
        return true;
    });
    ipcMain.handle('session:list', async () => all('SELECT * FROM session ORDER BY id ASC'));
    ipcMain.handle('session:create', async (_, payload) => {
        await run(INSERT, INTO, session(folder_id, name, host, port, username, password, remember_password, default_session), VALUES(), [
            payload.folder_id,
            payload.name,
            payload.host,
            payload.port,
            payload.username,
            payload.password,
            payload.remember_password,
            payload.default_session,
        ]);
        return true;
    });
    ipcMain.handle('session:update', async (_, payload) => {
        await run(UPDATE, session, SET, folder_id =  ?  : , name =  ?  : , host =  ?  : , port =  ?  : , username =  ?  : , password =  ?  : , remember_password =  ?  : , default_session =  ?
            WHERE : , id =  ?  : , [
            payload.folder_id,
            payload.name,
            payload.host,
            payload.port,
            payload.username,
            payload.password,
            payload.remember_password,
            payload.default_session,
            payload.id,
        ]);
        return true;
    });
    ipcMain.handle('session:delete', async (_, sessionId) => {
        await run('DELETE FROM session WHERE id = ?', [sessionId]);
        return true;
    });
    ipcMain.handle('ssh:connect', async (_, sessionId) => {
        const session = await loadSession(sessionId);
        const old = sshStateMap.get(sessionId);
        old?.client.end();
        return new Promise((resolve, reject) => {
            const client = new Client();
            client
                .on('ready', () => {
                client.shell({ term: 'xterm-256color' }, (err, stream) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    sshStateMap.set(sessionId, { client, shell: stream });
                    stream.on('data', (data) => {
                        mainWindow?.webContents.send('ssh:data', { sessionId, data: data.toString('utf8') });
                    });
                    stream.on('close', () => {
                        mainWindow?.webContents.send('ssh:closed', { sessionId });
                    });
                    resolve(true);
                });
            })
                .on('error', (err) => {
                reject(err);
            })
                .connect({
                host: session.host,
                port: session.port,
                username: session.username,
                password: session.password,
                keepaliveInterval: 10000,
            });
        });
    });
    ipcMain.handle('ssh:send', async (_, payload) => {
        const entry = sshStateMap.get(payload.sessionId);
        if (!entry?.shell) {
            throw new Error('SSH 未连接');
        }
        entry.shell.write(payload.input);
        return true;
    });
    ipcMain.handle('ssh:disconnect', async (_, sessionId) => {
        sshStateMap.get(sessionId)?.client.end();
        sshStateMap.delete(sessionId);
        const sftp = sftpMap.get(sessionId);
        if (sftp) {
            await sftp.end();
            sftpMap.delete(sessionId);
        }
        return true;
    });
    ipcMain.handle('ssh:get-cwd', async (_, sessionId) => {
        const entry = sshStateMap.get(sessionId);
        if (!entry) {
            return '/';
        }
        return new Promise((resolve) => {
            entry.client.exec('pwd', (err, stream) => {
                if (err) {
                    resolve('/');
                    return;
                }
                let output = '';
                stream.on('data', (chunk) => {
                    output += chunk.toString('utf8');
                });
                stream.on('close', () => {
                    resolve(output.trim() || '/');
                });
            });
        });
    });
    ipcMain.handle('sftp:list', async (_, payload) => {
        const session = await loadSession(payload.sessionId);
        const client = await getOrCreateSftp(payload.sessionId, session);
        const list = await client.list(toSftpPath(payload.path));
        return list.filter((item) => payload.showHidden || !item.name.startsWith('.'));
    });
    ipcMain.handle('sftp:mkdir', async (_, payload) => {
        const session = await loadSession(payload.sessionId);
        const client = await getOrCreateSftp(payload.sessionId, session);
        await client.mkdir(toSftpPath(payload.path), true);
        return true;
    });
    ipcMain.handle('sftp:rename', async (_, payload) => {
        const session = await loadSession(payload.sessionId);
        const client = await getOrCreateSftp(payload.sessionId, session);
        await client.rename(toSftpPath(payload.from), toSftpPath(payload.to));
        return true;
    });
    ipcMain.handle('sftp:delete', async (_, payload) => {
        const session = await loadSession(payload.sessionId);
        const client = await getOrCreateSftp(payload.sessionId, session);
        if (payload.isDir) {
            await client.rmdir(toSftpPath(payload.path), true);
        }
        else {
            await client.delete(toSftpPath(payload.path));
        }
        return true;
    });
    ipcMain.handle('sftp:upload', async (_, payload) => {
        const pick = await dialog.showOpenDialog({ properties: ['openFile'] });
        if (pick.canceled || pick.filePaths.length === 0) {
            return false;
        }
        const localFile = pick.filePaths[0];
        const baseName = path.basename(localFile);
        const remotePath = $, { toSftpPath };
        (payload.remoteDir).replace(/\/$/, '');
    }, /);
    const session = await loadSession(payload.sessionId);
    const client = await getOrCreateSftp(payload.sessionId, session);
    await client.fastPut(localFile, remotePath);
    return true;
}
;
ipcMain.handle('sftp:download', async (_, payload) => {
    const fileName = path.basename(payload.remotePath);
    const pick = await dialog.showSaveDialog({ defaultPath: fileName });
    if (pick.canceled || !pick.filePath) {
        return false;
    }
    const session = await loadSession(payload.sessionId);
    const client = await getOrCreateSftp(payload.sessionId, session);
    await client.fastGet(toSftpPath(payload.remotePath), pick.filePath);
    shell.showItemInFolder(pick.filePath);
    return true;
});
ipcMain.handle('app:runtime-paths', async () => ({ runtimeDir, configPath, dbPath, os: os.platform() }));
app.whenReady().then(async () => {
    await initStorage();
    await registerIpc();
    createWindow();
    watchSettings();
    subscribeMetrics();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('before-quit', async () => {
    settingsWatcher?.close();
    if (metricsTimer) {
        clearInterval(metricsTimer);
    }
    for (const [, ssh] of sshStateMap) {
        ssh.client.end();
    }
    sshStateMap.clear();
    for (const [, sftp] of sftpMap) {
        await sftp.end();
    }
    sftpMap.clear();
    db.close();
});
