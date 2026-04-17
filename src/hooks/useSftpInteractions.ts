import { type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Session, Settings, TreeContextMenu } from '../types';
import { getParentSftpPath } from '../utils/sftpPath';

type SftpMenuPayload = Extract<TreeContextMenu, { type: 'sftp' }>;

type UseSftpInteractionsParams = {
  activeSessionId: number | null;
  activeSession: Session | null;
  settings: Settings | null;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  sftpPath: string;
  selectedSftpPaths: string[];
  setSftpPathInput: Dispatch<SetStateAction<string>>;
  setSftpUploadDropOver: Dispatch<SetStateAction<boolean>>;
  setSftpDownloadDropOver: Dispatch<SetStateAction<boolean>>;
  setTreeMenu: Dispatch<SetStateAction<TreeContextMenu | null>>;
  sftpInternalDragRef: MutableRefObject<boolean>;
  refreshSftp: (targetPath?: string) => Promise<void>;
  navigateSftp: (nextPath: string) => Promise<void>;
  clearSftpSelectionNow: () => void;
  getLocalPathsFromDrop: (event: React.DragEvent) => string[];
  getSftpPathsFromDrag: (event: React.DragEvent) => string[];
  submitSftpPath: () => Promise<void>;
  setSftpSelection: (fullPath: string, checked: boolean) => void;
  showAlert: (message: string, title?: string) => Promise<void>;
  askPrompt: (message: string, initialValue?: string, title?: string) => Promise<string | null>;
  askConfirm: (message: string, title?: string) => Promise<boolean>;
};

export function useSftpInteractions(params: UseSftpInteractionsParams) {
  const {
    activeSessionId,
    activeSession,
    settings,
    setSettings,
    sftpPath,
    selectedSftpPaths,
    setSftpPathInput,
    setSftpUploadDropOver,
    setSftpDownloadDropOver,
    setTreeMenu,
    sftpInternalDragRef,
    refreshSftp,
    navigateSftp,
    clearSftpSelectionNow,
    getLocalPathsFromDrop,
    getSftpPathsFromDrag,
    submitSftpPath,
    setSftpSelection,
    showAlert,
    askPrompt,
    askConfirm,
  } = params;

  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!activeSessionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setSftpUploadDropOver(true);
    setSftpDownloadDropOver(false);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!activeSessionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setSftpUploadDropOver(true);
    setSftpDownloadDropOver(false);
  };

  const onDragLeave = () => {
    setSftpUploadDropOver(false);
    setSftpDownloadDropOver(false);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setSftpUploadDropOver(false);
    setSftpDownloadDropOver(false);
    if (!activeSessionId) return;
    const localPaths = getLocalPathsFromDrop(e);
    const sftpPaths = getSftpPathsFromDrag(e);
    const fromInternalSftp = sftpInternalDragRef.current;
    sftpInternalDragRef.current = false;
    if (fromInternalSftp && sftpPaths.length === 0) return;
    if (localPaths.length === 0 && sftpPaths.length === 0) {
      await showAlert('未识别到可用的拖拽路径，请重试或使用上传按钮。', 'SFTP');
      return;
    }
    if (sftpPaths.length > 0) {
      clearSftpSelectionNow();
      await window.terminalApi.sftpDownloadBatch({ sessionId: activeSessionId, remotePaths: sftpPaths });
      return;
    }
    if (fromInternalSftp) return;
    if (localPaths.length > 0) {
      clearSftpSelectionNow();
      await window.terminalApi.sftpUploadBatch({ sessionId: activeSessionId, remoteDir: sftpPath, localPaths });
      await refreshSftp();
    }
  };

  const onToggleShowHidden = async () => {
    if (!settings) return;
    const saved = await window.terminalApi.updateSettings({
      ui: { ...settings.ui, showHiddenFiles: !settings.ui.showHiddenFiles },
    });
    setSettings(saved);
  };

  const onRefresh = async () => refreshSftp();
  const onGoParent = async () => navigateSftp(getParentSftpPath(sftpPath));

  const onFollowCwd = async () => {
    if (!activeSessionId) return;
    try {
      const cwd = await window.terminalApi.sshGetCwd(activeSessionId);
      if (cwd && cwd.trim()) {
        await navigateSftp(cwd.trim());
        return;
      }
      const home = await window.terminalApi.sftpGetHome(activeSessionId);
      await navigateSftp(home || '~');
    } catch (error) {
      try {
        const home = await window.terminalApi.sftpGetHome(activeSessionId);
        await navigateSftp(home || '~');
      } catch {
        await showAlert(`目录跟随失败: ${String(error)}`, 'SFTP');
      }
    }
  };

  const onCreateDir = async () => {
    if (!activeSession || !activeSessionId) return;
    const name = await askPrompt('目录名');
    if (!name) return;
    await window.terminalApi.sftpMkdir({
      sessionId: activeSessionId,
      path: `${sftpPath.replace(/\/$/, '')}/${name}`,
    });
    await refreshSftp();
  };

  const onBatchUpload = async () => {
    if (!activeSession || !activeSessionId) return;
    clearSftpSelectionNow();
    await window.terminalApi.sftpUploadBatch({ sessionId: activeSessionId, remoteDir: sftpPath });
    await refreshSftp();
  };

  const onBatchDownload = async () => {
    if (!activeSession || !activeSessionId) return;
    const selectedPaths = selectedSftpPaths.filter((pathItem) => !!pathItem);
    if (selectedPaths.length === 0) {
      await showAlert('请选择文件或目录后再批量下载');
      return;
    }
    clearSftpSelectionNow();
    await window.terminalApi.sftpDownloadBatch({ sessionId: activeSessionId, remotePaths: selectedPaths });
  };

  const onPathBlur = () => setSftpPathInput(sftpPath);

  const onStartItemDrag = (e: React.DragEvent<HTMLDivElement>, fullPath: string) => {
    sftpInternalDragRef.current = true;
    const picked = selectedSftpPaths.includes(fullPath) && selectedSftpPaths.length > 0 ? selectedSftpPaths : [fullPath];
    e.dataTransfer.setData('application/x-sftp-paths', JSON.stringify(picked));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onEndItemDrag = () => {
    sftpInternalDragRef.current = false;
  };

  const onOpenItemMenu = (e: React.MouseEvent, payload: { path: string; name: string; isDir: boolean }) => {
    if (!activeSession || !activeSessionId) return;
    e.preventDefault();
    e.stopPropagation();
    setTreeMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'sftp',
      sessionId: activeSessionId,
      path: payload.path,
      name: payload.name,
      isDir: payload.isDir,
    });
  };

  const onDownloadSftpMenu = async (menu: SftpMenuPayload) => {
    clearSftpSelectionNow();
    await window.terminalApi.sftpDownloadBatch({ sessionId: menu.sessionId, remotePaths: [menu.path] });
    setTreeMenu(null);
  };

  const onRenameSftpMenu = async (menu: SftpMenuPayload) => {
    const newName = await askPrompt('新名称', menu.name);
    if (!newName || newName === menu.name) {
      setTreeMenu(null);
      return;
    }
    const parentDir = menu.path.replace(/\/[^/]+$/, '') || '/';
    const nextPath = `${parentDir.replace(/\/$/, '')}/${newName}`;
    await window.terminalApi.sftpRename({ sessionId: menu.sessionId, from: menu.path, to: nextPath });
    await refreshSftp();
    setTreeMenu(null);
  };

  const onDeleteSftpMenu = async (menu: SftpMenuPayload) => {
    if (!(await askConfirm(`确定删除 ${menu.name} 吗？`))) return;
    await window.terminalApi.sftpDelete({ sessionId: menu.sessionId, path: menu.path, isDir: menu.isDir });
    await refreshSftp();
    setTreeMenu(null);
  };

  return {
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
    onPathInputChange: setSftpPathInput,
    onPathSubmit: submitSftpPath,
    onPathBlur,
    onStartItemDrag,
    onEndItemDrag,
    onOpenItemMenu,
    onToggleItemSelect: setSftpSelection,
    onOpenDir: navigateSftp,
    onDownloadSftpMenu,
    onRenameSftpMenu,
    onDeleteSftpMenu,
  };
}
