import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Session, Settings } from '../types';

type UseSessionLifecycleParams = {
  settings: Settings | null;
  sessions: Session[];
  tabCount: number;
  sidebarTab: 'sessions' | 'sftp' | 'status';
  activeSessionId: number | null;
  terminalContainerRef: MutableRefObject<HTMLDivElement | null>;
  connectSession: (session: Session, forceNew?: boolean) => Promise<void>;
  attachTerminal: (sessionId: number, settings: Settings) => void;
  focusTerminalInput: (sessionId: number) => void;
  getPausedByScroll: (sessionId: number) => boolean;
  setPausedOutput: Dispatch<SetStateAction<boolean>>;
  flushPendingOutput: (sessionId: number) => void;
  fitTerminalStabilized: (sessionId: number) => void;
  setSftpPath: Dispatch<SetStateAction<string>>;
  setSftpPathInput: Dispatch<SetStateAction<string>>;
  clearSftpSelection: () => void;
  sftpPath: string;
  clearSftpItems: () => void;
  refreshSftp: (targetPath?: string) => Promise<void>;
};

export function useSessionLifecycle(params: UseSessionLifecycleParams) {
  const {
    settings,
    sessions,
    tabCount,
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
  } = params;

  useEffect(() => {
    if (!settings) return;
    const defaultOne = sessions.find((it) => it.default_session === 1);
    if (defaultOne && tabCount === 0) {
      connectSession(defaultOne).catch(() => null);
    }
  }, [settings, sessions, tabCount, connectSession]);

  useEffect(() => {
    if (!settings || !activeSessionId) return;
    attachTerminal(activeSessionId, settings);
    focusTerminalInput(activeSessionId);
    const paused = getPausedByScroll(activeSessionId);
    setPausedOutput(paused);
    if (!paused) {
      flushPendingOutput(activeSessionId);
    }
  }, [
    activeSessionId,
    settings?.theme.backgroundColor,
    settings?.theme.foregroundColor,
    settings?.theme.terminalFontFamily,
    settings?.theme.terminalFontSize,
    settings?.theme.terminalCursorStyle,
    settings?.theme.terminalCursorBlink,
    settings?.theme.terminalCursorWidth,
    settings?.behavior.autoCopySelection,
    attachTerminal,
    focusTerminalInput,
    getPausedByScroll,
    setPausedOutput,
    flushPendingOutput,
  ]);

  useEffect(() => {
    if (!activeSessionId) return;
    window.terminalApi
      .sftpGetHome(activeSessionId)
      .then(async (home) => {
        const target = home?.trim() || '~';
        setSftpPath(target);
        clearSftpSelection();
        await refreshSftp(target);
      })
      .catch(() => refreshSftp('~'));
  }, [activeSessionId, setSftpPath, clearSftpSelection, refreshSftp]);

  useEffect(() => {
    window.terminalApi.setMetricsSession(activeSessionId).catch(() => null);
  }, [activeSessionId]);

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
  }, [activeSessionId, settings?.ui.sidebarVisible, terminalContainerRef, fitTerminalStabilized]);

  useEffect(() => {
    if (!settings || !activeSessionId) return;
    refreshSftp().catch(() => null);
  }, [settings?.ui.showHiddenFiles, activeSessionId, refreshSftp]);

  useEffect(() => {
    if (!settings || !activeSessionId || sidebarTab !== 'sftp') return;
    refreshSftp().catch(() => null);
  }, [sidebarTab, activeSessionId, refreshSftp]);

  useEffect(() => {
    if (!activeSessionId) {
      clearSftpItems();
      clearSftpSelection();
      setPausedOutput(false);
      if (terminalContainerRef.current) {
        terminalContainerRef.current.innerHTML = '';
      }
    }
  }, [activeSessionId, clearSftpItems, clearSftpSelection, setPausedOutput, terminalContainerRef]);

  useEffect(() => {
    setSftpPathInput(sftpPath);
  }, [sftpPath, setSftpPathInput]);
}
