import { useCallback, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import type { MutableRefObject } from 'react';
import type { Settings } from '../types';
import { normalizeTerminalDataInput } from '../utils/terminalInput';

type UseTerminalRuntimeParams = {
  activeSessionIdRef: MutableRefObject<number | null>;
  disconnectedByTabRef: MutableRefObject<Map<number, boolean>>;
  sendInput: (payload: { sessionId: number; input: string }) => Promise<boolean>;
  resizePty: (payload: { sessionId: number; cols: number; rows: number }) => Promise<boolean>;
};

export function useTerminalRuntime(params: UseTerminalRuntimeParams) {
  const { activeSessionIdRef, disconnectedByTabRef, sendInput, resizePty } = params;
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalMapRef = useRef<Map<number, Terminal>>(new Map());
  const fitMapRef = useRef<Map<number, FitAddon>>(new Map());
  const pausedByScrollRef = useRef<Map<number, boolean>>(new Map());
  const pendingOutputRef = useRef<Map<number, string>>(new Map());
  const reconnectHandlerRef = useRef<((tabId: number) => void) | null>(null);
  const autoCopySelectionRef = useRef<Map<number, boolean>>(new Map());
  const [pausedOutput, setPausedOutput] = useState(false);

  const setReconnectHandler = useCallback((handler: (tabId: number) => void) => {
    reconnectHandlerRef.current = handler;
  }, []);

  const isAtBottom = useCallback((term: Terminal): boolean => term.buffer.active.viewportY >= term.buffer.active.baseY, []);

  const appendPendingOutput = useCallback((sessionId: number, data: string) => {
    const old = pendingOutputRef.current.get(sessionId) || '';
    pendingOutputRef.current.set(sessionId, old + data);
  }, []);

  const flushPendingOutput = useCallback((sessionId: number, term?: Terminal) => {
    const target = term ?? terminalMapRef.current.get(sessionId);
    if (!target) return;
    const pending = pendingOutputRef.current.get(sessionId);
    if (!pending) return;
    pendingOutputRef.current.delete(sessionId);
    target.write(pending);
  }, []);

  const setPausedByScroll = useCallback((sessionId: number, paused: boolean, term?: Terminal) => {
      pausedByScrollRef.current.set(sessionId, paused);
      if (activeSessionIdRef.current === sessionId) {
        setPausedOutput(paused);
      }
      if (!paused) {
        flushPendingOutput(sessionId, term);
      }
    },
    [activeSessionIdRef, flushPendingOutput],
  );

  const syncPauseStateWithViewport = useCallback((sessionId: number, term?: Terminal) => {
    const target = term ?? terminalMapRef.current.get(sessionId);
    if (!target) return;
    const paused = !isAtBottom(target);
    const current = pausedByScrollRef.current.get(sessionId) || false;
    if (paused !== current) {
      setPausedByScroll(sessionId, paused, target);
    }
  }, [isAtBottom, setPausedByScroll]);

  const fitTerminal = useCallback((sessionId: number) => {
    const fit = fitMapRef.current.get(sessionId);
    if (fit) fit.fit();
  }, []);

  const fitTerminalStabilized = useCallback((sessionId: number) => {
    fitTerminal(sessionId);
    requestAnimationFrame(() => fitTerminal(sessionId));
    setTimeout(() => fitTerminal(sessionId), 80);
    setTimeout(() => fitTerminal(sessionId), 220);
  }, [fitTerminal]);

  const focusTerminalInput = useCallback((sessionId: number, autoSwitchEnglishInputMethod = false) => {
    const term = terminalMapRef.current.get(sessionId);
    if (!term) return;
    if (autoSwitchEnglishInputMethod) {
      void window.terminalApi.switchToEnglishInputMethod();
    }
    requestAnimationFrame(() => term.focus());
    setTimeout(() => term.focus(), 30);
  }, []);

  const getPausedByScroll = useCallback((sessionId: number) => pausedByScrollRef.current.get(sessionId) || false, []);

  const attachTerminal = useCallback((sessionId: number, localSettings: Settings) => {
    if (!terminalContainerRef.current) return;
    let term = terminalMapRef.current.get(sessionId);
    let fit = fitMapRef.current.get(sessionId);
    autoCopySelectionRef.current.set(sessionId, !!localSettings.behavior.autoCopySelection);

    if (!term) {
      term = new Terminal({
        fontFamily: localSettings.theme.terminalFontFamily || 'Consolas',
        fontSize: localSettings.theme.terminalFontSize || 16,
        fontWeight: 'bold',
        cursorStyle: localSettings.theme.terminalCursorStyle || 'block',
        cursorBlink: localSettings.theme.terminalCursorBlink ?? true,
        cursorWidth: Math.max(1, Math.min(8, Number(localSettings.theme.terminalCursorWidth || 2))),
        theme: {
          background: localSettings.theme.backgroundColor,
          foreground: localSettings.theme.foregroundColor,
        },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(
        new WebLinksAddon((event, uri) => {
          event.preventDefault();
          void window.terminalApi.openExternal(uri);
        }),
      );
      const runtimeTerm = term;
      term.onData(async (input) => {
        if (!runtimeTerm) return;
        if (disconnectedByTabRef.current.get(sessionId)) {
          if (input.toLowerCase() === 'r') {
            reconnectHandlerRef.current?.(sessionId);
          }
          return;
        }
        syncPauseStateWithViewport(sessionId, runtimeTerm);
        const pausedByViewport = !isAtBottom(runtimeTerm);
        const paused = (pausedByScrollRef.current.get(sessionId) || false) || pausedByViewport;
        if (paused && (input === '\r' || input === '\n')) {
          runtimeTerm.scrollToBottom();
          setPausedByScroll(sessionId, false, runtimeTerm);
          requestAnimationFrame(() => syncPauseStateWithViewport(sessionId, runtimeTerm));
          return;
        }
        if (paused) return;
        await sendInput({ sessionId, input: normalizeTerminalDataInput(input) });
      });
      term.onResize(({ cols, rows }) => {
        resizePty({ sessionId, cols, rows }).catch(() => null);
      });
      term.onSelectionChange(async () => {
        if (!runtimeTerm) return;
        if (!autoCopySelectionRef.current.get(sessionId)) return;
        const selected = runtimeTerm.getSelection();
        if (!selected) return;
        await navigator.clipboard.writeText(selected);
      });
      term.onScroll(() => {
        syncPauseStateWithViewport(sessionId, runtimeTerm);
      });
      terminalMapRef.current.set(sessionId, term);
      fitMapRef.current.set(sessionId, fit);
      pausedByScrollRef.current.set(sessionId, false);
      disconnectedByTabRef.current.set(sessionId, false);
    }

    term.options.fontFamily = localSettings.theme.terminalFontFamily || 'Consolas';
    term.options.fontSize = localSettings.theme.terminalFontSize || 16;
    term.options.fontWeight = 'bold';
    term.options.cursorStyle = localSettings.theme.terminalCursorStyle || 'block';
    term.options.cursorBlink = localSettings.theme.terminalCursorBlink ?? true;
    term.options.cursorWidth = Math.max(1, Math.min(8, Number(localSettings.theme.terminalCursorWidth || 2)));
    term.options.theme = {
      background: localSettings.theme.backgroundColor,
      foreground: localSettings.theme.foregroundColor,
    };

    terminalContainerRef.current.innerHTML = '';
    term.open(terminalContainerRef.current);
    fitTerminalStabilized(sessionId);
    focusTerminalInput(sessionId, !!localSettings.behavior.autoSwitchEnglishInputMethod);
    const paused = !isAtBottom(term);
    setPausedByScroll(sessionId, paused, term);
  }, [
    disconnectedByTabRef,
    focusTerminalInput,
    fitTerminalStabilized,
    isAtBottom,
    resizePty,
    sendInput,
    setPausedByScroll,
    syncPauseStateWithViewport,
  ]);

  return {
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
  };
}
