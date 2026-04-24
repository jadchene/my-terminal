import { app } from 'electron';
import { sharedState } from './state';
import { createWindow } from './window';

let secondInstanceHandlerRegistered = false;

function focusMainWindow() {
  const target = sharedState.mainWindow;
  if (!target || target.isDestroyed()) {
    if (app.isReady()) createWindow();
    return;
  }
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}

export function applySingleInstancePreference(enabled: boolean): boolean {
  if (!enabled) {
    if (sharedState.singleInstanceLock) {
      app.releaseSingleInstanceLock();
      sharedState.singleInstanceLock = false;
    }
    return true;
  }

  if (!sharedState.singleInstanceLock) {
    const locked = app.requestSingleInstanceLock();
    if (!locked) return false;
    sharedState.singleInstanceLock = true;
  }

  if (!secondInstanceHandlerRegistered) {
    app.on('second-instance', focusMainWindow);
    secondInstanceHandlerRegistered = true;
  }

  return true;
}
