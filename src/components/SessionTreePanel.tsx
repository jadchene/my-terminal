import { DownOutlined, FolderAddOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Empty, Tooltip } from 'antd';
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

const compareByNameThenId = (a: { name: string; id: number }, b: { name: string; id: number }): number => {
  const byName = a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
  if (byName !== 0) return byName;
  return a.id - b.id;
};

export const SessionTreePanel = (props: SessionTreePanelProps) => {
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
              {expandedFolderIds.has(folder.id) ? <DownOutlined /> : <RightOutlined />}
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
        <Tooltip title="新建目录"><Button type="text" size="small" icon={<FolderAddOutlined />} onClick={onCreateFolder} /></Tooltip>
        <Tooltip title="新建会话"><Button type="text" size="small" icon={<PlusOutlined />} onClick={onCreateSession} /></Tooltip>
      </div>
      <div className="tree-scroll">
        {sessions.length === 0 && folders.length === 0
          ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" />
          : <>{renderSessionList(null)}{renderFolderTree(null)}</>}
      </div>
    </div>
  );
};
