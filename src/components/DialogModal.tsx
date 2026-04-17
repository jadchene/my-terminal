import { Eye, EyeOff } from 'lucide-react';
import type { DialogResult, DialogState } from '../hooks/useDialog';

type DialogModalProps = {
  dialog: DialogState | null;
  dialogInput: string;
  showDialogPassword: boolean;
  capsLockOn: boolean;
  onChangeInput: (value: string) => void;
  onSetShowDialogPassword: (show: boolean) => void;
  onSetCapsLockOn: (on: boolean) => void;
  onClose: (value: DialogResult) => void;
};

export function DialogModal(props: DialogModalProps) {
  const {
    dialog,
    dialogInput,
    showDialogPassword,
    capsLockOn,
    onChangeInput,
    onSetShowDialogPassword,
    onSetCapsLockOn,
    onClose,
  } = props;
  if (!dialog) return null;

  return (
    <div className="modal-mask">
      <div className="modal-card">
        <h3>{dialog.title}</h3>
        <div className="dialog-message">{dialog.message}</div>
        {dialog.type === 'prompt' && (
          <>
            <div className="password-field">
              <input
                autoFocus
                type={dialog.inputType === 'password' && !showDialogPassword ? 'password' : 'text'}
                value={dialogInput}
                onChange={(e) => onChangeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (dialog.inputType === 'password') {
                    onSetCapsLockOn(e.getModifierState('CapsLock'));
                  }
                  if (e.key === 'Enter') {
                    onClose(dialog.inputType === 'password' ? dialogInput : dialogInput.trim());
                  }
                  if (e.key === 'Escape') onClose(null);
                }}
                onKeyUp={(e) => {
                  if (dialog.inputType === 'password') {
                    onSetCapsLockOn(e.getModifierState('CapsLock'));
                  }
                }}
                onClick={(e) => {
                  if (dialog.inputType === 'password') {
                    onSetCapsLockOn(e.getModifierState('CapsLock'));
                  }
                }}
                onBlur={() => {
                  if (dialog.inputType === 'password') {
                    onSetCapsLockOn(false);
                  }
                }}
              />
              {dialog.inputType === 'password' && (
                <button
                  type="button"
                  className="password-toggle-btn"
                  title={showDialogPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => onSetShowDialogPassword(!showDialogPassword)}
                >
                  {showDialogPassword ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                </button>
              )}
            </div>
            {dialog.inputType === 'password' && <div className={`caps-tip ${capsLockOn ? 'on' : ''}`}>Caps Lock: {capsLockOn ? '开' : '关'}</div>}
          </>
        )}
        <div className="modal-actions">
          {dialog.type === 'confirm' && <button onClick={() => onClose(false)}>取消</button>}
          {dialog.type === 'prompt' && <button onClick={() => onClose(null)}>取消</button>}
          <button
            onClick={() => {
              if (dialog.type === 'confirm') onClose(true);
              else if (dialog.type === 'prompt') onClose(dialog.inputType === 'password' ? dialogInput : dialogInput.trim());
              else onClose(undefined);
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
