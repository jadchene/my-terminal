const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('terminalApi', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
  onSettingsChanged: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.off('settings:changed', handler);
  },

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximizedWindow: () => ipcRenderer.invoke('window:is-maximized'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaximizedChanged: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.off('window:maximized-changed', handler);
  },
  setMetricsSession: (sessionId) => ipcRenderer.invoke('metrics:set-session', sessionId),

  listFolders: () => ipcRenderer.invoke('folder:list'),
  createFolder: (payload) => ipcRenderer.invoke('folder:create', payload),
  updateFolder: (payload) => ipcRenderer.invoke('folder:update', payload),
  deleteFolder: (folderId) => ipcRenderer.invoke('folder:delete', folderId),

  listSessions: () => ipcRenderer.invoke('session:list'),
  createSession: (payload) => ipcRenderer.invoke('session:create', payload),
  updateSession: (payload) => ipcRenderer.invoke('session:update', payload),
  deleteSession: (sessionId) => ipcRenderer.invoke('session:delete', sessionId),

  sshConnect: (payload) => ipcRenderer.invoke('ssh:connect', payload),
  sshSend: (payload) => ipcRenderer.invoke('ssh:send', payload),
  sshResize: (payload) => ipcRenderer.invoke('ssh:resize', payload),
  sshDisconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId),
  sshGetCwd: (sessionId) => ipcRenderer.invoke('ssh:get-cwd', sessionId),
  onSshData: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ssh:data', handler);
    return () => ipcRenderer.off('ssh:data', handler);
  },
  onSshClosed: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ssh:closed', handler);
    return () => ipcRenderer.off('ssh:closed', handler);
  },

  sftpList: (payload) => ipcRenderer.invoke('sftp:list', payload),
  sftpGetHome: (sessionId) => ipcRenderer.invoke('sftp:home', sessionId),
  sftpMkdir: (payload) => ipcRenderer.invoke('sftp:mkdir', payload),
  sftpRename: (payload) => ipcRenderer.invoke('sftp:rename', payload),
  sftpDelete: (payload) => ipcRenderer.invoke('sftp:delete', payload),
  sftpUpload: (payload) => ipcRenderer.invoke('sftp:upload', payload),
  sftpDownload: (payload) => ipcRenderer.invoke('sftp:download', payload),
  sftpUploadBatch: (payload) => ipcRenderer.invoke('sftp:upload-batch', payload),
  sftpDownloadBatch: (payload) => ipcRenderer.invoke('sftp:download-batch', payload),
  sftpCancelBatch: (payload) => ipcRenderer.invoke('sftp:cancel-batch', payload),
  onSftpProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('sftp:progress', handler);
    return () => ipcRenderer.off('sftp:progress', handler);
  },
  onSftpBatchComplete: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('sftp:batch-complete', handler);
    return () => ipcRenderer.off('sftp:batch-complete', handler);
  },
  onSftpBatchError: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('sftp:batch-error', handler);
    return () => ipcRenderer.off('sftp:batch-error', handler);
  },

  onMetrics: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('system:metrics', handler);
    return () => ipcRenderer.off('system:metrics', handler);
  },

  getPathForDroppedFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  pickDirectory: (defaultPath) => ipcRenderer.invoke('dialog:pick-directory', defaultPath),
  getRuntimePaths: () => ipcRenderer.invoke('app:runtime-paths'),
});
