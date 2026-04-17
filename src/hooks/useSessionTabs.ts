import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Metrics, Session, Settings } from '../types';

type Tab = { id: number; sessionId: number; title: string };

type UseSessionTabsParams = {
  tabs: Tab[];
  activeSessionId: number | null;
  setTabs: Dispatch<SetStateAction<Tab[]>>;
  setActiveSessionId: Dispatch<SetStateAction<number | null>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setMetricsBySession: Dispatch<SetStateAction<Record<number, Metrics>>>;
  settings: Settings | null;
  activeSessionIdRef: MutableRefObject<number | null>;
  tabsRef: MutableRefObject<Tab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  settingsRef: MutableRefObject<Settings | null>;
  nextTabIdRef: MutableRefObject<number>;
  disconnectedByTabRef: MutableRefObject<Map<number, boolean>>;
  reconnectingTabRef: MutableRefObject<Set<number>>;
  attachTerminal: (sessionId: number, settings: Settings) => void;
  setPausedOutput: Dispatch<SetStateAction<boolean>>;
  askPassword: (message: string, title?: string) => Promise<string | null>;
  showAlert: (message: string, title?: string) => Promise<void>;
  isAuthError: (message: string) => boolean;
};

export function useSessionTabs(params: UseSessionTabsParams) {
  const {
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
  } = params;

  const reconnectTab = async (tabId: number) => {
    if (reconnectingTabRef.current.has(tabId)) return;
    const tab = tabsRef.current.find((it) => it.id === tabId);
    if (!tab) return;
    const session = sessionsRef.current.find((it) => it.id === tab.sessionId);
    if (!session) return;
    reconnectingTabRef.current.add(tabId);
    try {
      await window.terminalApi.sshConnect({ sessionId: session.id, connectionId: tabId });
      disconnectedByTabRef.current.set(tabId, false);
      if (settingsRef.current) attachTerminal(tabId, settingsRef.current);
      if (activeSessionIdRef.current === tabId) setPausedOutput(false);
      return;
    } catch (error) {
      const message = String(error);
      if (!isAuthError(message)) {
        disconnectedByTabRef.current.set(tabId, true);
        return;
      }
      let retryCount = 0;
      while (true) {
        const retryPassword = await askPassword(
          `会话 ${session.name} 认证失败。\n已重试 ${retryCount} 次，请输入密码继续（取消可终止重连）。`,
          '重连认证',
        );
        if (!retryPassword) {
          disconnectedByTabRef.current.set(tabId, true);
          return;
        }
        retryCount += 1;
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
          disconnectedByTabRef.current.set(tabId, false);
          if (settingsRef.current) attachTerminal(tabId, settingsRef.current);
          if (activeSessionIdRef.current === tabId) setPausedOutput(false);
          return;
        } catch (retryError) {
          const retryMessage = String(retryError);
          if (!isAuthError(retryMessage)) {
            disconnectedByTabRef.current.set(tabId, true);
            return;
          }
        }
      }
    } finally {
      reconnectingTabRef.current.delete(tabId);
    }
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
      disconnectedByTabRef.current.set(tabId, false);
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
      let retryCount = 0;
      while (true) {
        const retryPassword = await askPassword(
          `会话 ${session.name} 认证失败。\n已重试 ${retryCount} 次，请输入密码继续（取消可终止连接）。`,
          '连接认证',
        );
        if (!retryPassword) {
          setTabs((prev) => prev.filter((it) => it.id !== tabId));
          if (activeSessionId === tabId) setActiveSessionId(null);
          await showAlert(`已取消连接，累计重试 ${retryCount} 次。`, '连接已取消');
          return;
        }
        retryCount += 1;
        try {
          await window.terminalApi.sshConnect({
            sessionId: session.id,
            connectionId: tabId,
            password: retryPassword,
            savePassword: true,
          });
          disconnectedByTabRef.current.set(tabId, false);
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
          return;
        } catch (retryError) {
          const retryMessage = String(retryError);
          if (!isAuthError(retryMessage)) {
            setTabs((prev) => prev.filter((it) => it.id !== tabId));
            if (activeSessionId === tabId) setActiveSessionId(null);
            await showAlert(retryMessage, '连接失败');
            return;
          }
        }
      }
    }
  };

  const closeTab = async (tabId: number) => {
    await window.terminalApi.sshDisconnect(tabId).catch(() => null);
    reconnectingTabRef.current.delete(tabId);
    disconnectedByTabRef.current.delete(tabId);
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

  return {
    reconnectTab,
    connectSession,
    closeTab,
  };
}
