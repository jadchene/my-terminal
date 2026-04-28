import { flushSync } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SftpItem } from '../types';

type UseSftpPanelParams = {
  activeSessionId: number | null;
  showHiddenFiles: boolean;
  showAlert: (message: string, title?: string) => Promise<void>;
};

export function useSftpPanel(params: UseSftpPanelParams) {
  const { activeSessionId, showHiddenFiles, showAlert } = params;
  const [sftpPath, setSftpPath] = useState('~');
  const [sftpPathInput, setSftpPathInput] = useState('~');
  const [sftpItems, setSftpItems] = useState<SftpItem[]>([]);
  const [selectedSftpPaths, setSelectedSftpPaths] = useState<string[]>([]);
  const [sftpUploadDropOver, setSftpUploadDropOver] = useState(false);
  const [sftpDownloadDropOver, setSftpDownloadDropOver] = useState(false);
  const activeSessionIdRef = useRef<number | null>(activeSessionId);
  const showHiddenFilesRef = useRef(showHiddenFiles);
  const sftpPathRef = useRef(sftpPath);
  const sftpPathInputRef = useRef(sftpPathInput);
  const sftpSelectionAnchorRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    showHiddenFilesRef.current = showHiddenFiles;
  }, [showHiddenFiles]);

  useEffect(() => {
    sftpPathRef.current = sftpPath;
  }, [sftpPath]);

  useEffect(() => {
    sftpPathInputRef.current = sftpPathInput;
  }, [sftpPathInput]);

  const refreshSftp = useCallback(async (pathInput?: string) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    const target = pathInput ?? sftpPathRef.current;
    const list = await window.terminalApi.sftpList({
      sessionId,
      path: target,
      showHidden: showHiddenFilesRef.current,
    });
    setSftpItems(list);
    setSelectedSftpPaths((prev) => prev.filter((it) => list.some((item) => `${target.replace(/\/$/, '')}/${item.name}` === it)));
  }, []);

  const getVisibleSftpPaths = useCallback(() => {
    const basePath = sftpPathRef.current.replace(/\/$/, '');
    return sftpItems.map((item) => `${basePath}/${item.name}`);
  }, [sftpItems]);

  const setSftpSelection = useCallback((fullPath: string, checked: boolean, range = false) => {
    const anchorPath = sftpSelectionAnchorRef.current;
    const visiblePaths = getVisibleSftpPaths();
    if (range && anchorPath) {
      const anchorIndex = visiblePaths.indexOf(anchorPath);
      const targetIndex = visiblePaths.indexOf(fullPath);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const rangePaths = visiblePaths.slice(start, end + 1);
        setSelectedSftpPaths((prev) => {
          if (checked) return Array.from(new Set([...prev, ...rangePaths]));
          return prev.filter((it) => !rangePaths.includes(it));
        });
        return;
      }
    }
    sftpSelectionAnchorRef.current = fullPath;
    setSelectedSftpPaths((prev) => {
      if (checked) return prev.includes(fullPath) ? prev : [...prev, fullPath];
      return prev.filter((it) => it !== fullPath);
    });
  }, [getVisibleSftpPaths]);

  const navigateSftp = useCallback(async (nextPath: string) => {
    sftpPathRef.current = nextPath;
    setSftpPath(nextPath);
    await refreshSftp(nextPath);
  }, [refreshSftp]);

  const clearSftpSelectionNow = useCallback(() => {
    flushSync(() => {
      setSelectedSftpPaths([]);
      sftpSelectionAnchorRef.current = null;
    });
  }, []);

  const clearSftpSelection = useCallback(() => {
    setSelectedSftpPaths([]);
    sftpSelectionAnchorRef.current = null;
  }, []);

  const clearSftpItems = useCallback(() => {
    setSftpItems([]);
  }, []);

  const getLocalPathsFromDrop = useCallback((event: React.DragEvent): string[] => {
    const files = Array.from(event.dataTransfer.files || []);
    const fromFiles = files
      .map((file: File & { path?: string }) => {
        const directPath = String(file?.path || '');
        if (directPath) return directPath;
        try {
          return String(window.terminalApi.getPathForDroppedFile(file) || '');
        } catch {
          return '';
        }
      })
      .filter((it) => !!it);
    const fromUriList = (event.dataTransfer.getData('text/uri-list') || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => !!line && !line.startsWith('#'))
      .map((line) => {
        if (!line.toLowerCase().startsWith('file://')) return '';
        try {
          const decoded = decodeURIComponent(line.replace(/^file:\/\//i, ''));
          if (/^\/[a-zA-Z]:\//.test(decoded)) return decoded.slice(1).replace(/\//g, '\\');
          return decoded.replace(/\//g, '\\');
        } catch {
          return '';
        }
      })
      .filter((it) => !!it);
    const fromPlainText = (event.dataTransfer.getData('text/plain') || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-zA-Z]:\\/.test(line) || /^\\\\/.test(line));
    return Array.from(new Set([...fromFiles, ...fromUriList, ...fromPlainText]));
  }, []);

  const getSftpPathsFromDrag = useCallback((event: React.DragEvent): string[] => {
    const raw = event.dataTransfer.getData('application/x-sftp-paths');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((it) => String(it || '')).filter((it) => !!it);
    } catch {
      return [];
    }
  }, []);

  const submitSftpPath = useCallback(async () => {
    if (!activeSessionIdRef.current) return;
    const nextPath = sftpPathInputRef.current.trim();
    if (!nextPath) {
      setSftpPathInput(sftpPathRef.current);
      return;
    }
    try {
      await navigateSftp(nextPath);
    } catch (error) {
      setSftpPathInput(sftpPathRef.current);
      await showAlert(`路径跳转失败: ${String(error)}`, 'SFTP');
    }
  }, [navigateSftp, showAlert]);

  return {
    sftpPath,
    setSftpPath,
    sftpPathInput,
    setSftpPathInput,
    sftpItems,
    selectedSftpPaths,
    sftpUploadDropOver,
    setSftpUploadDropOver,
    sftpDownloadDropOver,
    setSftpDownloadDropOver,
    refreshSftp,
    setSftpSelection,
    navigateSftp,
    clearSftpSelectionNow,
    clearSftpSelection,
    clearSftpItems,
    getLocalPathsFromDrop,
    getSftpPathsFromDrag,
    submitSftpPath,
  };
}
