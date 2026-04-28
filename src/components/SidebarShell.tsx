import { Activity, FolderOpen, FolderTree } from 'lucide-react';
import type { DragEvent, MouseEvent } from 'react';
import type { Folder, Metrics, Session, SftpItem } from '../types';
import { SessionTreePanel } from './SessionTreePanel';
import { SftpPanel } from './SftpPanel';
import { StatusPanel } from './StatusPanel';
import type { TransferRow } from '../hooks/useTransferQueue';

type SidebarShellProps = {
  sidebarTab: 'sessions' | 'sftp' | 'status';
  setSidebarTab: (tab: 'sessions' | 'sftp' | 'status') => void;
  folders: Folder[];
  sessions: Session[];
  expandedFolderIds: Set<number>;
  setExpandedFolderIds: (updater: (prev: Set<number>) => Set<number>) => void;
  connectSession: (session: Session, forceNew?: boolean) => Promise<void>;
  sessionTreeActions: {
    onOpenSessionMenu: (e: MouseEvent, session: Session) => void;
    onOpenFolderMenu: (e: MouseEvent, folder: Folder) => void;
    onCreateFolder: () => void;
    onCreateSession: () => void;
  };
  activeSessionId: number | null;
  activeSession: Session | null;
  settingsShowHiddenFiles: boolean;
  sftpPath: string;
  sftpPathInput: string;
  sftpItems: SftpItem[];
  selectedSftpPaths: string[];
  dropOver: boolean;
  transferRows: TransferRow[];
  formatSftpMeta: (item: SftpItem) => string;
  sftpInteractions: {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent<HTMLDivElement>) => Promise<void>;
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
    onStartItemDrag: (e: DragEvent<HTMLDivElement>, fullPath: string) => void;
    onEndItemDrag: () => void;
    onOpenItemMenu: (e: MouseEvent, payload: { path: string; name: string; isDir: boolean }) => void;
    onToggleItemSelect: (fullPath: string, checked: boolean, range?: boolean) => void;
    onOpenDir: (nextPath: string) => Promise<void>;
  };
  onCancelTransfer: (row: TransferRow) => void;
  currentMetrics: Metrics | null;
};

export function SidebarShell(props: SidebarShellProps) {
  const {
    sidebarTab,
    setSidebarTab,
    folders,
    sessions,
    expandedFolderIds,
    setExpandedFolderIds,
    connectSession,
    sessionTreeActions,
    activeSessionId,
    activeSession,
    settingsShowHiddenFiles,
    sftpPath,
    sftpPathInput,
    sftpItems,
    selectedSftpPaths,
    dropOver,
    transferRows,
    formatSftpMeta,
    sftpInteractions,
    onCancelTransfer,
    currentMetrics,
  } = props;

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`icon-btn top-icon-btn ${sidebarTab === 'sessions' ? 'active-tab-icon' : ''}`}
          title="会话树"
          onClick={() => setSidebarTab('sessions')}
        >
          <FolderTree size={16} strokeWidth={1.8} />
        </button>
        <button
          className={`icon-btn top-icon-btn ${sidebarTab === 'sftp' ? 'active-tab-icon' : ''}`}
          title="SFTP"
          onClick={() => setSidebarTab('sftp')}
        >
          <FolderOpen size={16} strokeWidth={1.8} />
        </button>
        <button
          className={`icon-btn top-icon-btn ${sidebarTab === 'status' ? 'active-tab-icon' : ''}`}
          title="状态"
          onClick={() => setSidebarTab('status')}
        >
          <Activity size={16} strokeWidth={1.8} />
        </button>
      </div>
      {sidebarTab === 'sessions' && (
        <SessionTreePanel
          folders={folders}
          sessions={sessions}
          expandedFolderIds={expandedFolderIds}
          onToggleFolder={(folderId) => {
            setExpandedFolderIds((prev) => {
              const next = new Set(prev);
              if (next.has(folderId)) next.delete(folderId);
              else next.add(folderId);
              return next;
            });
          }}
          onOpenSessionMenu={sessionTreeActions.onOpenSessionMenu}
          onOpenFolderMenu={sessionTreeActions.onOpenFolderMenu}
          onOpenSession={(session) => {
            void connectSession(session, true);
          }}
          onCreateFolder={sessionTreeActions.onCreateFolder}
          onCreateSession={sessionTreeActions.onCreateSession}
        />
      )}
      {sidebarTab === 'sftp' && (
        <SftpPanel
          activeSessionId={activeSessionId}
          hasActiveSession={!!activeSession}
          showHiddenFiles={settingsShowHiddenFiles}
          sftpPath={sftpPath}
          sftpPathInput={sftpPathInput}
          sftpItems={sftpItems}
          selectedSftpPaths={selectedSftpPaths}
          dropOver={dropOver}
          transferRows={transferRows}
          formatSftpMeta={formatSftpMeta}
          onDragEnter={sftpInteractions.onDragEnter}
          onDragOver={sftpInteractions.onDragOver}
          onDragLeave={sftpInteractions.onDragLeave}
          onDrop={sftpInteractions.onDrop}
          onToggleShowHidden={sftpInteractions.onToggleShowHidden}
          onRefresh={sftpInteractions.onRefresh}
          onGoParent={sftpInteractions.onGoParent}
          onFollowCwd={sftpInteractions.onFollowCwd}
          onCreateDir={sftpInteractions.onCreateDir}
          onBatchUpload={sftpInteractions.onBatchUpload}
          onBatchDownload={sftpInteractions.onBatchDownload}
          onPathInputChange={sftpInteractions.onPathInputChange}
          onPathSubmit={sftpInteractions.onPathSubmit}
          onPathBlur={sftpInteractions.onPathBlur}
          onStartItemDrag={sftpInteractions.onStartItemDrag}
          onEndItemDrag={sftpInteractions.onEndItemDrag}
          onOpenItemMenu={sftpInteractions.onOpenItemMenu}
          onToggleItemSelect={sftpInteractions.onToggleItemSelect}
          onOpenDir={sftpInteractions.onOpenDir}
          onCancelTransfer={onCancelTransfer}
        />
      )}
      {sidebarTab === 'status' && <StatusPanel activeSessionId={activeSessionId} currentMetrics={currentMetrics} />}
    </aside>
  );
}
