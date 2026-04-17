import type { MutableRefObject } from 'react';
import type { Terminal } from 'xterm';
import type { Settings } from '../types';

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

  return (
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
          if (!text) return;
          if (settings.behavior.multilineWarning && text.includes('\n')) {
            if (!(await askConfirm('检测到多行内容，确认粘贴到终端吗？'))) return;
          }
          await window.terminalApi.sshSend({ sessionId: activeSessionId, input: text });
        }}
      />
    </section>
  );
}
