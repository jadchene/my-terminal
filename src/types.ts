export type Settings = {
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

export type Folder = {
  id: number;
  parent_id: number | null;
  name: string;
};

export type Session = {
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

export type Metrics = {
  cpu: number;
  cpuCores: number;
  cpuMhz: number;
  memory: {
    usedGb: number;
    totalGb: number;
    percent: number;
  };
  network: {
    upload: number;
    download: number;
  };
  disk: {
    upload: number;
    download: number;
  };
  gpu:
    | {
        available: false;
        items: [];
      }
    | {
        available: true;
        items: Array<{
          index: number;
          name: string;
          memoryUsedGb: number;
          memoryTotalGb: number;
          memoryPercent: number;
          load: number;
        }>;
      };
};

export type SftpItem = {
  type: string;
  name: string;
  size: number;
  modifyTime: number;
  accessTime?: number;
  rights?: {
    user: string;
    group: string;
    other: string;
  };
  owner?: number;
  group?: number;
  longname?: string;
};

export type SftpTransferProgress = {
  sessionId: number;
  batchId: string;
  direction: 'upload' | 'download';
  index: number;
  totalCount: number;
  name: string;
  transferred: number;
  total: number;
};

export type SftpTransferBatchResult = {
  sessionId: number;
  batchId: string;
  direction: 'upload' | 'download';
  totalCount: number;
  successCount: number;
  failedCount: number;
  cancelled?: boolean;
};

export type SftpTransferError = {
  sessionId: number;
  batchId: string;
  direction: 'upload' | 'download';
  name: string;
  error: string;
};

declare global {
  interface Window {
    terminalApi: {
      getSettings: () => Promise<Settings>;
      updateSettings: (payload: Partial<Settings>) => Promise<Settings>;
      onSettingsChanged: (cb: (settings: Settings) => void) => () => void;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<boolean>;
      isMaximizedWindow: () => Promise<boolean>;
      closeWindow: () => Promise<void>;
      onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void;
      setMetricsSession: (sessionId: number | null) => Promise<boolean>;

      listFolders: () => Promise<Folder[]>;
      createFolder: (payload: { name: string; parentId: number | null }) => Promise<boolean>;
      updateFolder: (payload: { id: number; name: string }) => Promise<boolean>;
      deleteFolder: (folderId: number) => Promise<boolean>;

      listSessions: () => Promise<Session[]>;
      createSession: (payload: Omit<Session, 'id'>) => Promise<boolean>;
      updateSession: (payload: Session) => Promise<boolean>;
      deleteSession: (sessionId: number) => Promise<boolean>;

      sshConnect: (payload: { sessionId: number; connectionId?: number; password?: string; savePassword?: boolean } | number) => Promise<boolean>;
      sshSend: (payload: { sessionId: number; input: string }) => Promise<boolean>;
      sshResize: (payload: { sessionId: number; cols: number; rows: number }) => Promise<boolean>;
      sshDisconnect: (sessionId: number) => Promise<boolean>;
      sshGetCwd: (sessionId: number) => Promise<string>;
      onSshData: (cb: (event: { sessionId: number; data: string }) => void) => () => void;
      onSshClosed: (cb: (event: { sessionId: number }) => void) => () => void;

      sftpList: (payload: { sessionId: number; path: string; showHidden: boolean }) => Promise<SftpItem[]>;
      sftpGetHome: (sessionId: number) => Promise<string>;
      sftpMkdir: (payload: { sessionId: number; path: string }) => Promise<boolean>;
      sftpRename: (payload: { sessionId: number; from: string; to: string }) => Promise<boolean>;
      sftpDelete: (payload: { sessionId: number; path: string; isDir: boolean }) => Promise<boolean>;
      sftpUpload: (payload: { sessionId: number; remoteDir: string }) => Promise<boolean>;
      sftpDownload: (payload: { sessionId: number; remotePath: string }) => Promise<boolean>;
      sftpUploadBatch: (payload: { sessionId: number; remoteDir: string; localPaths?: string[] }) => Promise<boolean>;
      sftpDownloadBatch: (payload: { sessionId: number; remotePaths: string[]; localDir?: string }) => Promise<boolean>;
      sftpCancelBatch: (payload: { sessionId: number; batchId: string }) => Promise<boolean>;
      onSftpProgress: (cb: (event: SftpTransferProgress) => void) => () => void;
      onSftpBatchComplete: (cb: (event: SftpTransferBatchResult) => void) => () => void;
      onSftpBatchError: (cb: (event: SftpTransferError) => void) => () => void;

      onMetrics: (cb: (metrics: Metrics) => void) => () => void;
      getPathForDroppedFile: (file: File) => string;
      pickDirectory: (defaultPath?: string) => Promise<string | null>;
      getRuntimePaths: () => Promise<{ runtimeDir: string; userDataPath: string; settingsStorage: string; dbPath: string; os: string }>;
    };
  }
}

export {};
