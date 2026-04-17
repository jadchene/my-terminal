import { ArrowUp, Download, Eye, EyeOff, File as FileIcon, Folder as FolderIcon, FolderPlus, RefreshCw, TerminalSquare, Upload } from 'lucide-react';
import type { SftpItem } from '../types';
import { TransferList } from './TransferList';

type TransferRow = {
  key: string;
  batchId: string;
  sessionId: number;
  direction: 'upload' | 'download';
  index: number;
  totalCount: number;
  name: string;
  percent: number;
  transferred: number;
  total: number;
  status: 'running' | 'done' | 'error' | 'cancelled';
};

type SftpPanelProps = {
  activeSessionId: number | null;
  hasActiveSession: boolean;
  showHiddenFiles: boolean;
  sftpPath: string;
  sftpPathInput: string;
  sftpItems: SftpItem[];
  selectedSftpPaths: string[];
  dropOver: boolean;
  transferRows: TransferRow[];
  formatSftpMeta: (item: SftpItem) => string;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => Promise<void>;
  onToggleShowHidden: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onGoParent: () => Promise<void>;
  onFollowCwd: () => Promise<void>;
  onCreateDir: () => Promise<void>;
  onBatchUpload: () => Promise<void>;
  onBatchDownload: () => Promise<void>;
  onPathInputChange: (value: string) => void;
  onPathSubmit: () => Promise<void>;
  onPathBlur: () => void;
  onStartItemDrag: (e: React.DragEvent<HTMLDivElement>, fullPath: string) => void;
  onEndItemDrag: () => void;
  onOpenItemMenu: (e: React.MouseEvent, payload: { path: string; name: string; isDir: boolean }) => void;
  onToggleItemSelect: (fullPath: string, checked: boolean) => void;
  onOpenDir: (nextPath: string) => Promise<void>;
  onCancelTransfer: (row: TransferRow) => void;
};

export function SftpPanel(props: SftpPanelProps) {
  const {
    activeSessionId,
    hasActiveSession,
    showHiddenFiles,
    sftpPath,
    sftpPathInput,
    sftpItems,
    selectedSftpPaths,
    dropOver,
    transferRows,
    formatSftpMeta,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onToggleShowHidden,
    onRefresh,
    onGoParent,
    onFollowCwd,
    onCreateDir,
    onBatchUpload,
    onBatchDownload,
    onPathInputChange,
    onPathSubmit,
    onPathBlur,
    onStartItemDrag,
    onEndItemDrag,
    onOpenItemMenu,
    onToggleItemSelect,
    onOpenDir,
    onCancelTransfer,
  } = props;

  return (
    <div
      className={`sftp-sidebar-content panel-content ${activeSessionId ? '' : 'panel-empty-host'} ${dropOver ? 'drop-over' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        void onDrop(e);
      }}
    >
      {activeSessionId ? (
        <>
          <div className="sidebar-actions">
            <button className="icon-btn top-icon-btn" title={showHiddenFiles ? '隐藏文件' : '显示隐藏文件'} onClick={() => void onToggleShowHidden()}>
              {showHiddenFiles ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
            </button>
            <button className="icon-btn top-icon-btn" title="刷新" onClick={() => void onRefresh()}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <button className="icon-btn top-icon-btn" title="上级目录" onClick={() => void onGoParent()}>
              <ArrowUp size={16} strokeWidth={1.8} />
            </button>
            <button className="icon-btn top-icon-btn" title="跟随 SSH 当前目录" onClick={() => void onFollowCwd()}>
              <TerminalSquare size={16} strokeWidth={1.8} />
            </button>
            <button className="icon-btn top-icon-btn" title="新建目录" disabled={!hasActiveSession} onClick={() => void onCreateDir()}>
              <FolderPlus size={16} strokeWidth={1.8} />
            </button>
            <button className="icon-btn top-icon-btn" title="批量上传" disabled={!hasActiveSession} onClick={() => void onBatchUpload()}>
              <Upload size={16} strokeWidth={1.8} />
            </button>
            <button
              className="icon-btn top-icon-btn"
              title="批量下载"
              disabled={!hasActiveSession || selectedSftpPaths.length === 0}
              onClick={() => void onBatchDownload()}
            >
              <Download size={16} strokeWidth={1.8} />
            </button>
          </div>
          <div className="path-bar">
            <input
              className="path-input"
              value={sftpPathInput}
              onChange={(e) => onPathInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void onPathSubmit();
              }}
              onBlur={onPathBlur}
              title="输入远程路径并按 Enter 跳转"
            />
          </div>
          <div className="sftp-list">
            {sftpItems.map((item) => {
              const isDir = item.type === 'd';
              const fullPath = `${sftpPath.replace(/\/$/, '')}/${item.name}`;
              return (
                <div
                  key={`${item.name}-${item.modifyTime}`}
                  className="sftp-row"
                  draggable
                  title={formatSftpMeta(item)}
                  onDragStart={(e) => onStartItemDrag(e, fullPath)}
                  onDragEnd={onEndItemDrag}
                  onContextMenu={(e) => onOpenItemMenu(e, { path: fullPath, name: item.name, isDir })}
                >
                  <input
                    type="checkbox"
                    className="sftp-select"
                    checked={selectedSftpPaths.includes(fullPath)}
                    onChange={(e) => onToggleItemSelect(fullPath, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    className="link-btn tree-row-btn"
                    onContextMenu={(e) => onOpenItemMenu(e, { path: fullPath, name: item.name, isDir })}
                    onDoubleClick={() => {
                      if (!isDir) return;
                      const nextPath = `${sftpPath.replace(/\/$/, '')}/${item.name}`;
                      void onOpenDir(nextPath);
                    }}
                  >
                    <span className="sftp-item-icon" aria-hidden="true">
                      {isDir ? <FolderIcon size={14} strokeWidth={1.8} /> : <FileIcon size={14} strokeWidth={1.8} />}
                    </span>
                    {item.name}
                  </button>
                </div>
              );
            })}
          </div>
          <TransferList rows={transferRows} onCancel={onCancelTransfer} />
        </>
      ) : (
        <div className="panel-empty">暂无活动会话</div>
      )}
    </div>
  );
}
