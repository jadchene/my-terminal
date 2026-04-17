import type { ReactNode, RefObject } from 'react';

type FolderModalProps = {
  show: boolean;
  folderName: string;
  folderParent: number | null;
  folderParentMenuOpen: boolean;
  folderParentMenuRef: RefObject<HTMLDivElement | null>;
  getFolderLabel: (folderId: number | null) => string;
  renderFolderTreeOptions: (selectedId: number | null, onPick: (folderId: number | null) => void) => ReactNode[];
  onChangeName: (value: string) => void;
  onToggleParentMenu: () => void;
  onPickParent: (folderId: number | null) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function FolderModal(props: FolderModalProps) {
  const {
    show,
    folderName,
    folderParent,
    folderParentMenuOpen,
    folderParentMenuRef,
    getFolderLabel,
    renderFolderTreeOptions,
    onChangeName,
    onToggleParentMenu,
    onPickParent,
    onCancel,
    onConfirm,
  } = props;
  if (!show) return null;

  return (
    <div className="modal-mask">
      <div className="modal-card">
        <h3>新建目录</h3>
        <label>
          名称
          <input value={folderName} onChange={(e) => onChangeName(e.target.value)} />
        </label>
        <label>
          父目录
          <div className="select-like" ref={folderParentMenuRef}>
            <button type="button" className="select-like-trigger" onClick={onToggleParentMenu}>
              <span>{getFolderLabel(folderParent)}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {folderParentMenuOpen && <div className="select-like-menu">{renderFolderTreeOptions(folderParent, onPickParent)}</div>}
          </div>
        </label>
        <div className="modal-actions">
          <button onClick={onCancel}>取消</button>
          <button onClick={() => void onConfirm()}>确认</button>
        </div>
      </div>
    </div>
  );
}
