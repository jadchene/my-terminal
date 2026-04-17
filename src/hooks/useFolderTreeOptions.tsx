import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Folder } from '../types';

function compareByNameThenId(a: { name: string; id: number }, b: { name: string; id: number }): number {
  const byName = a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
  if (byName !== 0) return byName;
  return a.id - b.id;
}

export function useFolderTreeOptions(folders: Folder[]) {
  const folderPathMap = useMemo(() => {
    const byParent = new Map<number | null, Folder[]>();
    for (const folder of folders) {
      const list = byParent.get(folder.parent_id) || [];
      list.push(folder);
      byParent.set(folder.parent_id, list);
    }
    const result = new Map<number, string>();
    const walk = (parentId: number | null, prefix: string) => {
      const children = (byParent.get(parentId) || []).sort(compareByNameThenId);
      for (const child of children) {
        const currentPath = prefix ? `${prefix}/${child.name}` : child.name;
        result.set(child.id, currentPath);
        walk(child.id, currentPath);
      }
    };
    walk(null, '');
    return result;
  }, [folders]);

  const getFolderLabel = (folderId: number | null) => {
    if (!folderId) return '根目录';
    return folderPathMap.get(folderId) || '根目录';
  };

  const renderFolderTreeOptions = (
    activeId: number | null,
    onSelect: (folderId: number | null) => void,
  ): ReactNode[] => {
    const byParent = new Map<number | null, Folder[]>();
    for (const folder of folders) {
      const list = byParent.get(folder.parent_id) || [];
      list.push(folder);
      byParent.set(folder.parent_id, list);
    }
    const renderNodes = (parentId: number | null, depth: number): ReactNode[] => {
      const children = (byParent.get(parentId) || []).sort(compareByNameThenId);
      return children.flatMap((folder) => [
        <button
          key={`folder-option-${folder.id}`}
          type="button"
          className={activeId === folder.id ? 'active tree-option' : 'tree-option'}
          style={{ paddingLeft: `${10 + depth * 16}px` }}
          onClick={() => onSelect(folder.id)}
          title={folderPathMap.get(folder.id) || folder.name}
        >
          {folder.name}
        </button>,
        ...renderNodes(folder.id, depth + 1),
      ]);
    };
    return [
      <button
        key="folder-option-root"
        type="button"
        className={activeId == null ? 'active tree-option' : 'tree-option'}
        onClick={() => onSelect(null)}
      >
        根目录
      </button>,
      ...renderNodes(null, 0),
    ];
  };

  return {
    getFolderLabel,
    renderFolderTreeOptions,
  };
}
