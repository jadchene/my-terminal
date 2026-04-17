import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import 'xterm/css/xterm.css';
import type {
  Folder,
  Metrics,
  Session,
  Settings,
  TreeContextMenu,
} from './types';
import { AppHeader } from './components/AppHeader';
import { SidebarShell } from './components/SidebarShell';
import { TerminalZone } from './components/TerminalZone';
import { ModalHost } from './components/ModalHost';
import { useDialog } from './hooks/useDialog';
import { useTransferQueue } from './hooks/useTransferQueue';
import { useSftpPanel } from './hooks/useSftpPanel';
import { useSessionTabs } from './hooks/useSessionTabs';
import { useFolderTreeOptions } from './hooks/useFolderTreeOptions';
import { useTerminalRuntime } from './hooks/useTerminalRuntime';
import { useSidebarResize } from './hooks/useSidebarResize';
import { useOverlayClose } from './hooks/useOverlayClose';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useSftpInteractions } from './hooks/useSftpInteractions';
import { useSessionTreeActions } from './hooks/useSessionTreeActions';
import { useSessionLifecycle } from './hooks/useSessionLifecycle';
import { useSettingsActions } from './hooks/useSettingsActions';
import { useWindowActions } from './hooks/useWindowActions';
import { formatSftpMeta } from './utils/sftpFormat';

type SessionForm = Omit<Session, 'id'>;
type Tab = { id: number; sessionId: number; title: string };

const defaultSessionForm: SessionForm = {
  folder_id: null,
  name: '',
  host: '',
  port: 22,
  username: 'root',
  password: '',
  remember_password: 1,
  default_session: 0,
};

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
  const [sessionFolderMenuOpen, setSessionFolderMenuOpen] = useState(false);
  const [folderParentMenuOpen, setFolderParentMenuOpen] = useState(false);
  const [cursorStyleMenuOpen, setCursorStyleMenuOpen] = useState(false);

  const [runtimeInfo, setRuntimeInfo] = useState<{
    runtimeDir: string;
    userDataPath: string;
    settingsStorage: string;
    dbPath: string;
    os: string;
  } | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'sftp' | 'status'>('sessions');
  const [treeMenu, setTreeMenu] = useState<TreeContextMenu | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<number>>(new Set());

  const disconnectedByTabRef = useRef<Map<number, boolean>>(new Map());
  const reconnectingTabRef = useRef<Set<number>>(new Set());
  const sessionFolderMenuRef = useRef<HTMLDivElement>(null);
  const folderParentMenuRef = useRef<HTMLDivElement>(null);
  const cursorStyleMenuRef = useRef<HTMLDivElement>(null);
  const sftpInternalDragRef = useRef(false);
  const activeSessionIdRef = useRef<number | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const sessionsRef = useRef<Session[]>([]);
  const settingsRef = useRef<Settings | null>(null);
  const {
    dialog,
    dialogInput,
    showDialogPassword,
    capsLockOn,
    setDialogInput,
    setShowDialogPassword,
    setCapsLockOn,
    closeDialog,
    askConfirm,
    askPrompt,
    askPassword,
    showAlert,
  } = useDialog();
  const {
    transferRows,
    updateTransferRow,
    markTransferBatchComplete,
    markTransferError,
    cancelTransferRow,
  } = useTransferQueue({
    showAlert,
    cancelBatch: (payload) => window.terminalApi.sftpCancelBatch(payload),
  });
  const {
    terminalContainerRef,
    terminalMapRef,
    pausedOutput,
    setPausedOutput,
    appendPendingOutput,
    flushPendingOutput,
    setPausedByScroll,
    syncPauseStateWithViewport,
    fitTerminal,
    fitTerminalStabilized,
    focusTerminalInput,
    getPausedByScroll,
    attachTerminal,
    setReconnectHandler,
    isAtBottom,
  } = useTerminalRuntime({
    activeSessionIdRef,
    disconnectedByTabRef,
    sendInput: window.terminalApi.sshSend,
    resizePty: window.terminalApi.sshResize,
  });

  const nextTabIdRef = useRef(1);
  const activeTab = useMemo(
    () => tabs.find((it) => it.id === activeSessionId) || null,
    [tabs, activeSessionId],
  );
  const activeSession = useMemo(
    () => sessions.find((it) => it.id === activeTab?.sessionId) || null,
    [sessions, activeTab],
  );
  const {
    sftpPath,
    setSftpPath,
    sftpPathInput,
    setSftpPathInput,
    sftpItems,
    selectedSftpPaths,
    sftpUploadDropOver,
    setSftpUploadDropOver,
    sftpDownloadDropOver,
    setSftpDownloadDropOver,
    refreshSftp,
    setSftpSelection,
    navigateSftp,
    clearSftpSelectionNow,
    clearSftpSelection,
    clearSftpItems,
    getLocalPathsFromDrop,
    getSftpPathsFromDrag,
    submitSftpPath,
  } = useSftpPanel({
    activeSessionId,
    showHiddenFiles: !!settings?.ui.showHiddenFiles,
    showAlert,
  });
  const { getFolderLabel, renderFolderTreeOptions } = useFolderTreeOptions(folders);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const { sidebarWidth: resolvedSidebarWidth, startSidebarResize } = useSidebarResize({
    settings,
    activeSessionId,
    sidebarWidth,
    setSidebarWidth,
    setSettings,
    fitTerminal,
    fitTerminalStabilized,
  });

  const { loadSessionData } = useAppBootstrap({
    activeSessionIdRef,
    setSettings,
    setRuntimeInfo,
    setFolders,
    setSessions,
    setIsMaximized,
    setMetrics,
    setMetricsBySession,
    disconnectedByTabRef,
    reconnectingTabRef,
    terminalMapRef,
    appendPendingOutput,
    getPausedByScroll,
    isAtBottom,
    setPausedByScroll,
    syncPauseStateWithViewport,
    fitTerminalStabilized,
    updateTransferRow,
    markTransferBatchComplete,
    markTransferError,
    stripInternalProbeOutput,
  });

  const { reconnectTab, connectSession, closeTab } = useSessionTabs({
    tabs,
    activeSessionId,
    setTabs,
    setActiveSessionId,
    setSessions,
    setMetricsBySession,
    settings,
    activeSessionIdRef,
    tabsRef,
    sessionsRef,
    settingsRef,
    nextTabIdRef,
    disconnectedByTabRef,
    reconnectingTabRef,
    attachTerminal,
    setPausedOutput,
    askPassword,
    showAlert,
    isAuthError,
  });

  useEffect(() => {
    setReconnectHandler((tabId) => {
      void reconnectTab(tabId);
    });
  }, [reconnectTab, setReconnectHandler]);

  useSessionLifecycle({
    settings,
    sessions,
    tabCount: tabs.length,
    sidebarTab,
    activeSessionId,
    terminalContainerRef,
    connectSession,
    attachTerminal,
    focusTerminalInput,
    getPausedByScroll,
    setPausedOutput,
    flushPendingOutput,
    fitTerminalStabilized,
    setSftpPath,
    setSftpPathInput,
    clearSftpSelection,
    sftpPath,
    clearSftpItems,
    refreshSftp,
  });

  useOverlayClose({
    treeMenu,
    setTreeMenu,
    sessionFolderMenuOpen,
    setSessionFolderMenuOpen,
    sessionFolderMenuRef,
    folderParentMenuOpen,
    setFolderParentMenuOpen,
    folderParentMenuRef,
    cursorStyleMenuOpen,
    setCursorStyleMenuOpen,
    cursorStyleMenuRef,
  });

  const sftpInteractions = useSftpInteractions({
    activeSessionId,
    activeSession,
    settings,
    setSettings,
    sftpPath,
    selectedSftpPaths,
    setSftpPathInput,
    setSftpUploadDropOver,
    setSftpDownloadDropOver,
    setTreeMenu,
    sftpInternalDragRef,
    refreshSftp,
    navigateSftp,
    clearSftpSelectionNow,
    getLocalPathsFromDrop,
    getSftpPathsFromDrag,
    submitSftpPath,
    setSftpSelection,
    showAlert,
    askPrompt,
    askConfirm,
  });

  const sessionTreeActions = useSessionTreeActions({
    sessions,
    editingSession,
    sessionForm,
    folderName,
    folderParent,
    defaultSessionForm,
    setShowSessionModal,
    setEditingSession,
    setSessionForm,
    setShowSessionPassword,
    setSessionFolderMenuOpen,
    setShowFolderModal,
    setFolderName,
    setFolderParent,
    setFolderParentMenuOpen,
    setTreeMenu,
    loadSessionData,
    askConfirm,
    askPrompt,
    showAlert,
  });

  const settingsActions = useSettingsActions({
    settings,
    settingsDraft,
    runtimeInfo,
    setSettings,
    setSettingsDraft,
    setShowSettings,
    setSettingsTab,
    setCursorStyleMenuOpen,
    setMenuOpen,
  });

  const windowActions = useWindowActions({
    closeTab,
    setMenuOpen,
  });

  if (!settings) return <div className="loading">加载中...</div>;

  const currentMetrics = (activeSessionId ? metricsBySession[activeSessionId] : null) ?? metrics;
  const currentTransferRows = activeSessionId ? transferRows.filter((it) => it.sessionId === activeSessionId) : [];

  return (
    <div
      className="app-shell"
      style={
        {
          '--bg': settings.theme.backgroundColor,
          '--fg': settings.theme.foregroundColor,
          '--sidebar-width': `${resolvedSidebarWidth}px`,
          '--ui-font-family': settings.theme.uiFontFamily || 'Microsoft YaHei, Segoe UI, sans-serif',
          '--ui-font-size': `${settings.theme.uiFontSize || 13}px`,
        } as CSSProperties
      }
    >
      <main className={`body-layout ${settings.ui.sidebarVisible ? '' : 'sidebar-hidden'}`}>
        <AppHeader
          tabs={tabs}
          activeSessionId={activeSessionId}
          menuOpen={menuOpen}
          isMaximized={isMaximized}
          sidebarVisible={settings.ui.sidebarVisible}
          onSelectTab={setActiveSessionId}
          onCloseTab={windowActions.onCloseTab}
          onToggleMenu={windowActions.onToggleMenu}
          onOpenSettings={settingsActions.openSettingsModal}
          onToggleSidebar={settingsActions.toggleSidebarVisible}
          onMinimize={windowActions.onMinimize}
          onToggleMaximize={windowActions.onToggleMaximize}
          onCloseWindow={windowActions.onCloseWindow}
        />
        {settings.ui.sidebarVisible && (
          <SidebarShell
            sidebarTab={sidebarTab}
            setSidebarTab={setSidebarTab}
            folders={folders}
            sessions={sessions}
            expandedFolderIds={expandedFolderIds}
            setExpandedFolderIds={setExpandedFolderIds}
            connectSession={connectSession}
            sessionTreeActions={sessionTreeActions}
            activeSessionId={activeSessionId}
            activeSession={activeSession}
            settingsShowHiddenFiles={settings.ui.showHiddenFiles}
            sftpPath={sftpPath}
            sftpPathInput={sftpPathInput}
            sftpItems={sftpItems}
            selectedSftpPaths={selectedSftpPaths}
            dropOver={sftpUploadDropOver || sftpDownloadDropOver}
            transferRows={currentTransferRows}
            formatSftpMeta={formatSftpMeta}
            sftpInteractions={sftpInteractions}
            onCancelTransfer={(row) => {
              void cancelTransferRow(row);
            }}
            currentMetrics={currentMetrics}
          />
        )}

        {settings.ui.sidebarVisible && (
          <div
            className="sidebar-resizer"
            title="拖动调整侧边栏宽度"
            onMouseDown={startSidebarResize}
          />
        )}

        <TerminalZone
          activeSessionId={activeSessionId}
          pausedOutput={pausedOutput}
          settings={settings}
          terminalContainerRef={terminalContainerRef}
          terminalMapRef={terminalMapRef}
          syncPauseStateWithViewport={syncPauseStateWithViewport}
          askConfirm={askConfirm}
        />
      </main>

      <ModalHost
        showSessionModal={showSessionModal}
        editingSession={editingSession}
        sessionForm={sessionForm}
        showSessionPassword={showSessionPassword}
        sessionFolderMenuOpen={sessionFolderMenuOpen}
        sessionFolderMenuRef={sessionFolderMenuRef}
        getFolderLabel={getFolderLabel}
        renderFolderTreeOptions={renderFolderTreeOptions}
        setSessionForm={setSessionForm}
        showFolderModal={showFolderModal}
        folderName={folderName}
        folderParent={folderParent}
        folderParentMenuOpen={folderParentMenuOpen}
        folderParentMenuRef={folderParentMenuRef}
        setFolderName={setFolderName}
        showSettings={showSettings}
        settingsDraft={settingsDraft}
        settingsTab={settingsTab}
        cursorStyleMenuOpen={cursorStyleMenuOpen}
        cursorStyleMenuRef={cursorStyleMenuRef}
        runtimeInfo={runtimeInfo}
        setSettingsTab={setSettingsTab}
        setCursorStyleMenuOpen={setCursorStyleMenuOpen}
        setSettingsDraft={setSettingsDraft}
        treeMenu={treeMenu}
        dialog={dialog}
        dialogInput={dialogInput}
        showDialogPassword={showDialogPassword}
        capsLockOn={capsLockOn}
        setDialogInput={setDialogInput}
        setShowDialogPassword={setShowDialogPassword}
        setCapsLockOn={setCapsLockOn}
        closeDialog={closeDialog}
        sessionTreeActions={sessionTreeActions}
        settingsActions={settingsActions}
        sftpInteractions={sftpInteractions}
      />
    </div>
  );
}
