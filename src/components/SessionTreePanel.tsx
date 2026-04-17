import { ChevronDown, ChevronRight, FolderPlus, TerminalSquare } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { ReactNode } from 'react';
import type { Folder, Session } from '../types';

type SessionTreePanelProps = {
  folders: Folder[];
  sessions: Session[];
  expandedFolderIds: Set<number>;
  onToggleFolder: (folderId: number) => void;
  onOpenSessionMenu: (e: MouseEvent, session: Session) => void;
  onOpenFolderMenu: (e: MouseEvent, folder: Folder) => void;
  onOpenSession: (session: Session) => void;
  onCreateFolder: () => void;
  onCreateSession: () => void;
};

function compareByNameThenId(a: { name: string; id: number }, b: { name: string; id: number }): number {
  const byName = a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
  if (byName !== 0) return byName;
  return a.id - b.id;
}

export function SessionTreePanel(props: SessionTreePanelProps) {
  const {
    folders,
    sessions,
    expandedFolderIds,
    onToggleFolder,
    onOpenSessionMenu,
    onOpenFolderMenu,
    onOpenSession,
    onCreateFolder,
    onCreateSession,
  } = props;

  const renderSessionList = (folderId: number | null): ReactNode[] =>
    sessions
      .filter((session) => session.folder_id === folderId)
      .sort(compareByNameThenId)
      .map((session) => (
        <div key={session.id} className="session-node" onContextMenu={(e) => onOpenSessionMenu(e, session)}>
          <button className="link-btn tree-row-btn" onContextMenu={(e) => onOpenSessionMenu(e, session)} onClick={() => null} onDoubleClick={() => onOpenSession(session)}>
            {session.name}
          </button>
        </div>
      ));

  const renderFolderTree = (parentId: number | null): ReactNode[] =>
    folders
      .filter((folder) => folder.parent_id === parentId)
      .sort(compareByNameThenId)
      .map((folder) => (
        <div key={folder.id} className="folder-node">
          <div className="folder-title" onClick={() => onToggleFolder(folder.id)} onContextMenu={(e) => onOpenFolderMenu(e, folder)}>
            <span className="folder-toggle-icon" aria-hidden="true">
              {expandedFolderIds.has(folder.id) ? <ChevronDown size={14} strokeWidth={1.8} /> : <ChevronRight size={14} strokeWidth={1.8} />}
            </span>
            {folder.name}
          </div>
          {expandedFolderIds.has(folder.id) && (
            <div className="folder-children">
              {renderSessionList(folder.id)}
              {renderFolderTree(folder.id)}
            </div>
          )}
        </div>
      ));

  return (
    <div className="tree-content panel-content">
      <div className="sidebar-actions">
        <button className="icon-btn top-icon-btn" title="新建目录" onClick={onCreateFolder}>
          <FolderPlus size={16} strokeWidth={1.8} />
        </button>
        <button className="icon-btn top-icon-btn" title="新建会话" onClick={onCreateSession}>
          <TerminalSquare size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="tree-scroll">
        {renderSessionList(null)}
        {renderFolderTree(null)}
      </div>
    </div>
  );
}
