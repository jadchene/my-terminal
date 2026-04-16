import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import {
  Activity,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Menu,
  Minus,
  PanelLeftClose,
  RefreshCw,
  Square,
  TerminalSquare,
  Upload,
  X,
} from 'lucide-react';
import 'xterm/css/xterm.css';
import type {
  Folder,
  Metrics,
  Session,
  Settings,
  SftpItem,
  SftpTransferBatchResult,
  SftpTransferError,
  SftpTransferProgress,
} from './types';

type SessionForm = Omit<Session, 'id'>;
type Tab = { id: number; sessionId: number; title: string };
type TreeContextMenu =
  | { x: number; y: number; type: 'session'; id: number; name: string }
  | { x: number; y: number; type: 'folder'; id: number; name: string }
  | { x: number; y: number; type: 'sftp'; sessionId: number; path: string; name: string; isDir: boolean };
type DialogType = 'alert' | 'confirm' | 'prompt';
type DialogState = {
  type: DialogType;
  title: string;
  message: string;
  defaultValue?: string;
  inputType?: 'text' | 'password';
};

const defaultSessionForm: SessionForm = {
  folder_id: null,
  name: '',
  host: '',
  port: 22,
  username: '',
  password: '',
  remember_password: 1,
  default_session: 0,
};

function formatSpeed(value: number): string {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB/s`;
  if (value > 1024) return `${(value / 1024).toFixed(2)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

type TransferRow = {
  key: string;
  batchId: string;
  sessionId: number;
  direction: 'upload' | 'download';
  index: number;
  totalCount: number;
  name: string;
  percent: number;
  transferred: number;
  total: number;
  status: 'running' | 'done' | 'error';
};

function formatSftpMeta(item: SftpItem) {
  const rights = item.rights ? `${item.rights.user}${item.rights.group}${item.rights.other}` : '-';
  const timeText = item.modifyTime ? new Date(item.modifyTime).toLocaleString() : '-';
  return `权限: ${rights}\n大小: ${formatBytes(item.size || 0)}\n时间: ${timeText}`;
}

function getParentSftpPath(current: string): string {
  const value = (current || '').trim();
  if (!value || value === '/' || value === '~') return value || '~';
  if (value.endsWith('/..')) return value;
  const normalized = value.replace(/\/+$/, '');
  if (!normalized || normalized === '/') return '/';
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '/';
  return normalized.slice(0, index) || '/';
}

function stripInternalProbeOutput(data: string): string {
  if (!data.includes('__CODEX_CWD_BEGIN_') && !data.includes('__CODEX_CWD_END_')) return data;
  const lines = data.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (line.includes('__CODEX_CWD_BEGIN_') || line.includes('__CODEX_CWD_END_')) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

function isAuthError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('all configured authentication methods failed') ||
    text.includes('authentication failure') ||
    text.includes('permission denied') ||
    text.includes('auth fail')
  );
}

export default function App() {
  const clampSidebarWidth = (value: number) => Math.max(220, Math.min(520, Math.round(value)));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsBySession, setMetricsBySession] = useState<Record<number, Metrics>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'behavior' | 'system'>('appearance');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const [showSessionModal, setShowSessionModal] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [sessionForm, setSessionForm] = useState<SessionForm>(defaultSessionForm);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderParent, setFolderParent] = useState<number | null>(null);
  const [showSessionPassword, setShowSessionPassword] = useState(false);
  const [showDialogPassword, setShowDialogPassword] = useState(false);
  const [sessionFolderMenuOpen, setSessionFolderMenuOpen] = useState(false);

  const [sftpPath, setSftpPath] = useState('~');
  const [sftpPathInput, setSftpPathInput] = useState('~');
  const [sftpItems, setSftpItems] = useState<SftpItem[]>([]);
  const [selectedSftpPaths, setSelectedSftpPaths] = useState<string[]>([]);
  const [sftpUploadDropOver, setSftpUploadDropOver] = useState(false);
  const [sftpDownloadDropOver, setSftpDownloadDropOver] = useState(false);
  const [transferRows, setTransferRows] = useState<TransferRow[]>([]);
  const [runtimeInfo, setRuntimeInfo] = useState<{
    runtimeDir: string;
    userDataPath: string;
    configPath: string;
    dbPath: string;
    os: string;
  } | null>(null);
  const [pausedOutput, setPausedOutput] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'sftp' | 'status'>('sessions');
  const [treeMenu, setTreeMenu] = useState<TreeContextMenu | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogInput, setDialogInput] = useState('');
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<number>>(new Set());

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalMapRef = useRef<Map<number, Terminal>>(new Map());
  const fitMapRef = useRef<Map<number, FitAddon>>(new Map());
  const pausedByScrollRef = useRef<Map<number, boolean>>(new Map());
  const pendingOutputRef = useRef<Map<number, string>>(new Map());
  const dialogResolverRef = useRef<((value: any) => void) | null>(null);
  const sidebarWidthRef = useRef(300);
  const sidebarResizingRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sessionFolderMenuRef = useRef<HTMLDivElement>(null);
  const sftpInternalDragRef = useRef(false);

  const nextTabIdRef = useRef(1);
  const activeTab = useMemo(
    () => tabs.find((it) => it.id === activeSessionId) || null,
    [tabs, activeSessionId],
  );
  const activeSession = useMemo(
    () => sessions.find((it) => it.id === activeTab?.sessionId) || null,
    [sessions, activeTab],
  );

  const openDialog = <T,>(next: DialogState): Promise<T> =>
    new Promise<T>((resolve) => {
      dialogResolverRef.current = resolve;
      setDialogInput(next.defaultValue || '');
      setShowDialogPassword(false);
      setDialog(next);
    });

  const closeDialog = (value: any) => {
    const resolver = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    setCapsLockOn(false);
    setShowDialogPassword(false);
    if (resolver) resolver(value);
  };

  const askConfirm = async (message: string, title = '确认'): Promise<boolean> =>
    openDialog<boolean>({ type: 'confirm', title, message });

  const askPrompt = async (message: string, defaultValue = '', title = '输入'): Promise<string | null> =>
    openDialog<string | null>({ type: 'prompt', title, message, defaultValue, inputType: 'text' });

  const askPassword = async (message: string, title = '输入密码'): Promise<string | null> =>
    openDialog<string | null>({ type: 'prompt', title, message, defaultValue: '', inputType: 'password' });

  const showAlert = async (message: string, title = '提示'): Promise<void> => {
    await openDialog<void>({ type: 'alert', title, message });
  };

  const isAtBottom = (term: Terminal): boolean =>
    term.buffer.active.viewportY >= term.buffer.active.baseY - 1;

  const appendPendingOutput = (sessionId: number, data: string) => {
    const old = pendingOutputRef.current.get(sessionId) || '';
    pendingOutputRef.current.set(sessionId, old + data);
  };

  const flushPendingOutput = (sessionId: number, term?: Terminal) => {
    const target = term ?? terminalMapRef.current.get(sessionId);
    if (!target) return;
    const pending = pendingOutputRef.current.get(sessionId);
    if (!pending) return;
    pendingOutputRef.current.delete(sessionId);
    target.write(pending);
  };

  const setPausedByScroll = (sessionId: number, paused: boolean, term?: Terminal) => {
    pausedByScrollRef.current.set(sessionId, paused);
    if (activeSessionId === sessionId) {
      setPausedOutput(paused);
    }
    if (!paused) {
      flushPendingOutput(sessionId, term);
    }
  };

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!settings) return;
    const next = clampSidebarWidth(settings.ui.sidebarWidth || 300);
    setSidebarWidth(next);
  }, [settings?.ui.sidebarWidth]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const dragging = sidebarResizingRef.current;
      if (!dragging) return;
      const deltaX = event.clientX - dragging.startX;
      const next = clampSidebarWidth(dragging.startWidth + deltaX);
      setSidebarWidth(next);
      if (activeSessionId) {
        fitTerminal(activeSessionId);
      }
    };
    const onMouseUp = () => {
      if (!sidebarResizingRef.current) return;
      sidebarResizingRef.current = null;
      if (!settings) return;
      const finalWidth = clampSidebarWidth(sidebarWidthRef.current);
      if (finalWidth === settings.ui.sidebarWidth) return;
      window.terminalApi
        .updateSettings({
          ui: { ...settings.ui, sidebarWidth: finalWidth },
        })
        .then((saved) => setSettings(saved))
        .catch(() => null);
      if (activeSessionId) {
        fitTerminalStabilized(activeSessionId);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [activeSessionId, settings]);

  const startSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!settings?.ui.sidebarVisible) return;
    sidebarResizingRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidthRef.current,
    };
    event.preventDefault();
  };

  const loadSessionData = async () => {
    const [folderResult, sessionResult] = await Promise.all([
      window.terminalApi.listFolders(),
      window.terminalApi.listSessions(),
    ]);
    setFolders(folderResult);
    setSessions(sessionResult);
  };

  const refreshSftp = async (pathInput?: string) => {
    if (!activeSessionId || !settings) return;
    const target = pathInput ?? sftpPath;
    const list = await window.terminalApi.sftpList({
      sessionId: activeSessionId,
      path: target,
      showHidden: settings.ui.showHiddenFiles,
    });
    setSftpItems(list);
    setSelectedSftpPaths((prev) => prev.filter((it) => list.some((item) => `${target.replace(/\/$/, '')}/${item.name}` === it)));
  };

  const setSftpSelection = (fullPath: string, checked: boolean) => {
    setSelectedSftpPaths((prev) => {
      if (checked) return prev.includes(fullPath) ? prev : [...prev, fullPath];
      return prev.filter((it) => it !== fullPath);
    });
  };

  const navigateSftp = async (nextPath: string) => {
    setSftpPath(nextPath);
    await refreshSftp(nextPath);
  };

  const getLocalPathsFromDrop = (event: React.DragEvent): string[] => {
    const files = Array.from(event.dataTransfer.files || []);
    const fromFiles = files
      .map((file: any) => {
        const directPath = String(file?.path || '');
        if (directPath) return directPath;
        try {
          return String(window.terminalApi.getPathForDroppedFile(file as File) || '');
        } catch {
          return '';
        }
      })
      .filter((it) => !!it);
    const fromUriList = (event.dataTransfer.getData('text/uri-list') || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => !!line && !line.startsWith('#'))
      .map((line) => {
        if (!line.toLowerCase().startsWith('file://')) return '';
        try {
          const decoded = decodeURIComponent(line.replace(/^file:\/\//i, ''));
          if (/^\/[a-zA-Z]:\//.test(decoded)) return decoded.slice(1).replace(/\//g, '\\');
          return decoded.replace(/\//g, '\\');
        } catch {
          return '';
        }
      })
      .filter((it) => !!it);
    const fromPlainText = (event.dataTransfer.getData('text/plain') || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-zA-Z]:\\/.test(line) || /^\\\\/.test(line));
    return Array.from(new Set([...fromFiles, ...fromUriList, ...fromPlainText]));
  };

  const getSftpPathsFromDrag = (event: React.DragEvent): string[] => {
    const raw = event.dataTransfer.getData('application/x-sftp-paths');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((it) => String(it || '')).filter((it) => !!it);
    } catch {
      return [];
    }
  };

  const submitSftpPath = async () => {
    if (!activeSessionId) return;
    const nextPath = sftpPathInput.trim();
    if (!nextPath) {
      setSftpPathInput(sftpPath);
      return;
    }
    try {
      await navigateSftp(nextPath);
    } catch (error) {
      setSftpPathInput(sftpPath);
      await showAlert(`路径跳转失败: ${String(error)}`, 'SFTP');
    }
  };

  const updateTransferRow = (event: SftpTransferProgress) => {
    const key = `session-${event.sessionId}`;
    const percent = event.total > 0 ? Math.min(100, Number(((event.transferred / event.total) * 100).toFixed(1))) : 0;
    setTransferRows((prev) => {
      const found = prev.find((it) => it.key === key);
      if (found) {
        return prev.map((it) =>
          it.key === key
            ? {
                ...it,
                batchId: event.batchId,
                name: event.name,
                index: event.index,
                totalCount: event.totalCount,
                percent,
                transferred: event.transferred,
                total: event.total,
                status: percent >= 100 ? 'done' : it.status,
              }
            : it,
        );
      }
      return [
        {
          key,
          batchId: event.batchId,
          sessionId: event.sessionId,
          direction: event.direction,
          index: event.index,
          totalCount: event.totalCount,
          name: event.name,
          percent,
          transferred: event.transferred,
          total: event.total,
          status: percent >= 100 ? 'done' : 'running',
        },
        ...prev,
      ].slice(0, 12);
    });
  };

  const markTransferBatchComplete = (event: SftpTransferBatchResult) => {
    setTransferRows((prev) =>
      prev.filter((it) => !(it.sessionId === event.sessionId && it.batchId === event.batchId)),
    );
  };

  const markTransferError = (event: SftpTransferError) => {
    setTransferRows((prev) =>
      prev.map((it) =>
        it.sessionId === event.sessionId && it.batchId === event.batchId ? { ...it, status: 'error' } : it,
      ),
    );
  };

  const attachTerminal = (sessionId: number, localSettings: Settings) => {
    if (!terminalContainerRef.current) return;
    let term = terminalMapRef.current.get(sessionId);
    let fit = fitMapRef.current.get(sessionId);

    if (!term) {
      term = new Terminal({
        cursorBlink: true,
        fontFamily: localSettings.theme.terminalFontFamily || 'Consolas',
        fontSize: localSettings.theme.terminalFontSize || 16,
        fontWeight: 'bold',
        theme: {
          background: localSettings.theme.backgroundColor,
          foreground: localSettings.theme.foregroundColor,
        },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.onData(async (input) => {
        const paused = pausedByScrollRef.current.get(sessionId) || false;
        if (paused && (input === '\r' || input === '\n')) {
          term.scrollToBottom();
          setPausedByScroll(sessionId, false, term);
          return;
        }
        await window.terminalApi.sshSend({ sessionId, input });
      });
      term.onResize(({ cols, rows }) => {
        window.terminalApi.sshResize({ sessionId, cols, rows }).catch(() => null);
      });
      term.onSelectionChange(async () => {
        if (!localSettings.behavior.autoCopySelection) return;
        const selected = term?.getSelection();
        if (!selected) return;
        await navigator.clipboard.writeText(selected);
      });
      term.onScroll(() => {
        const paused = !isAtBottom(term);
        const current = pausedByScrollRef.current.get(sessionId) || false;
        if (paused !== current) {
          setPausedByScroll(sessionId, paused, term);
        }
      });
      terminalMapRef.current.set(sessionId, term);
      fitMapRef.current.set(sessionId, fit);
      pausedByScrollRef.current.set(sessionId, false);
    }

    term.options.fontFamily = localSettings.theme.terminalFontFamily || 'Consolas';
    term.options.fontSize = localSettings.theme.terminalFontSize || 16;
    term.options.fontWeight = 'bold';
    term.options.theme = {
      background: localSettings.theme.backgroundColor,
      foreground: localSettings.theme.foregroundColor,
    };

    terminalContainerRef.current.innerHTML = '';
    term.open(terminalContainerRef.current);
    fitTerminalStabilized(sessionId);
    const paused = !isAtBottom(term);
    setPausedByScroll(sessionId, paused, term);
  };

  const fitTerminal = (sessionId: number) => {
    const fit = fitMapRef.current.get(sessionId);
    if (fit) fit.fit();
  };

  const fitTerminalStabilized = (sessionId: number) => {
    fitTerminal(sessionId);
    requestAnimationFrame(() => fitTerminal(sessionId));
    setTimeout(() => fitTerminal(sessionId), 80);
    setTimeout(() => fitTerminal(sessionId), 220);
  };

  const connectSession = async (session: Session, forceNew = false) => {
    if (!forceNew) {
      const existing = tabs.find((it) => it.sessionId === session.id);
      if (existing) {
        setActiveSessionId(existing.id);
        return;
      }
    }
    const tabId = Date.now() + nextTabIdRef.current;
    nextTabIdRef.current += 1;
    setTabs((prev) => [...prev, { id: tabId, sessionId: session.id, title: session.name }]);
    try {
      await window.terminalApi.sshConnect({ sessionId: session.id, connectionId: tabId });
      if (settings) attachTerminal(tabId, settings);
      setActiveSessionId(tabId);
    } catch (error) {
      const message = String(error);
      if (!isAuthError(message)) {
        setTabs((prev) => prev.filter((it) => it.id !== tabId));
        if (activeSessionId === tabId) setActiveSessionId(null);
        await showAlert(message, '连接失败');
        return;
      }
      const retryPassword = await askPassword(`会话 ${session.name} 认证失败，请输入密码重试`);
      if (!retryPassword) {
        setTabs((prev) => prev.filter((it) => it.id !== tabId));
        if (activeSessionId === tabId) setActiveSessionId(null);
        await showAlert(message, '连接失败');
        return;
      }
      try {
        await window.terminalApi.sshConnect({
          sessionId: session.id,
          connectionId: tabId,
          password: retryPassword,
          savePassword: true,
        });
        await window.terminalApi.updateSession({
          ...session,
          password: retryPassword,
          remember_password: 1,
        });
        setSessions((prev) =>
          prev.map((it) => (it.id === session.id ? { ...it, password: retryPassword, remember_password: 1 } : it)),
        );
        if (settings) attachTerminal(tabId, settings);
        setActiveSessionId(tabId);
      } catch (retryError) {
        setTabs((prev) => prev.filter((it) => it.id !== tabId));
        if (activeSessionId === tabId) setActiveSessionId(null);
        await showAlert(String(retryError), '连接失败');
      }
    }
  };

  const closeTab = async (tabId: number) => {
    await window.terminalApi.sshDisconnect(tabId).catch(() => null);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeSessionId === tabId) {
        setActiveSessionId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
    setMetricsBySession((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  };

  const openSessionModal = (target?: Session) => {
    if (target) {
      setEditingSession(target);
      setSessionForm({
        folder_id: target.folder_id,
        name: target.name,
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password,
        remember_password: target.remember_password,
        default_session: target.default_session,
      });
    } else {
      setEditingSession(null);
      setSessionForm(defaultSessionForm);
    }
    setShowSessionPassword(false);
    setSessionFolderMenuOpen(false);
    setShowSessionModal(true);
  };

  const getFolderLabel = (folderId: number | null) => {
    if (!folderId) return '根目录';
    const matched = folders.find((folder) => folder.id === folderId);
    return matched?.name || '根目录';
  };

  useEffect(() => {
    (async () => {
      const [initSettings, runtime] = await Promise.all([
        window.terminalApi.getSettings(),
        window.terminalApi.getRuntimePaths(),
      ]);
      setSettings(initSettings);
      setRuntimeInfo(runtime);
      await loadSessionData();
    })();

    const unSettings = window.terminalApi.onSettingsChanged(setSettings);
    const unMaximize = window.terminalApi.onMaximizedChanged((v) => setIsMaximized(v));
    const unData = window.terminalApi.onSshData(({ sessionId, data }) => {
      const cleanData = stripInternalProbeOutput(data);
      if (!cleanData) return;
      if (
        activeSessionId === sessionId &&
        (cleanData.includes('\u001b[?1049h') ||
          cleanData.includes('\u001b[?1047h') ||
          cleanData.includes('\u001b[?47h') ||
          cleanData.includes('\u001b[?1049l') ||
          cleanData.includes('\u001b[?1047l') ||
          cleanData.includes('\u001b[?47l'))
      ) {
        fitTerminalStabilized(sessionId);
      }
      const term = terminalMapRef.current.get(sessionId);
      if (!term) {
        appendPendingOutput(sessionId, cleanData);
        return;
      }
      const pausedFlag = pausedByScrollRef.current.get(sessionId) || false;
      if (pausedFlag) {
        appendPendingOutput(sessionId, cleanData);
        return;
      }
      term.write(cleanData);
    });
    const unClosed = window.terminalApi.onSshClosed(({ sessionId }) => {
      const term = terminalMapRef.current.get(sessionId);
      term?.writeln('\r\n[连接已关闭]');
    });
    const unMetrics = window.terminalApi.onMetrics((payload) => {
      setMetrics(payload);
      if (activeSessionId) {
        setMetricsBySession((prev) => ({ ...prev, [activeSessionId]: payload }));
      }
    });
    const unSftpProgress = window.terminalApi.onSftpProgress(updateTransferRow);
    const unSftpBatchComplete = window.terminalApi.onSftpBatchComplete(markTransferBatchComplete);
    const unSftpBatchError = window.terminalApi.onSftpBatchError(markTransferError);

    return () => {
      unSettings();
      unMaximize();
      unData();
      unClosed();
      unMetrics();
      unSftpProgress();
      unSftpBatchComplete();
      unSftpBatchError();
    };
  }, [activeSessionId]);

  useEffect(() => {
    window.terminalApi.isMaximizedWindow().then((v) => setIsMaximized(v)).catch(() => null);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const defaultOne = sessions.find((it) => it.default_session === 1);
    if (defaultOne && tabs.length === 0) {
      connectSession(defaultOne).catch(() => null);
    }
  }, [settings, sessions, tabs.length]);

  useEffect(() => {
    if (!settings || !activeSessionId) return;
    attachTerminal(activeSessionId, settings);
    const paused = pausedByScrollRef.current.get(activeSessionId) || false;
    setPausedOutput(paused);
    if (!paused) {
      flushPendingOutput(activeSessionId);
    }
    window.terminalApi
      .sftpGetHome(activeSessionId)
      .then(async (home) => {
        const target = home?.trim() || '~';
        setSftpPath(target);
        setSelectedSftpPaths([]);
        await refreshSftp(target);
      })
      .catch(() => refreshSftp('~'));
  }, [
    activeSessionId,
    settings?.theme.backgroundColor,
    settings?.theme.foregroundColor,
  ]);

  useEffect(() => {
    setSftpPathInput(sftpPath);
  }, [sftpPath]);

  useEffect(() => {
    if (!activeSessionId || !terminalContainerRef.current) return;
    const container = terminalContainerRef.current;
    const ro = new ResizeObserver(() => {
      fitTerminalStabilized(activeSessionId);
    });
    ro.observe(container);
    const onResize = () => fitTerminalStabilized(activeSessionId);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [activeSessionId, settings?.ui.sidebarVisible]);

  useEffect(() => {
    if (!settings || !activeSessionId) return;
    refreshSftp().catch(() => null);
  }, [settings?.ui.showHiddenFiles, activeSessionId]);

  useEffect(() => {
    if (!settings || !activeSessionId || sidebarTab !== 'sftp') return;
    refreshSftp().catch(() => null);
  }, [sidebarTab, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      setSftpItems([]);
      setSelectedSftpPaths([]);
      setPausedOutput(false);
      if (terminalContainerRef.current) {
        terminalContainerRef.current.innerHTML = '';
      }
    }
  }, [activeSessionId]);

  useEffect(() => {
    window.terminalApi.setMetricsSession(activeSessionId).catch(() => null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!treeMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.tree-context-menu')) return;
      setTreeMenu(null);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTreeMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [treeMenu]);

  useEffect(() => {
    if (!sessionFolderMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = sessionFolderMenuRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      setSessionFolderMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [sessionFolderMenuOpen]);

  if (!settings) return <div className="loading">加载中...</div>;

  const renderSessionList = (folderId: number | null): JSX.Element[] =>
    sessions.filter((session) => session.folder_id === folderId).map((session) => (
      <div
        key={session.id}
        className="session-node"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTreeMenu({ x: e.clientX, y: e.clientY, type: 'session', id: session.id, name: session.name });
        }}
      >
        <button
          className="link-btn tree-row-btn"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTreeMenu({ x: e.clientX, y: e.clientY, type: 'session', id: session.id, name: session.name });
          }}
          onClick={() => null}
          onDoubleClick={() => connectSession(session, true)}
        >
          {session.name}
        </button>
      </div>
    ));

  const folderTree = (parentId: number | null): JSX.Element[] =>
    folders
      .filter((folder) => folder.parent_id === parentId)
      .map((folder) => (
        <div key={folder.id} className="folder-node">
          <div
            className="folder-title"
            onClick={() => {
              setExpandedFolderIds((prev) => {
                const next = new Set(prev);
                if (next.has(folder.id)) next.delete(folder.id);
                else next.add(folder.id);
                return next;
              });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTreeMenu({ x: e.clientX, y: e.clientY, type: 'folder', id: folder.id, name: folder.name });
            }}
          >
            <span className="folder-toggle-icon" aria-hidden="true">
              {expandedFolderIds.has(folder.id) ? <ChevronDown size={14} strokeWidth={1.8} /> : <ChevronRight size={14} strokeWidth={1.8} />}
            </span>
            {folder.name}
          </div>
          {expandedFolderIds.has(folder.id) && (
            <div className="folder-children">
              {renderSessionList(folder.id)}
              {folderTree(folder.id)}
            </div>
          )}
        </div>
      ));

  const currentMetrics = (activeSessionId ? metricsBySession[activeSessionId] : null) ?? metrics;
  const currentTransferRows = activeSessionId ? transferRows.filter((it) => it.sessionId === activeSessionId) : [];

  return (
    <div
      className="app-shell"
      style={
        {
          '--bg': settings.theme.backgroundColor,
          '--fg': settings.theme.foregroundColor,
          '--sidebar-width': `${sidebarWidth}px`,
          '--ui-font-family': settings.theme.uiFontFamily || 'Microsoft YaHei, Segoe UI, sans-serif',
          '--ui-font-size': `${settings.theme.uiFontSize || 13}px`,
        } as CSSProperties
      }
    >
      <main className={`body-layout ${settings.ui.sidebarVisible ? '' : 'sidebar-hidden'}`}>
        <header className="title-bar">
          <div className="tabs-row">
            {tabs.map((tab) => (
              <div key={tab.id} className={`tab-item ${tab.id === activeSessionId ? 'active' : ''}`}>
                <button className="tab-title-btn" onClick={() => setActiveSessionId(tab.id)}>
                  {tab.title}
                </button>
                <button
                  className="tab-close-btn"
                  title="关闭会话"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id).catch(() => null);
                  }}
                >
                  <X size={14} strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>

          <div className="right-controls">
            <div className="menu-wrap">
              <button className="icon-btn top-icon-btn" onClick={() => setMenuOpen((v) => !v)} title="菜单">
                <Menu size={16} strokeWidth={1.8} />
              </button>
              {menuOpen && (
                <div className="dropdown dropdown-right">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setSettingsDraft({
                        ...settings,
                        theme: { ...settings.theme },
                        behavior: { ...settings.behavior },
                        ui: { ...settings.ui },
                      });
                      setSettingsTab('appearance');
                      setShowSettings(true);
                    }}
                  >
                    设置
                  </button>
                </div>
              )}
            </div>
            <button
              className="icon-btn top-icon-btn"
              title={settings.ui.sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
              onClick={async () => {
                const saved = await window.terminalApi.updateSettings({
                  ui: { ...settings.ui, sidebarVisible: !settings.ui.sidebarVisible },
                });
                setSettings(saved);
              }}
            >
              <PanelLeftClose size={16} strokeWidth={1.8} />
            </button>
            <div className="window-controls">
              <button onClick={() => window.terminalApi.minimizeWindow()} title="最小化">
                <Minus size={14} strokeWidth={1.8} />
              </button>
              <button onClick={() => window.terminalApi.toggleMaximizeWindow()} title={isMaximized ? '还原' : '最大化'}>
                {isMaximized ? <Copy size={14} strokeWidth={1.8} /> : <Square size={14} strokeWidth={1.8} />}
              </button>
              <button onClick={() => window.terminalApi.closeWindow()} title="关闭">
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </header>
        {settings.ui.sidebarVisible && (
          <aside className="sidebar">
            <div className="sidebar-tabs">
              <button
                className={`icon-btn top-icon-btn ${sidebarTab === 'sessions' ? 'active-tab-icon' : ''}`}
                title="会话树"
                onClick={() => setSidebarTab('sessions')}
              >
                <FolderTree size={16} strokeWidth={1.8} />
              </button>
              <button
                className={`icon-btn top-icon-btn ${sidebarTab === 'sftp' ? 'active-tab-icon' : ''}`}
                title="SFTP"
                onClick={() => setSidebarTab('sftp')}
              >
                <FolderOpen size={16} strokeWidth={1.8} />
              </button>
              <button
                className={`icon-btn top-icon-btn ${sidebarTab === 'status' ? 'active-tab-icon' : ''}`}
                title="状态"
                onClick={() => setSidebarTab('status')}
              >
                <Activity size={16} strokeWidth={1.8} />
              </button>
            </div>
            {sidebarTab === 'sessions' && (
              <div className="tree-content panel-content">
                <div className="sidebar-actions">
                  <button className="icon-btn top-icon-btn" title="新建目录" onClick={() => setShowFolderModal(true)}>
                    <FolderPlus size={16} strokeWidth={1.8} />
                  </button>
                  <button className="icon-btn top-icon-btn" title="新建会话" onClick={() => openSessionModal()}>
                    <TerminalSquare size={16} strokeWidth={1.8} />
                  </button>
                </div>
                <div className="tree-scroll">
                  {renderSessionList(null)}
                  {folderTree(null)}
                </div>
              </div>
            )}
            {sidebarTab === 'sftp' && (
              <div
                className={`sftp-sidebar-content panel-content ${activeSessionId ? '' : 'panel-empty-host'} ${
                  sftpUploadDropOver || sftpDownloadDropOver ? 'drop-over' : ''
                }`}
                onDragEnter={(e) => {
                  if (!activeSessionId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setSftpUploadDropOver(true);
                  setSftpDownloadDropOver(false);
                }}
                onDragOver={(e) => {
                  if (!activeSessionId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setSftpUploadDropOver(true);
                  setSftpDownloadDropOver(false);
                }}
                onDragLeave={() => {
                  setSftpUploadDropOver(false);
                  setSftpDownloadDropOver(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setSftpUploadDropOver(false);
                  setSftpDownloadDropOver(false);
                  if (!activeSessionId) return;
                  const localPaths = getLocalPathsFromDrop(e);
                  const sftpPaths = getSftpPathsFromDrag(e);
                  const fromInternalSftp = sftpInternalDragRef.current;
                  sftpInternalDragRef.current = false;
                  if (fromInternalSftp && sftpPaths.length === 0) {
                    return;
                  }
                  if (localPaths.length === 0 && sftpPaths.length === 0) {
                    await showAlert('未识别到可用的拖拽路径，请重试或使用上传按钮。', 'SFTP');
                    return;
                  }
                  if (sftpPaths.length > 0) {
                    await window.terminalApi.sftpDownloadBatch({
                      sessionId: activeSessionId,
                      remotePaths: sftpPaths,
                    });
                    return;
                  }
                  if (fromInternalSftp) {
                    return;
                  }
                  if (localPaths.length > 0) {
                    setSelectedSftpPaths([]);
                    await window.terminalApi.sftpUploadBatch({
                      sessionId: activeSessionId,
                      remoteDir: sftpPath,
                      localPaths,
                    });
                    await refreshSftp();
                    return;
                  }
                }}
              >
                {activeSessionId ? (
                  <>
                    <div className="sidebar-actions">
                      <button
                        className="icon-btn top-icon-btn"
                        title={settings.ui.showHiddenFiles ? '隐藏文件' : '显示隐藏文件'}
                        onClick={async () => {
                          const saved = await window.terminalApi.updateSettings({
                            ui: { ...settings.ui, showHiddenFiles: !settings.ui.showHiddenFiles },
                          });
                          setSettings(saved);
                        }}
                      >
                        {settings.ui.showHiddenFiles ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
                      </button>
                      <button className="icon-btn top-icon-btn" title="刷新" onClick={() => refreshSftp()}>
                        <RefreshCw size={16} strokeWidth={1.8} />
                      </button>
                      <button
                        className="icon-btn top-icon-btn"
                        title="上级目录"
                        onClick={async () => {
                          await navigateSftp(getParentSftpPath(sftpPath));
                        }}
                      >
                        <ArrowUp size={16} strokeWidth={1.8} />
                      </button>
                      <button
                        className="icon-btn top-icon-btn"
                        title="跟随 SSH 当前目录"
                        onClick={async () => {
                          try {
                            const cwd = await window.terminalApi.sshGetCwd(activeSessionId);
                            if (cwd && cwd.trim()) {
                              await navigateSftp(cwd.trim());
                              return;
                            }
                            const home = await window.terminalApi.sftpGetHome(activeSessionId);
                            await navigateSftp(home || '~');
                          } catch (error) {
                            try {
                              const home = await window.terminalApi.sftpGetHome(activeSessionId);
                              await navigateSftp(home || '~');
                            } catch {
                              await showAlert(`目录跟随失败: ${String(error)}`, 'SFTP');
                            }
                          }
                        }}
                      >
                        <TerminalSquare size={16} strokeWidth={1.8} />
                      </button>
                      <button
                        className="icon-btn top-icon-btn"
                        title="新建目录"
                        disabled={!activeSession}
                        onClick={async () => {
                          if (!activeSession) return;
                          const name = await askPrompt('目录名');
                          if (!name) return;
                          await window.terminalApi.sftpMkdir({
                            sessionId: activeSessionId,
                            path: `${sftpPath.replace(/\/$/, '')}/${name}`,
                          });
                          await refreshSftp();
                        }}
                      >
                        <FolderPlus size={16} strokeWidth={1.8} />
                      </button>
                      <button
                        className="icon-btn top-icon-btn"
                        title="批量上传"
                        disabled={!activeSession}
                        onClick={async () => {
                          if (!activeSession) return;
                          setSelectedSftpPaths([]);
                          await window.terminalApi.sftpUploadBatch({ sessionId: activeSessionId, remoteDir: sftpPath });
                          await refreshSftp();
                        }}
                      >
                        <Upload size={16} strokeWidth={1.8} />
                      </button>
                      <button
                        className="icon-btn top-icon-btn"
                        title="批量下载"
                        disabled={!activeSession || selectedSftpPaths.length === 0}
                        onClick={async () => {
                          if (!activeSession) return;
                          const selectedPaths = selectedSftpPaths.filter((pathItem) => !!pathItem);
                          if (selectedPaths.length === 0) {
                            await showAlert('请选择文件或目录后再批量下载');
                            return;
                          }
                          setSelectedSftpPaths([]);
                          await window.terminalApi.sftpDownloadBatch({ sessionId: activeSessionId, remotePaths: selectedPaths });
                        }}
                      >
                        <Download size={16} strokeWidth={1.8} />
                      </button>
                    </div>
                    <div className="path-bar">
                      <input
                        className="path-input"
                        value={sftpPathInput}
                        onChange={(e) => setSftpPathInput(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          await submitSftpPath();
                        }}
                        onBlur={() => setSftpPathInput(sftpPath)}
                        title="输入远程路径并按 Enter 跳转"
                      />
                    </div>
                    <div className="sftp-list">
                      {sftpItems.map((item) => {
                        const isDir = item.type === 'd';
                        const fullPath = `${sftpPath.replace(/\/$/, '')}/${item.name}`;
                        return (
                          <div
                            key={`${item.name}-${item.modifyTime}`}
                            className="sftp-row"
                            draggable
                            title={formatSftpMeta(item)}
                            onDragStart={(e) => {
                              sftpInternalDragRef.current = true;
                              const picked =
                                selectedSftpPaths.includes(fullPath) && selectedSftpPaths.length > 0 ? selectedSftpPaths : [fullPath];
                              e.dataTransfer.setData('application/x-sftp-paths', JSON.stringify(picked));
                              e.dataTransfer.effectAllowed = 'copy';
                            }}
                            onDragEnd={() => {
                              sftpInternalDragRef.current = false;
                            }}
                            onContextMenu={(e) => {
                              if (!activeSession) return;
                              e.preventDefault();
                              e.stopPropagation();
                              setTreeMenu({
                                x: e.clientX,
                                y: e.clientY,
                                type: 'sftp',
                                sessionId: activeSessionId,
                                path: fullPath,
                                name: item.name,
                                isDir,
                              });
                            }}
                          >
                            <input
                              type="checkbox"
                              className="sftp-select"
                              checked={selectedSftpPaths.includes(fullPath)}
                              onChange={(e) => setSftpSelection(fullPath, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              className="link-btn tree-row-btn"
                              onContextMenu={(e) => {
                                if (!activeSession) return;
                                e.preventDefault();
                                e.stopPropagation();
                                setTreeMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  type: 'sftp',
                                  sessionId: activeSessionId,
                                  path: fullPath,
                                  name: item.name,
                                  isDir,
                                });
                              }}
                              onClick={async () => {
                                if (isDir) return;
                              }}
                              onDoubleClick={async () => {
                                if (!isDir) return;
                                const nextPath = `${sftpPath.replace(/\/$/, '')}/${item.name}`;
                                await navigateSftp(nextPath);
                              }}
                            >
                              <span className="sftp-item-icon" aria-hidden="true">
                                {isDir ? <FolderIcon size={14} strokeWidth={1.8} /> : <FileIcon size={14} strokeWidth={1.8} />}
                              </span>
                              {item.name}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {currentTransferRows.length > 0 && (
                      <div className="transfer-list">
                    {currentTransferRows.map((row) => (
                      <div key={row.key} className={`transfer-row transfer-${row.status}`} title={row.name}>
                        <div className="transfer-title">
                          <span>{row.direction === 'upload' ? '上传' : '下载'}</span>
                          <span>
                            {row.totalCount === 0
                              ? '准备中'
                              : row.name.includes('正在统计文件数量')
                                ? '准备中'
                                : row.name}
                          </span>
                          <span>{row.percent.toFixed(0)}%</span>
                        </div>
                            <div className="transfer-meta">
                              {row.totalCount > 0
                                ? `共 ${row.totalCount} 项，当前 ${Math.min(row.index + 1, row.totalCount)}/${row.totalCount}`
                                : '正在统计文件数量...'}
                            </div>
                            <div className="transfer-bar">
                              <div className="transfer-fill" style={{ width: `${row.percent}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="panel-empty">暂无活动会话</div>
                )}
              </div>
            )}
            {sidebarTab === 'status' && (
              <div className={`status-panel panel-content ${activeSessionId && currentMetrics ? '' : 'panel-empty-host'}`}>
                {activeSessionId && currentMetrics ? (
                  <>
                    <div className="status-group">
                      <div className="status-title">CPU</div>
                      <div>占用: {currentMetrics.cpu}%</div>
                      <div>核心: {currentMetrics.cpuCores || '--'}</div>
                      <div>主频: {currentMetrics.cpuMhz ? `${currentMetrics.cpuMhz} MHz` : '--'}</div>
                    </div>
                    <div className="status-group">
                      <div className="status-title">内存</div>
                      <div>
                        占用: {currentMetrics.memory.usedGb}GB / {currentMetrics.memory.totalGb}GB ({currentMetrics.memory.percent}%)
                      </div>
                    </div>
                    <div className="status-group">
                      <div className="status-title">网络</div>
                      <div>上传: {formatSpeed(currentMetrics.network.upload)}</div>
                      <div>下载: {formatSpeed(currentMetrics.network.download)}</div>
                    </div>
                    <div className="status-group">
                      <div className="status-title">硬盘</div>
                      <div>写入: {formatSpeed(currentMetrics.disk.upload)}</div>
                      <div>读取: {formatSpeed(currentMetrics.disk.download)}</div>
                    </div>
                    <div className="status-group">
                      <div className="status-title">GPU</div>
                      {currentMetrics.gpu.available ? (
                        <>
                          {currentMetrics.gpu.items.map((gpu) => (
                            <div key={`${gpu.index}-${gpu.name}`} className="gpu-item">
                              <div>GPU{gpu.index}: {gpu.name}</div>
                              <div>显存: {gpu.memoryUsedGb}GB / {gpu.memoryTotalGb}GB ({gpu.memoryPercent}%)</div>
                              <div>负载: {gpu.load}%</div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div>无</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="panel-empty">暂无活动会话</div>
                )}
              </div>
            )}
          </aside>
        )}

        {settings.ui.sidebarVisible && (
          <div
            className="sidebar-resizer"
            title="拖动调整侧边栏宽度"
            onMouseDown={startSidebarResize}
          />
        )}

        <section className="terminal-zone">
          {activeSessionId && pausedOutput && <div className="pause-banner">已暂停输出，滚动到底部或按回车继续</div>}
          <div
            ref={terminalContainerRef}
            className="terminal-container"
            onWheel={() => {
              if (!activeSessionId) return;
              const term = terminalMapRef.current.get(activeSessionId);
              if (!term) return;
              requestAnimationFrame(() => {
                if (!isAtBottom(term)) {
                  setPausedByScroll(activeSessionId, true, term);
                }
              });
            }}
            onContextMenu={async (event) => {
              event.preventDefault();
              if (!activeSessionId || !settings.behavior.rightClickPaste) return;
              const text = await navigator.clipboard.readText();
              if (!text) return;
              if (settings.behavior.multilineWarning && text.includes('\n')) {
                if (!(await askConfirm('检测到多行内容，确认粘贴到终端吗？'))) return;
              }
              await window.terminalApi.sshSend({ sessionId: activeSessionId, input: text });
            }}
          />
        </section>
      </main>

      {showSessionModal && (
        <div className="modal-mask">
          <div className="modal-card">
            <h3>{editingSession ? '编辑会话' : '新建会话'}</h3>
            <label>
              名称
              <input value={sessionForm.name} onChange={(e) => setSessionForm({ ...sessionForm, name: e.target.value })} />
            </label>
            <label>
              主机
              <input value={sessionForm.host} onChange={(e) => setSessionForm({ ...sessionForm, host: e.target.value })} />
            </label>
            <label>
              端口
              <input
                type="number"
                value={sessionForm.port}
                onChange={(e) => setSessionForm({ ...sessionForm, port: Number(e.target.value) || 22 })}
              />
            </label>
            <label>
              用户名
              <input value={sessionForm.username} onChange={(e) => setSessionForm({ ...sessionForm, username: e.target.value })} />
            </label>
            <label>
              密码
              <div className="password-field">
                <input
                  type={showSessionPassword ? 'text' : 'password'}
                  value={sessionForm.password}
                  onChange={(e) => setSessionForm({ ...sessionForm, password: e.target.value })}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  title={showSessionPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowSessionPassword((v) => !v)}
                >
                  {showSessionPassword ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                </button>
              </div>
            </label>
            <label>
              目录
              <div className="select-like" ref={sessionFolderMenuRef}>
                <button
                  type="button"
                  className="select-like-trigger"
                  onClick={() => setSessionFolderMenuOpen((v) => !v)}
                >
                  <span>{getFolderLabel(sessionForm.folder_id)}</span>
                  <span aria-hidden="true">▾</span>
                </button>
                {sessionFolderMenuOpen && (
                  <div className="select-like-menu">
                    <button
                      type="button"
                      className={sessionForm.folder_id == null ? 'active' : ''}
                      onClick={() => {
                        setSessionForm({ ...sessionForm, folder_id: null });
                        setSessionFolderMenuOpen(false);
                      }}
                    >
                      根目录
                    </button>
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className={sessionForm.folder_id === folder.id ? 'active' : ''}
                        onClick={() => {
                          setSessionForm({ ...sessionForm, folder_id: folder.id });
                          setSessionFolderMenuOpen(false);
                        }}
                      >
                        {folder.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={sessionForm.remember_password === 1}
                onChange={(e) => setSessionForm({ ...sessionForm, remember_password: e.target.checked ? 1 : 0 })}
              />
              默认记住密码
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={sessionForm.default_session === 1}
                onChange={(e) => setSessionForm({ ...sessionForm, default_session: e.target.checked ? 1 : 0 })}
              />
              默认会话
            </label>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setSessionFolderMenuOpen(false);
                  setShowSessionModal(false);
                }}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (!sessionForm.name || !sessionForm.host || !sessionForm.username) {
                    await showAlert('请填写完整信息');
                    return;
                  }
                  if (editingSession) await window.terminalApi.updateSession({ id: editingSession.id, ...sessionForm });
                  else await window.terminalApi.createSession(sessionForm);
                  await loadSessionData();
                  setSessionFolderMenuOpen(false);
                  setShowSessionModal(false);
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {showFolderModal && (
        <div className="modal-mask">
          <div className="modal-card">
            <h3>新建目录</h3>
            <label>
              名称
              <input value={folderName} onChange={(e) => setFolderName(e.target.value)} />
            </label>
            <label>
              父目录
              <select value={folderParent ?? ''} onChange={(e) => setFolderParent(e.target.value ? Number(e.target.value) : null)}>
                <option value="">根目录</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button onClick={() => setShowFolderModal(false)}>取消</button>
              <button
                onClick={async () => {
                  if (!folderName.trim()) {
                    await showAlert('请输入目录名');
                    return;
                  }
                  await window.terminalApi.createFolder({ name: folderName.trim(), parentId: folderParent });
                  await loadSessionData();
                  setFolderName('');
                  setFolderParent(null);
                  setShowFolderModal(false);
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && settingsDraft && (
        <div className="modal-mask">
          <div className="modal-card settings-modal">
            <h3>设置</h3>
            <div className="settings-tabs">
              <button
                type="button"
                className={settingsTab === 'appearance' ? 'active' : ''}
                onClick={() => setSettingsTab('appearance')}
              >
                外观
              </button>
              <button
                type="button"
                className={settingsTab === 'behavior' ? 'active' : ''}
                onClick={() => setSettingsTab('behavior')}
              >
                行为
              </button>
              <button
                type="button"
                className={settingsTab === 'system' ? 'active' : ''}
                onClick={() => setSettingsTab('system')}
              >
                系统
              </button>
            </div>
            <div className="settings-content-scroll">
              {settingsTab === 'appearance' && (
                <>
                  <div className="setting-row">
                    <span>背景色</span>
                    <input
                      type="color"
                      value={settingsDraft.theme.backgroundColor}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          theme: { ...settingsDraft.theme, backgroundColor: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="setting-row">
                    <span>字体色</span>
                    <input
                      type="color"
                      value={settingsDraft.theme.foregroundColor}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          theme: { ...settingsDraft.theme, foregroundColor: e.target.value },
                        })
                      }
                    />
                  </div>
                  <label>
                    界面字体
                    <input
                      value={settingsDraft.theme.uiFontFamily || ''}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          theme: { ...settingsDraft.theme, uiFontFamily: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    界面字号
                    <input
                      type="number"
                      min={11}
                      max={24}
                      value={settingsDraft.theme.uiFontSize}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          theme: { ...settingsDraft.theme, uiFontSize: Number(e.target.value) || 13 },
                        })
                      }
                    />
                  </label>
                  <label>
                    会话字体
                    <input
                      value={settingsDraft.theme.terminalFontFamily || ''}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          theme: { ...settingsDraft.theme, terminalFontFamily: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    会话字号
                    <input
                      type="number"
                      min={10}
                      max={36}
                      value={settingsDraft.theme.terminalFontSize}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          theme: { ...settingsDraft.theme, terminalFontSize: Number(e.target.value) || 16 },
                        })
                      }
                    />
                  </label>
                </>
              )}

              {settingsTab === 'behavior' && (
                <>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={settingsDraft.behavior.autoCopySelection}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          behavior: { ...settingsDraft.behavior, autoCopySelection: e.target.checked },
                        })
                      }
                    />
                    选中自动复制
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={settingsDraft.behavior.rightClickPaste}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          behavior: { ...settingsDraft.behavior, rightClickPaste: e.target.checked },
                        })
                      }
                    />
                    右键自动粘贴
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={settingsDraft.behavior.multilineWarning}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          behavior: { ...settingsDraft.behavior, multilineWarning: e.target.checked },
                        })
                      }
                    />
                    多行预警
                  </label>
                  <label>
                    默认下载目录
                    <div className="path-picker">
                      <input
                        value={settingsDraft.behavior.defaultDownloadDir || ''}
                        placeholder="留空则使用系统下载目录"
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            behavior: { ...settingsDraft.behavior, defaultDownloadDir: e.target.value },
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const picked = await window.terminalApi.pickDirectory(
                            settingsDraft.behavior.defaultDownloadDir || runtimeInfo?.runtimeDir,
                          );
                          if (!picked) return;
                          setSettingsDraft({
                            ...settingsDraft,
                            behavior: { ...settingsDraft.behavior, defaultDownloadDir: picked },
                          });
                        }}
                      >
                        选择
                      </button>
                    </div>
                  </label>
                </>
              )}

              {settingsTab === 'system' && (
                <div className="runtime-note">
                  <div className="runtime-title">运行时路径</div>
                  <div>userData: {runtimeInfo?.userDataPath}</div>
                  <div>配置文件: {runtimeInfo?.configPath}</div>
                  <div>数据库文件: {runtimeInfo?.dbPath}</div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setShowSettings(false);
                  setSettingsDraft(null);
                  setSettingsTab('appearance');
                }}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  const saved = await window.terminalApi.updateSettings(settingsDraft);
                  setSettings(saved);
                  setSettingsDraft(null);
                  setShowSettings(false);
                  setSettingsTab('appearance');
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {treeMenu && (
        <div
          className="tree-context-menu"
          style={{ left: treeMenu.x, top: treeMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {treeMenu.type === 'session' ? (
            <>
              <button
                onClick={() => {
                  const target = sessions.find((s) => s.id === treeMenu.id);
                  if (target) openSessionModal(target);
                  setTreeMenu(null);
                }}
              >
                编辑
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!(await askConfirm(`确定删除会话 ${treeMenu.name} 吗？`))) return;
                  await window.terminalApi.deleteSession(treeMenu.id);
                  await loadSessionData();
                  setTreeMenu(null);
                }}
              >
                删除
              </button>
            </>
          ) : treeMenu.type === 'folder' ? (
            <>
              <button
                onClick={async () => {
                  const name = await askPrompt('目录名称', treeMenu.name);
                  if (!name || !name.trim() || name.trim() === treeMenu.name) {
                    setTreeMenu(null);
                    return;
                  }
                  await window.terminalApi.updateFolder({ id: treeMenu.id, name: name.trim() });
                  await loadSessionData();
                  setTreeMenu(null);
                }}
              >
                编辑
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!(await askConfirm(`确定删除目录 ${treeMenu.name} 吗？`))) return;
                  try {
                    await window.terminalApi.deleteFolder(treeMenu.id);
                    await loadSessionData();
                  } catch (error) {
                    await showAlert(String(error), '删除失败');
                  } finally {
                    setTreeMenu(null);
                  }
                }}
              >
                删除
              </button>
            </>
          ) : (
            <>
              <button
                onClick={async () => {
                  await window.terminalApi.sftpDownloadBatch({ sessionId: treeMenu.sessionId, remotePaths: [treeMenu.path] });
                  setTreeMenu(null);
                }}
              >
                下载
              </button>
              <button
                onClick={async () => {
                  const newName = await askPrompt('新名称', treeMenu.name);
                  if (!newName || newName === treeMenu.name) {
                    setTreeMenu(null);
                    return;
                  }
                  const parentDir = treeMenu.path.replace(/\/[^/]+$/, '') || '/';
                  const nextPath = `${parentDir.replace(/\/$/, '')}/${newName}`;
                  await window.terminalApi.sftpRename({
                    sessionId: treeMenu.sessionId,
                    from: treeMenu.path,
                    to: nextPath,
                  });
                  await refreshSftp();
                  setTreeMenu(null);
                }}
              >
                重命名
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!(await askConfirm(`确定删除 ${treeMenu.name} 吗？`))) return;
                  await window.terminalApi.sftpDelete({
                    sessionId: treeMenu.sessionId,
                    path: treeMenu.path,
                    isDir: treeMenu.isDir,
                  });
                  await refreshSftp();
                  setTreeMenu(null);
                }}
              >
                删除
              </button>
            </>
          )}
        </div>
      )}

      {dialog && (
        <div className="modal-mask">
          <div className="modal-card">
            <h3>{dialog.title}</h3>
            <div className="dialog-message">{dialog.message}</div>
            {dialog.type === 'prompt' && (
              <>
                <div className="password-field">
                  <input
                    autoFocus
                    type={dialog.inputType === 'password' && !showDialogPassword ? 'password' : 'text'}
                    value={dialogInput}
                    onChange={(e) => setDialogInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (dialog.inputType === 'password') {
                        setCapsLockOn(e.getModifierState('CapsLock'));
                      }
                      if (e.key === 'Enter') {
                        closeDialog(dialog.inputType === 'password' ? dialogInput : dialogInput.trim());
                      }
                      if (e.key === 'Escape') closeDialog(null);
                    }}
                    onKeyUp={(e) => {
                      if (dialog.inputType === 'password') {
                        setCapsLockOn(e.getModifierState('CapsLock'));
                      }
                    }}
                    onClick={(e) => {
                      if (dialog.inputType === 'password') {
                        setCapsLockOn((e as any).getModifierState?.('CapsLock') || false);
                      }
                    }}
                    onBlur={() => {
                      if (dialog.inputType === 'password') {
                        setCapsLockOn(false);
                      }
                    }}
                  />
                  {dialog.inputType === 'password' && (
                    <button
                      type="button"
                      className="password-toggle-btn"
                      title={showDialogPassword ? '隐藏密码' : '显示密码'}
                      onClick={() => setShowDialogPassword((v) => !v)}
                    >
                      {showDialogPassword ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                    </button>
                  )}
                </div>
                {dialog.inputType === 'password' && (
                  <div className={`caps-tip ${capsLockOn ? 'on' : ''}`}>Caps Lock: {capsLockOn ? '开' : '关'}</div>
                )}
              </>
            )}
            <div className="modal-actions">
              {dialog.type === 'confirm' && <button onClick={() => closeDialog(false)}>取消</button>}
              {dialog.type === 'prompt' && <button onClick={() => closeDialog(null)}>取消</button>}
              <button
                onClick={() => {
                  if (dialog.type === 'confirm') closeDialog(true);
                  else if (dialog.type === 'prompt') {
                    closeDialog(dialog.inputType === 'password' ? dialogInput : dialogInput.trim());
                  }
                  else closeDialog(undefined);
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
