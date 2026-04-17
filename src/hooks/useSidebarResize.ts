import { useEffect, useRef, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react';
import type { Settings } from '../types';

type UseSidebarResizeParams = {
  settings: Settings | null;
  activeSessionId: number | null;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  fitTerminal: (sessionId: number) => void;
  fitTerminalStabilized: (sessionId: number) => void;
};

function clampSidebarWidth(value: number) {
  return Math.max(220, Math.min(520, Math.round(value)));
}

export function useSidebarResize(params: UseSidebarResizeParams) {
  const {
    settings,
    activeSessionId,
    sidebarWidth,
    setSidebarWidth,
    setSettings,
    fitTerminal,
    fitTerminalStabilized,
  } = params;

  const sidebarWidthRef = useRef(300);
  const sidebarResizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!settings) return;
    const next = clampSidebarWidth(settings.ui.sidebarWidth || 300);
    setSidebarWidth(next);
  }, [settings?.ui.sidebarWidth, setSidebarWidth]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const dragging = sidebarResizingRef.current;
      if (!dragging) return;
      const deltaX = event.clientX - dragging.startX;
      const next = clampSidebarWidth(dragging.startWidth + deltaX);
      setSidebarWidth(next);
      if (activeSessionId) fitTerminal(activeSessionId);
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
        .then((saved) => {
          setSettings(saved);
        })
        .catch(() => null);
      if (activeSessionId) fitTerminalStabilized(activeSessionId);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [activeSessionId, settings, fitTerminal, fitTerminalStabilized, setSettings, setSidebarWidth]);

  const startSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!settings?.ui.sidebarVisible) return;
    sidebarResizingRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidthRef.current,
    };
    event.preventDefault();
  };

  return {
    sidebarWidth,
    startSidebarResize,
  };
}
