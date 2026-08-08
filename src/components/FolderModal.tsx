import { Button, Form, Input, Modal, Select } from 'antd';
import type { ReactNode, RefObject } from 'react';

type FolderModalProps = {
  show: boolean;
  folderName: string;
  folderParent: number | null;
  folderParentMenuOpen: boolean;
  folderParentMenuRef: RefObject<HTMLDivElement | null>;
  getFolderLabel: (folderId: number | null) => string;
  folderOptions: Array<{ label: string; value: number }>;
  renderFolderTreeOptions: (selectedId: number | null, onPick: (folderId: number | null) => void) => ReactNode[];
  onChangeName: (value: string) => void;
  onToggleParentMenu: () => void;
  onPickParent: (folderId: number | null) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export const FolderModal = (props: FolderModalProps) => {
  const {
    show,
    folderName,
    folderParent,
    folderParentMenuOpen,
    folderParentMenuRef,
    getFolderLabel,
    folderOptions,
    renderFolderTreeOptions,
    onChangeName,
    onToggleParentMenu,
    onPickParent,
    onCancel,
    onConfirm,
  } = props;

  return (
    <Modal
      open={show}
      title="新建目录"
      centered
      mask={{ closable: false }}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button key="confirm" type="primary" onClick={() => void onConfirm()}>确认</Button>,
      ]}
    >
      <Form layout="vertical" colon={false}>
        <Form.Item label="名称" required>
          <Input autoFocus value={folderName} onChange={(event) => onChangeName(event.target.value)} onPressEnter={() => void onConfirm()} />
        </Form.Item>
        <Form.Item label="父目录">
          <Select
            className="folder-select"
            open={folderParentMenuOpen}
            value={folderParent ?? 0}
            options={folderOptions}
            onOpenChange={(open) => {
              if (open !== folderParentMenuOpen) onToggleParentMenu();
            }}
            onChange={(value) => onPickParent(value === 0 ? null : value)}
            optionRender={(option) => <span title={String(option.label)}>{option.label}</span>}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
