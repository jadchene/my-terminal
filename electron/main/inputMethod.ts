import { execFile } from 'node:child_process';
import os from 'node:os';

let switching = false;
let lastSwitchAt = 0;

const switchToEnglishScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class InputMethodSwitcher {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("imm32.dll")]
  public static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
$hwnd = [InputMethodSwitcher]::GetForegroundWindow()
$ime = [InputMethodSwitcher]::ImmGetDefaultIMEWnd($hwnd)
if ($ime -ne [IntPtr]::Zero) {
  [InputMethodSwitcher]::SendMessage($ime, 0x0283, [IntPtr]2, [IntPtr]0) | Out-Null
}
`;

export function switchToEnglishInputMethod(): Promise<boolean> {
  if (os.platform() !== 'win32') return Promise.resolve(false);

  const now = Date.now();
  if (switching || now - lastSwitchAt < 300) return Promise.resolve(true);
  switching = true;
  lastSwitchAt = now;

  return new Promise((resolve) => {
    execFile(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', switchToEnglishScript],
      { windowsHide: true, timeout: 3000 },
      (error) => {
        switching = false;
        resolve(!error);
      },
    );
  });
}
