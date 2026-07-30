import { memo, useRef, type MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { Settings } from '../types';
import { hasMultilineInput, prepareTerminalPaste } from '../utils/terminalInput';
import { getTerminalSelectionText } from '../utils/terminalSelection';

type TerminalZoneProps = {
  activeSessionId: number | null;
  pausedOutput: boolean;
  settings: Settings;
  terminalContainerRef: MutableRefObject<HTMLDivElement | null>;
  terminalMapRef: MutableRefObject<Map<number, Terminal>>;
  syncPauseStateWithViewport: (sessionId: number, term?: Terminal) => void;
  askConfirm: (message: string, title?: string) => Promise<boolean>;
  showAlert: (message: string, title?: string) => Promise<void>;
};

function TerminalZoneInner(props: TerminalZoneProps) {
  const {
    activeSessionId,
    pausedOutput,
    settings,
    terminalContainerRef,
    terminalMapRef,
    syncPauseStateWithViewport,
    askConfirm,
    showAlert,
  } = props;
  const pauseSyncFrameRef = useRef<number | null>(null);

  const switchToEnglishInputMethod = () => {
    if (!settings.behavior.autoSwitchEnglishInputMethod) return;
    void window.terminalApi.switchToEnglishInputMethod();
  };

  const scheduleViewportPauseSync = () => {
    if (!activeSessionId || pauseSyncFrameRef.current != null) return;
    const term = terminalMapRef.current.get(activeSessionId);
    if (!term) return;
    pauseSyncFrameRef.current = requestAnimationFrame(() => {
      pauseSyncFrameRef.current = null;
      syncPauseStateWithViewport(activeSessionId, term);
    });
  };

  const pasteClipboardText = async (text: string) => {
    if (!activeSessionId || !text) return;
    const term = terminalMapRef.current.get(activeSessionId);
    if (settings.behavior.multilineWarning && hasMultilineInput(text)) {
      if (!(await askConfirm('检测到多行内容，确认粘贴到终端吗？'))) return;
    }
    try {
      await window.terminalApi.sshSend({
        sessionId: activeSessionId,
        input: prepareTerminalPaste(text, !!term?.modes.bracketedPasteMode),
      });
      term?.focus();
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : String(error), '粘贴失败');
    }
  };

  return (
    <section className="terminal-zone">
      {activeSessionId && pausedOutput && <div className="pause-banner">已暂停输出，滚动到底部或按回车继续</div>}
      <div
        ref={terminalContainerRef}
        className="terminal-container"
        onFocus={switchToEnglishInputMethod}
        onMouseDown={switchToEnglishInputMethod}
        onPasteCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const text = event.clipboardData.getData('text');
          void pasteClipboardText(text);
        }}
        onCopyCapture={(event) => {
          if (!activeSessionId) return;
          const term = terminalMapRef.current.get(activeSessionId);
          if (!term?.hasSelection()) return;
          const selected = getTerminalSelectionText(term);
          if (!selected) return;
          event.clipboardData.setData('text/plain', selected);
          event.preventDefault();
          void window.terminalApi.writeClipboardText(selected);
          requestAnimationFrame(() => term.focus());
        }}
        onWheel={scheduleViewportPauseSync}
        onMouseUp={scheduleViewportPauseSync}
        onContextMenu={async (event) => {
          event.preventDefault();
          if (!activeSessionId || !settings.behavior.rightClickPaste) return;
          let text = '';
          try {
            text = await navigator.clipboard.readText();
          } catch (error) {
            await showAlert(error instanceof Error ? error.message : String(error), '读取剪贴板失败');
            return;
          }
          await pasteClipboardText(text);
        }}
      />
    </section>
  );
}

export const TerminalZone = memo(TerminalZoneInner);
