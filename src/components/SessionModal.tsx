import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { Session } from '../types';

type SessionForm = Omit<Session, 'id'>;

type SessionModalProps = {
  show: boolean;
  editing: boolean;
  form: SessionForm;
  showPassword: boolean;
  folderMenuOpen: boolean;
  folderMenuRef: RefObject<HTMLDivElement | null>;
  getFolderLabel: (folderId: number | null) => string;
  renderFolderTreeOptions: (selectedId: number | null, onPick: (folderId: number | null) => void) => ReactNode[];
  onChangeForm: (next: SessionForm) => void;
  onTogglePassword: () => void;
  onToggleFolderMenu: () => void;
  onPickFolder: (folderId: number | null) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function SessionModal(props: SessionModalProps) {
  const {
    show,
    editing,
    form,
    showPassword,
    folderMenuOpen,
    folderMenuRef,
    getFolderLabel,
    renderFolderTreeOptions,
    onChangeForm,
    onTogglePassword,
    onToggleFolderMenu,
    onPickFolder,
    onCancel,
    onConfirm,
  } = props;
  if (!show) return null;

  return (
    <div className="modal-mask">
      <div className="modal-card">
        <h3>{editing ? '编辑会话' : '新建会话'}</h3>
        <label>
          名称
          <input value={form.name} onChange={(e) => onChangeForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          主机
          <input value={form.host} onChange={(e) => onChangeForm({ ...form, host: e.target.value })} />
        </label>
        <label>
          端口
          <input type="number" value={form.port} onChange={(e) => onChangeForm({ ...form, port: Number(e.target.value) || 22 })} />
        </label>
        <label>
          用户名
          <input value={form.username} onChange={(e) => onChangeForm({ ...form, username: e.target.value })} />
        </label>
        <label>
          密码
          <div className="password-field">
            <input type={!editing && showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => onChangeForm({ ...form, password: e.target.value })} />
            {!editing && (
              <button type="button" className="password-toggle-btn" title={showPassword ? '隐藏密码' : '显示密码'} onClick={onTogglePassword}>
                {showPassword ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
              </button>
            )}
          </div>
        </label>
        <label>
          目录
          <div className="select-like" ref={folderMenuRef}>
            <button type="button" className="select-like-trigger" onClick={onToggleFolderMenu}>
              <span>{getFolderLabel(form.folder_id)}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {folderMenuOpen && <div className="select-like-menu">{renderFolderTreeOptions(form.folder_id, onPickFolder)}</div>}
          </div>
        </label>
        <label className="check-line">
          <input type="checkbox" checked={form.remember_password === 1} onChange={(e) => onChangeForm({ ...form, remember_password: e.target.checked ? 1 : 0 })} />
          默认记住密码
        </label>
        <label className="check-line">
          <input type="checkbox" checked={form.default_session === 1} onChange={(e) => onChangeForm({ ...form, default_session: e.target.checked ? 1 : 0 })} />
          默认会话
        </label>
        <div className="modal-actions">
          <button onClick={onCancel}>取消</button>
          <button onClick={() => void onConfirm()}>确认</button>
        </div>
      </div>
    </div>
  );
}
