import { useRef, useState } from 'react';

type DialogType = 'alert' | 'confirm' | 'prompt';
export type DialogResult = boolean | string | null | void;
export type DialogState = {
  type: DialogType;
  title: string;
  message: string;
  defaultValue?: string;
  inputType?: 'text' | 'password';
};

export function useDialog() {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogInput, setDialogInput] = useState('');
  const [showDialogPassword, setShowDialogPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const dialogResolverRef = useRef<((value: DialogResult) => void) | null>(null);

  const openDialog = <T extends DialogResult>(next: DialogState): Promise<T> =>
    new Promise<T>((resolve) => {
      dialogResolverRef.current = resolve as (value: DialogResult) => void;
      setDialogInput(next.defaultValue || '');
      setShowDialogPassword(false);
      setDialog(next);
    });

  const closeDialog = (value: DialogResult) => {
    const resolver = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    setCapsLockOn(false);
    setShowDialogPassword(false);
    if (resolver) resolver(value);
  };

  const askConfirm = async (message: string, title = '确认'): Promise<boolean> =>
    openDialog<boolean>({ type: 'confirm', title, message });

  const askPrompt = async (message: string, defaultValue = '', title = '输入'): Promise<string | null> =>
    openDialog<string | null>({ type: 'prompt', title, message, defaultValue, inputType: 'text' });

  const askPassword = async (message: string, title = '输入密码'): Promise<string | null> =>
    openDialog<string | null>({ type: 'prompt', title, message, defaultValue: '', inputType: 'password' });

  const showAlert = async (message: string, title = '提示'): Promise<void> => {
    await openDialog<void>({ type: 'alert', title, message });
  };

  return {
    dialog,
    dialogInput,
    showDialogPassword,
    capsLockOn,
    setDialogInput,
    setShowDialogPassword,
    setCapsLockOn,
    closeDialog,
    askConfirm,
    askPrompt,
    askPassword,
    showAlert,
  };
}
