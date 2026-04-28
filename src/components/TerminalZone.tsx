import type { MutableRefObject } from 'react';
import type { Terminal } from 'xterm';
import type { Settings } from '../types';
import { hasMultilineInput, normalizeTerminalPaste } from '../utils/terminalInput';

type TerminalZoneProps = {
  activeSessionId: number | null;
  pausedOutput: boolean;
  settings: Settings;
  terminalContainerRef: MutableRefObject<HTMLDivElement | null>;
  terminalMapRef: MutableRefObject<Map<number, Terminal>>;
  syncPauseStateWithViewport: (sessionId: number, term?: Terminal) => void;
  askConfirm: (message: string, title?: string) => Promise<boolean>;
};

export function TerminalZone(props: TerminalZoneProps) {
  const {
    activeSessionId,
    pausedOutput,
    settings,
    terminalContainerRef,
    terminalMapRef,
    syncPauseStateWithViewport,
    askConfirm,
  } = props;

  const switchToEnglishInputMethod = () => {
    if (!settings.behavior.autoSwitchEnglishInputMethod) return;
    void window.terminalApi.switchToEnglishInputMethod();
  };

  const pasteClipboardText = async (text: string) => {
    if (!activeSessionId || !text) return;
    if (settings.behavior.multilineWarning && hasMultilineInput(text)) {
      if (!(await askConfirm('检测到多行内容，确认粘贴到终端吗？'))) return;
    }
    await window.terminalApi.sshSend({ sessionId: activeSessionId, input: normalizeTerminalPaste(text) });
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
        onWheel={() => {
          if (!activeSessionId) return;
          const term = terminalMapRef.current.get(activeSessionId);
          if (!term) return;
          requestAnimationFrame(() => {
            syncPauseStateWithViewport(activeSessionId, term);
          });
        }}
        onMouseUp={() => {
          if (!activeSessionId) return;
          const term = terminalMapRef.current.get(activeSessionId);
          if (!term) return;
          requestAnimationFrame(() => {
            syncPauseStateWithViewport(activeSessionId, term);
          });
        }}
        onContextMenu={async (event) => {
          event.preventDefault();
          if (!activeSessionId || !settings.behavior.rightClickPaste) return;
          const text = await navigator.clipboard.readText();
          await pasteClipboardText(text);
        }}
      />
    </section>
  );
}
