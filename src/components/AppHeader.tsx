import { Copy, Menu, Minus, PanelLeftClose, Square, X } from 'lucide-react';

type Tab = { id: number; sessionId: number; title: string };

type AppHeaderProps = {
  tabs: Tab[];
  activeSessionId: number | null;
  menuOpen: boolean;
  isMaximized: boolean;
  sidebarVisible: boolean;
  onSelectTab: (tabId: number) => void;
  onCloseTab: (tabId: number) => void;
  onToggleMenu: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onCloseWindow: () => void;
};

export function AppHeader(props: AppHeaderProps) {
  const {
    tabs,
    activeSessionId,
    menuOpen,
    isMaximized,
    sidebarVisible,
    onSelectTab,
    onCloseTab,
    onToggleMenu,
    onOpenSettings,
    onToggleSidebar,
    onMinimize,
    onToggleMaximize,
    onCloseWindow,
  } = props;

  return (
    <header className="title-bar">
      <div className="tabs-row">
        {tabs.map((tab) => (
          <div key={tab.id} className={`tab-item ${tab.id === activeSessionId ? 'active' : ''}`}>
            <button className="tab-title-btn" onClick={() => onSelectTab(tab.id)}>
              {tab.title}
            </button>
            <button
              className="tab-close-btn"
              title="关闭会话"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>

      <div className="right-controls">
        <div className="menu-wrap">
          <button className="icon-btn top-icon-btn" onClick={onToggleMenu} title="菜单">
            <Menu size={16} strokeWidth={1.8} />
          </button>
          {menuOpen && (
            <div className="dropdown dropdown-right">
              <button onClick={onOpenSettings}>设置</button>
            </div>
          )}
        </div>
        <button className="icon-btn top-icon-btn" title={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} onClick={onToggleSidebar}>
          <PanelLeftClose size={16} strokeWidth={1.8} />
        </button>
        <div className="window-controls">
          <button onClick={onMinimize} title="最小化">
            <Minus size={14} strokeWidth={1.8} />
          </button>
          <button onClick={onToggleMaximize} title={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? <Copy size={14} strokeWidth={1.8} /> : <Square size={14} strokeWidth={1.8} />}
          </button>
          <button onClick={onCloseWindow} title="关闭">
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
}
