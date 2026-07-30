import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let switching = false;
let lastSwitchAt = 0;

function getNativeHelperPath(): string | null {
  const name = 'my-terminal-virtual-file-drag.exe';
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'native', name)
    : path.resolve(__dirname, '..', '..', 'native', name);
  return fs.existsSync(candidate) ? candidate : null;
}

export function switchToEnglishInputMethod(): Promise<boolean> {
  if (os.platform() !== 'win32') return Promise.resolve(false);

  const now = Date.now();
  if (switching || now - lastSwitchAt < 300) return Promise.resolve(true);
  switching = true;
  lastSwitchAt = now;
  const helperPath = getNativeHelperPath();
  if (!helperPath) {
    switching = false;
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    execFile(
      helperPath,
      ['--switch-english-input'],
      { windowsHide: true, timeout: 3000 },
      (error) => {
        switching = false;
        resolve(!error);
      },
    );
  });
}
