import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type {
  Folder,
  Metrics,
  Session,
  Settings,
  SftpTransferBatchResult,
  SftpTransferError,
  SftpTransferProgress,
} from '../types';

type UseAppBootstrapParams = {
  activeSessionIdRef: MutableRefObject<number | null>;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  setRuntimeInfo: Dispatch<
    SetStateAction<{
      runtimeDir: string;
      userDataPath: string;
      settingsStorage: string;
      dbPath: string;
      os: string;
    } | null>
  >;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setIsMaximized: Dispatch<SetStateAction<boolean>>;
  setMetrics: Dispatch<SetStateAction<Metrics | null>>;
  setMetricsBySession: Dispatch<SetStateAction<Record<number, Metrics>>>;
  disconnectedByTabRef: MutableRefObject<Map<number, boolean>>;
  reconnectingTabRef: MutableRefObject<Set<number>>;
  terminalMapRef: MutableRefObject<Map<number, import('xterm').Terminal>>;
  appendPendingOutput: (sessionId: number, data: string) => void;
  getPausedByScroll: (sessionId: number) => boolean;
  isAtBottom: (term: import('xterm').Terminal) => boolean;
  setPausedByScroll: (sessionId: number, paused: boolean, term?: import('xterm').Terminal) => void;
  syncPauseStateWithViewport: (sessionId: number, term?: import('xterm').Terminal) => void;
  fitTerminalStabilized: (sessionId: number) => void;
  updateTransferRow: (payload: SftpTransferProgress) => void;
  markTransferBatchComplete: (payload: SftpTransferBatchResult) => Promise<void> | void;
  markTransferError: (payload: SftpTransferError) => void;
  stripInternalProbeOutput: (data: string) => string;
};

export function useAppBootstrap(params: UseAppBootstrapParams) {
  const {
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
  } = params;

  const loadSessionData = useCallback(async () => {
    const [folderResult, sessionResult] = await Promise.all([
      window.terminalApi.listFolders(),
      window.terminalApi.listSessions(),
    ]);
    setFolders(folderResult);
    setSessions(sessionResult);
  }, [setFolders, setSessions]);

  const handlerRef = useRef({
      appendPendingOutput,
      getPausedByScroll,
      isAtBottom,
      setPausedByScroll,
      syncPauseStateWithViewport,
      fitTerminalStabilized,
      updateTransferRow,
      markTransferBatchComplete,
      markTransferError,
    });

  useEffect(() => {
    handlerRef.current = {
      appendPendingOutput,
      getPausedByScroll,
      isAtBottom,
      setPausedByScroll,
      syncPauseStateWithViewport,
      fitTerminalStabilized,
      updateTransferRow,
      markTransferBatchComplete,
      markTransferError,
    };
  }, [
    appendPendingOutput,
    getPausedByScroll,
    isAtBottom,
    setPausedByScroll,
    syncPauseStateWithViewport,
    fitTerminalStabilized,
    updateTransferRow,
    markTransferBatchComplete,
    markTransferError,
  ]);

  useEffect(() => {
    const unSettings = window.terminalApi.onSettingsChanged(setSettings);
    const unMaximize = window.terminalApi.onMaximizedChanged((v) => setIsMaximized(v));
    const unData = window.terminalApi.onSshData(({ sessionId, data }) => {
      const handlers = handlerRef.current;
      const cleanData = stripInternalProbeOutput(data);
      if (!cleanData) return;
      if (
        activeSessionIdRef.current === sessionId &&
        (cleanData.includes('\u001b[?1049h') ||
          cleanData.includes('\u001b[?1047h') ||
          cleanData.includes('\u001b[?47h') ||
          cleanData.includes('\u001b[?1049l') ||
          cleanData.includes('\u001b[?1047l') ||
          cleanData.includes('\u001b[?47l'))
      ) {
        handlers.fitTerminalStabilized(sessionId);
      }
      const term = terminalMapRef.current.get(sessionId);
      if (!term) {
        handlers.appendPendingOutput(sessionId, cleanData);
        return;
      }
      const pausedFlag = handlers.getPausedByScroll(sessionId);
      if (pausedFlag) {
        if (handlers.isAtBottom(term)) {
          handlers.setPausedByScroll(sessionId, false, term);
          term.write(cleanData);
          requestAnimationFrame(() => handlers.syncPauseStateWithViewport(sessionId, term));
          return;
        }
        handlers.appendPendingOutput(sessionId, cleanData);
        return;
      }
      term.write(cleanData);
    });
    const unClosed = window.terminalApi.onSshClosed(({ sessionId }) => {
      disconnectedByTabRef.current.set(sessionId, true);
      reconnectingTabRef.current.delete(sessionId);
      const term = terminalMapRef.current.get(sessionId);
      term?.writeln('\r\n[连接已关闭，按 R 重连]');
    });
    const unMetrics = window.terminalApi.onMetrics((payload) => {
      setMetrics(payload);
      if (activeSessionIdRef.current) {
        setMetricsBySession((prev) => ({ ...prev, [activeSessionIdRef.current as number]: payload }));
      }
    });
    const unSftpProgress = window.terminalApi.onSftpProgress((event) => handlerRef.current.updateTransferRow(event));
    const unSftpBatchComplete = window.terminalApi.onSftpBatchComplete((event) => {
      void Promise.resolve(handlerRef.current.markTransferBatchComplete(event)).catch(() => null);
    });
    const unSftpBatchError = window.terminalApi.onSftpBatchError((event) => {
      handlerRef.current.markTransferError(event);
    });

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
  }, [
    activeSessionIdRef,
    disconnectedByTabRef,
    reconnectingTabRef,
    setIsMaximized,
    setMetrics,
    setMetricsBySession,
    setSettings,
    stripInternalProbeOutput,
    terminalMapRef,
  ]);

  useEffect(() => {
    void (async () => {
      const [initSettings, runtime] = await Promise.all([
        window.terminalApi.getSettings(),
        window.terminalApi.getRuntimePaths(),
      ]);
      setSettings(initSettings);
      setRuntimeInfo(runtime);
      await loadSessionData();
    })();
  }, [loadSessionData, setRuntimeInfo, setSettings]);

  useEffect(() => {
    window.terminalApi.isMaximizedWindow().then((v) => setIsMaximized(v)).catch(() => null);
  }, [setIsMaximized]);

  return {
    loadSessionData,
  };
}
