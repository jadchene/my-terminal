import { useCallback, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import type { MutableRefObject } from 'react';
import type { Settings } from '../types';
import { normalizeTerminalDataInput } from '../utils/terminalInput';
import { getTerminalSelectionText } from '../utils/terminalSelection';

const MAX_TERMINAL_WRITE_CHUNK = 64 * 1024;
const IMMEDIATE_TERMINAL_WRITE_CHUNK = 2 * 1024;

function canWriteImmediately(data: string): boolean {
  return data.length <= IMMEDIATE_TERMINAL_WRITE_CHUNK && !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(data);
}

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
  const fitFrameRef = useRef<Map<number, number>>(new Map());
  const stabilizedFitTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>[]>>(new Map());
  const pausedByScrollRef = useRef<Map<number, boolean>>(new Map());
  const pendingOutputRef = useRef<Map<number, string>>(new Map());
  const pendingWriteRef = useRef<Map<number, string>>(new Map());
  const pendingWriteFrameRef = useRef<Map<number, number>>(new Map());
  const pauseSyncFrameRef = useRef<Map<number, number>>(new Map());
  const pendingInputRef = useRef<Map<number, string>>(new Map());
  const pendingInputTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const reconnectHandlerRef = useRef<((tabId: number) => void) | null>(null);
  const autoCopySelectionRef = useRef<Map<number, boolean>>(new Map());
  const selectionCopyTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const lastCopiedSelectionRef = useRef<Map<number, string>>(new Map());
  const [pausedOutput, setPausedOutput] = useState(false);

  const setReconnectHandler = useCallback((handler: (tabId: number) => void) => {
    reconnectHandlerRef.current = handler;
  }, []);

  const flushPendingInput = useCallback((sessionId: number) => {
    const timer = pendingInputTimerRef.current.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      pendingInputTimerRef.current.delete(sessionId);
    }
    const input = pendingInputRef.current.get(sessionId);
    if (!input) return;
    pendingInputRef.current.delete(sessionId);
    void Promise.resolve(sendInput({ sessionId, input })).catch((error) => {
      console.warn('[Terminal] Failed to send input:', error);
    });
  }, [sendInput]);

  const queueInput = useCallback((sessionId: number, input: string, flushNow = false) => {
    const current = pendingInputRef.current.get(sessionId) || '';
    pendingInputRef.current.set(sessionId, current + input);
    if (flushNow) {
      flushPendingInput(sessionId);
      return;
    }
    if (pendingInputTimerRef.current.has(sessionId)) return;
    const timer = setTimeout(() => flushPendingInput(sessionId), 4);
    pendingInputTimerRef.current.set(sessionId, timer);
  }, [flushPendingInput]);

  const scheduleSelectionCopy = useCallback((sessionId: number, term: Terminal) => {
    const oldTimer = selectionCopyTimerRef.current.get(sessionId);
    if (oldTimer) {
      clearTimeout(oldTimer);
      selectionCopyTimerRef.current.delete(sessionId);
    }
    if (!autoCopySelectionRef.current.get(sessionId)) return;
    const selected = getTerminalSelectionText(term);
    if (!selected) return;
    const timer = setTimeout(async () => {
      selectionCopyTimerRef.current.delete(sessionId);
      if (!autoCopySelectionRef.current.get(sessionId)) return;
      const latest = getTerminalSelectionText(term);
      if (!latest || latest === lastCopiedSelectionRef.current.get(sessionId)) return;
      try {
        await navigator.clipboard.writeText(latest);
        lastCopiedSelectionRef.current.set(sessionId, latest);
      } catch (error) {
        console.warn('[Terminal] Failed to copy selection:', error);
      } finally {
        if (activeSessionIdRef.current === sessionId) {
          requestAnimationFrame(() => term.focus());
        }
      }
    }, 80);
    selectionCopyTimerRef.current.set(sessionId, timer);
  }, [activeSessionIdRef]);

  const isAtBottom = useCallback((term: Terminal): boolean => term.buffer.active.viewportY >= term.buffer.active.baseY, []);

  const appendPendingOutput = useCallback((sessionId: number, data: string) => {
    const old = pendingOutputRef.current.get(sessionId) || '';
    pendingOutputRef.current.set(sessionId, old + data);
  }, []);

  const writeTerminalOutput = useCallback((sessionId: number, data: string, term?: Terminal) => {
    const target = term ?? terminalMapRef.current.get(sessionId);
    if (!target || !data) return;
    if (
      canWriteImmediately(data) &&
      !pendingWriteRef.current.has(sessionId) &&
      !pendingWriteFrameRef.current.has(sessionId)
    ) {
      target.write(data);
      return;
    }
    const old = pendingWriteRef.current.get(sessionId) || '';
    pendingWriteRef.current.set(sessionId, old + data);
    if (pendingWriteFrameRef.current.has(sessionId)) return;
    const frame = requestAnimationFrame(function flushFrame() {
      pendingWriteFrameRef.current.delete(sessionId);
      const pending = pendingWriteRef.current.get(sessionId);
      if (!pending) return;
      const chunk = pending.slice(0, MAX_TERMINAL_WRITE_CHUNK);
      const rest = pending.slice(MAX_TERMINAL_WRITE_CHUNK);
      if (rest) {
        pendingWriteRef.current.set(sessionId, rest);
        const nextFrame = requestAnimationFrame(flushFrame);
        pendingWriteFrameRef.current.set(sessionId, nextFrame);
      } else {
        pendingWriteRef.current.delete(sessionId);
      }
      const current = terminalMapRef.current.get(sessionId);
      if (current) current.write(chunk);
    });
    pendingWriteFrameRef.current.set(sessionId, frame);
  }, []);

  const flushPendingOutput = useCallback((sessionId: number, term?: Terminal) => {
    const target = term ?? terminalMapRef.current.get(sessionId);
    if (!target) return;
    const pending = pendingOutputRef.current.get(sessionId);
    if (!pending) return;
    pendingOutputRef.current.delete(sessionId);
    writeTerminalOutput(sessionId, pending, target);
  }, [writeTerminalOutput]);

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
    if (target.buffer.active.type === 'alternate') {
      const current = pausedByScrollRef.current.get(sessionId) || false;
      if (current) setPausedByScroll(sessionId, false, target);
      return;
    }
    const paused = !isAtBottom(target);
    const current = pausedByScrollRef.current.get(sessionId) || false;
    if (paused !== current) {
      setPausedByScroll(sessionId, paused, target);
    }
  }, [isAtBottom, setPausedByScroll]);

  const schedulePauseStateSync = useCallback((sessionId: number, term?: Terminal) => {
    if (pauseSyncFrameRef.current.has(sessionId)) return;
    const frame = requestAnimationFrame(() => {
      pauseSyncFrameRef.current.delete(sessionId);
      syncPauseStateWithViewport(sessionId, term);
    });
    pauseSyncFrameRef.current.set(sessionId, frame);
  }, [syncPauseStateWithViewport]);

  const runFitTerminal = useCallback((sessionId: number) => {
    const fit = fitMapRef.current.get(sessionId);
    if (fit) fit.fit();
  }, []);

  const fitTerminal = useCallback((sessionId: number) => {
    if (fitFrameRef.current.has(sessionId)) return;
    const frame = requestAnimationFrame(() => {
      fitFrameRef.current.delete(sessionId);
      runFitTerminal(sessionId);
    });
    fitFrameRef.current.set(sessionId, frame);
  }, [runFitTerminal]);

  const fitTerminalStabilized = useCallback((sessionId: number) => {
    const oldTimers = stabilizedFitTimerRef.current.get(sessionId) || [];
    oldTimers.forEach((timer) => clearTimeout(timer));
    stabilizedFitTimerRef.current.delete(sessionId);
    fitTerminal(sessionId);
    requestAnimationFrame(() => fitTerminal(sessionId));
    const timers = [
      setTimeout(() => fitTerminal(sessionId), 80),
      setTimeout(() => {
        fitTerminal(sessionId);
        stabilizedFitTimerRef.current.delete(sessionId);
      }, 220),
    ];
    stabilizedFitTimerRef.current.set(sessionId, timers);
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
      term.onData((input) => {
        if (!runtimeTerm) return;
        if (disconnectedByTabRef.current.get(sessionId)) {
          if (input.toLowerCase() === 'r') {
            reconnectHandlerRef.current?.(sessionId);
          }
          return;
        }
        const paused = pausedByScrollRef.current.get(sessionId) || false;
        if (paused && (input === '\r' || input === '\n')) {
          runtimeTerm.scrollToBottom();
          setPausedByScroll(sessionId, false, runtimeTerm);
          schedulePauseStateSync(sessionId, runtimeTerm);
          return;
        }
        if (paused) return;
        const normalizedInput = normalizeTerminalDataInput(input);
        queueInput(
          sessionId,
          normalizedInput,
          normalizedInput.length <= 1 || normalizedInput.includes('\r') || normalizedInput.includes('\n'),
        );
      });
      term.onResize(({ cols, rows }) => {
        resizePty({ sessionId, cols, rows }).catch(() => null);
      });
      term.onSelectionChange(() => {
        if (!runtimeTerm) return;
        scheduleSelectionCopy(sessionId, runtimeTerm);
      });
      term.onScroll(() => {
        schedulePauseStateSync(sessionId, runtimeTerm);
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
    setPausedByScroll,
    schedulePauseStateSync,
    queueInput,
  ]);

  return {
    terminalContainerRef,
    terminalMapRef,
    pausedOutput,
    setPausedOutput,
    appendPendingOutput,
    flushPendingOutput,
    writeTerminalOutput,
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
