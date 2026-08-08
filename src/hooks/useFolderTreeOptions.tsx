import { useMemo } from 'react';
import type { Folder } from '../types';

export type FolderTreeOption = {
  title: string;
  value: number;
  children?: FolderTreeOption[];
};

function compareByNameThenId(a: { name: string; id: number }, b: { name: string; id: number }): number {
  const byName = a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
  if (byName !== 0) return byName;
  return a.id - b.id;
}

export function useFolderTreeOptions(folders: Folder[]) {
  return useMemo(() => {
    const byParent = new Map<number | null, Folder[]>();
    for (const folder of folders) {
      const list = byParent.get(folder.parent_id) || [];
      list.push(folder);
      byParent.set(folder.parent_id, list);
    }
    const build = (parentId: number | null): FolderTreeOption[] =>
      (byParent.get(parentId) || [])
        .sort(compareByNameThenId)
        .map((folder) => {
          const children = build(folder.id);
          return children.length > 0
            ? { title: folder.name, value: folder.id, children }
            : { title: folder.name, value: folder.id };
        });
    const folderTreeData: FolderTreeOption[] = [{ title: '根目录', value: 0, children: build(null) }];
    return { folderTreeData };
  }, [folders]);
}
