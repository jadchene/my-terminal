import type { RefObject } from 'react';
import type { Settings } from '../types';

type SettingsModalProps = {
  show: boolean;
  draft: Settings | null;
  tab: 'appearance' | 'behavior' | 'system';
  cursorStyleMenuOpen: boolean;
  cursorStyleMenuRef: RefObject<HTMLDivElement | null>;
  runtimeInfo: {
    runtimeDir: string;
    userDataPath: string;
    settingsStorage: string;
    dbPath: string;
    os: string;
  } | null;
  onSwitchTab: (tab: 'appearance' | 'behavior' | 'system') => void;
  onToggleCursorMenu: () => void;
  onCloseCursorMenu: () => void;
  onUpdateDraft: (next: Settings) => void;
  onPickDefaultDownloadDir: () => Promise<void>;
  onCancel: () => void;
  onSave: () => Promise<void>;
};

export function SettingsModal(props: SettingsModalProps) {
  const {
    show,
    draft,
    tab,
    cursorStyleMenuOpen,
    cursorStyleMenuRef,
    runtimeInfo,
    onSwitchTab,
    onToggleCursorMenu,
    onCloseCursorMenu,
    onUpdateDraft,
    onPickDefaultDownloadDir,
    onCancel,
    onSave,
  } = props;

  if (!show || !draft) return null;

  return (
    <div className="modal-mask">
      <div className="modal-card settings-modal">
        <h3>设置</h3>
        <div className="settings-tabs">
          <button type="button" className={tab === 'appearance' ? 'active' : ''} onClick={() => onSwitchTab('appearance')}>
            外观
          </button>
          <button type="button" className={tab === 'behavior' ? 'active' : ''} onClick={() => onSwitchTab('behavior')}>
            行为
          </button>
          <button type="button" className={tab === 'system' ? 'active' : ''} onClick={() => onSwitchTab('system')}>
            系统
          </button>
        </div>
        <div className="settings-content-scroll">
          {tab === 'appearance' && (
            <>
              <div className="setting-row">
                <span>会话背景色</span>
                <input
                  type="color"
                  value={draft.theme.backgroundColor}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: { ...draft.theme, backgroundColor: e.target.value },
                    })
                  }
                />
              </div>
              <div className="setting-row">
                <span>会话字体色</span>
                <input
                  type="color"
                  value={draft.theme.foregroundColor}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: { ...draft.theme, foregroundColor: e.target.value },
                    })
                  }
                />
              </div>
              <label>
                界面字体
                <input
                  value={draft.theme.uiFontFamily || ''}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: { ...draft.theme, uiFontFamily: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                界面字号
                <input
                  type="number"
                  min={11}
                  max={24}
                  value={draft.theme.uiFontSize}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: { ...draft.theme, uiFontSize: Number(e.target.value) || 13 },
                    })
                  }
                />
              </label>
              <label>
                会话字体
                <input
                  value={draft.theme.terminalFontFamily || ''}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: { ...draft.theme, terminalFontFamily: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                会话字号
                <input
                  type="number"
                  min={10}
                  max={36}
                  value={draft.theme.terminalFontSize}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: { ...draft.theme, terminalFontSize: Number(e.target.value) || 16 },
                    })
                  }
                />
              </label>
              <label>
                光标样式
                <div className="select-like" ref={cursorStyleMenuRef}>
                  <button type="button" className="select-like-trigger" onClick={onToggleCursorMenu}>
                    <span>
                      {draft.theme.terminalCursorStyle === 'underline'
                        ? '下划线'
                        : draft.theme.terminalCursorStyle === 'bar'
                          ? '竖线'
                          : '块'}
                    </span>
                    <span aria-hidden="true">▾</span>
                  </button>
                  {cursorStyleMenuOpen && (
                    <div className="select-like-menu">
                      <button
                        type="button"
                        className={draft.theme.terminalCursorStyle === 'block' ? 'active' : ''}
                        onClick={() => {
                          onUpdateDraft({
                            ...draft,
                            theme: { ...draft.theme, terminalCursorStyle: 'block' },
                          });
                          onCloseCursorMenu();
                        }}
                      >
                        块
                      </button>
                      <button
                        type="button"
                        className={draft.theme.terminalCursorStyle === 'underline' ? 'active' : ''}
                        onClick={() => {
                          onUpdateDraft({
                            ...draft,
                            theme: { ...draft.theme, terminalCursorStyle: 'underline' },
                          });
                          onCloseCursorMenu();
                        }}
                      >
                        下划线
                      </button>
                      <button
                        type="button"
                        className={draft.theme.terminalCursorStyle === 'bar' ? 'active' : ''}
                        onClick={() => {
                          onUpdateDraft({
                            ...draft,
                            theme: { ...draft.theme, terminalCursorStyle: 'bar' },
                          });
                          onCloseCursorMenu();
                        }}
                      >
                        竖线
                      </button>
                    </div>
                  )}
                </div>
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.theme.terminalCursorBlink}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: { ...draft.theme, terminalCursorBlink: e.target.checked },
                    })
                  }
                />
                光标闪烁
              </label>
              <label>
                竖线光标宽度
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={draft.theme.terminalCursorWidth ?? 2}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      theme: {
                        ...draft.theme,
                        terminalCursorWidth: Math.max(1, Math.min(8, Number(e.target.value) || 2)),
                      },
                    })
                  }
                />
              </label>
            </>
          )}

          {tab === 'behavior' && (
            <>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.behavior.autoCopySelection}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      behavior: { ...draft.behavior, autoCopySelection: e.target.checked },
                    })
                  }
                />
                选中自动复制
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.behavior.rightClickPaste}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      behavior: { ...draft.behavior, rightClickPaste: e.target.checked },
                    })
                  }
                />
                右键自动粘贴
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.behavior.multilineWarning}
                  onChange={(e) =>
                    onUpdateDraft({
                      ...draft,
                      behavior: { ...draft.behavior, multilineWarning: e.target.checked },
                    })
                  }
                />
                多行预警
              </label>
              <label>
                默认下载目录
                <div className="path-picker">
                  <input
                    value={draft.behavior.defaultDownloadDir || ''}
                    placeholder="留空则使用系统下载目录"
                    onChange={(e) =>
                      onUpdateDraft({
                        ...draft,
                        behavior: { ...draft.behavior, defaultDownloadDir: e.target.value },
                      })
                    }
                  />
                  <button type="button" onClick={() => void onPickDefaultDownloadDir()}>
                    选择
                  </button>
                </div>
              </label>
            </>
          )}

          {tab === 'system' && (
            <div className="runtime-note">
              <div className="runtime-title">运行时路径</div>
              <div>userData: {runtimeInfo?.userDataPath}</div>
              <div>配置存储: {runtimeInfo?.settingsStorage}</div>
              <div>数据库文件: {runtimeInfo?.dbPath}</div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>取消</button>
          <button onClick={() => void onSave()}>保存</button>
        </div>
      </div>
    </div>
  );
}
