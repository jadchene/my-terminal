import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { TreeContextMenu } from '../types';

type UseOverlayCloseParams = {
  treeMenu: TreeContextMenu | null;
  setTreeMenu: Dispatch<SetStateAction<TreeContextMenu | null>>;
  sessionFolderMenuOpen: boolean;
  setSessionFolderMenuOpen: Dispatch<SetStateAction<boolean>>;
  sessionFolderMenuRef: MutableRefObject<HTMLDivElement | null>;
  folderParentMenuOpen: boolean;
  setFolderParentMenuOpen: Dispatch<SetStateAction<boolean>>;
  folderParentMenuRef: MutableRefObject<HTMLDivElement | null>;
  cursorStyleMenuOpen: boolean;
  setCursorStyleMenuOpen: Dispatch<SetStateAction<boolean>>;
  cursorStyleMenuRef: MutableRefObject<HTMLDivElement | null>;
};

export function useOverlayClose(params: UseOverlayCloseParams) {
  const {
    treeMenu,
    setTreeMenu,
    sessionFolderMenuOpen,
    setSessionFolderMenuOpen,
    sessionFolderMenuRef,
    folderParentMenuOpen,
    setFolderParentMenuOpen,
    folderParentMenuRef,
    cursorStyleMenuOpen,
    setCursorStyleMenuOpen,
    cursorStyleMenuRef,
  } = params;

  useEffect(() => {
    if (!treeMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.tree-context-menu')) return;
      setTreeMenu(null);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTreeMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [treeMenu, setTreeMenu]);

  useEffect(() => {
    if (!sessionFolderMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = sessionFolderMenuRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      setSessionFolderMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [sessionFolderMenuOpen, sessionFolderMenuRef, setSessionFolderMenuOpen]);

  useEffect(() => {
    if (!folderParentMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = folderParentMenuRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      setFolderParentMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [folderParentMenuOpen, folderParentMenuRef, setFolderParentMenuOpen]);

  useEffect(() => {
    if (!cursorStyleMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = cursorStyleMenuRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      setCursorStyleMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [cursorStyleMenuOpen, cursorStyleMenuRef, setCursorStyleMenuOpen]);
}
