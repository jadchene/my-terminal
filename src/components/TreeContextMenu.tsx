import type { TreeContextMenu as TreeContextMenuState } from '../types';

type TreeContextMenuProps = {
  menu: TreeContextMenuState | null;
  onCopySession: (menu: Extract<TreeContextMenuState, { type: 'session' }>) => Promise<void>;
  onEditSession: (menu: Extract<TreeContextMenuState, { type: 'session' }>) => void;
  onDeleteSession: (menu: Extract<TreeContextMenuState, { type: 'session' }>) => Promise<void>;
  onCreateSessionInFolder: (menu: Extract<TreeContextMenuState, { type: 'folder' }>) => void;
  onCreateFolderInFolder: (menu: Extract<TreeContextMenuState, { type: 'folder' }>) => void;
  onEditFolder: (menu: Extract<TreeContextMenuState, { type: 'folder' }>) => Promise<void>;
  onDeleteFolder: (menu: Extract<TreeContextMenuState, { type: 'folder' }>) => Promise<void>;
  onDownloadSftp: (menu: Extract<TreeContextMenuState, { type: 'sftp' }>) => Promise<void>;
  onRenameSftp: (menu: Extract<TreeContextMenuState, { type: 'sftp' }>) => Promise<void>;
  onDeleteSftp: (menu: Extract<TreeContextMenuState, { type: 'sftp' }>) => Promise<void>;
};

export function TreeContextMenu(props: TreeContextMenuProps) {
  const {
    menu,
    onCopySession,
    onEditSession,
    onDeleteSession,
    onCreateSessionInFolder,
    onCreateFolderInFolder,
    onEditFolder,
    onDeleteFolder,
    onDownloadSftp,
    onRenameSftp,
    onDeleteSftp,
  } = props;
  if (!menu) return null;

  return (
    <div className="tree-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      {menu.type === 'session' ? (
        <>
          <button onClick={() => void onCopySession(menu)}>复制</button>
          <button onClick={() => onEditSession(menu)}>编辑</button>
          <button className="danger" onClick={() => void onDeleteSession(menu)}>
            删除
          </button>
        </>
      ) : menu.type === 'folder' ? (
        <>
          <button onClick={() => onCreateSessionInFolder(menu)}>新增会话</button>
          <button onClick={() => onCreateFolderInFolder(menu)}>新增目录</button>
          <button onClick={() => void onEditFolder(menu)}>编辑</button>
          <button className="danger" onClick={() => void onDeleteFolder(menu)}>
            删除
          </button>
        </>
      ) : (
        <>
          <button onClick={() => void onDownloadSftp(menu)}>下载</button>
          <button onClick={() => void onRenameSftp(menu)}>重命名</button>
          <button className="danger" onClick={() => void onDeleteSftp(menu)}>
            删除
          </button>
        </>
      )}
    </div>
  );
}
