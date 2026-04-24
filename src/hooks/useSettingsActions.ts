import type { Dispatch, SetStateAction } from 'react';
import type { Settings } from '../types';

type RuntimeInfo = {
  runtimeDir: string;
  userDataPath: string;
  settingsStorage: string;
  dbPath: string;
  os: string;
};

type UseSettingsActionsParams = {
  settings: Settings | null;
  settingsDraft: Settings | null;
  runtimeInfo: RuntimeInfo | null;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  setSettingsDraft: Dispatch<SetStateAction<Settings | null>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setSettingsTab: Dispatch<SetStateAction<'appearance' | 'behavior' | 'system'>>;
  setCursorStyleMenuOpen: Dispatch<SetStateAction<boolean>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export function useSettingsActions(params: UseSettingsActionsParams) {
  const {
    settings,
    settingsDraft,
    runtimeInfo,
    setSettings,
    setSettingsDraft,
    setShowSettings,
    setSettingsTab,
    setCursorStyleMenuOpen,
    setMenuOpen,
  } = params;

  const openSettingsModal = () => {
    if (!settings) return;
    setMenuOpen(false);
    setSettingsDraft({
      ...settings,
      theme: { ...settings.theme },
      behavior: { ...settings.behavior },
      ui: { ...settings.ui },
    });
    setSettingsTab('appearance');
    setShowSettings(true);
  };

  const toggleSidebarVisible = async () => {
    if (!settings) return;
    const saved = await window.terminalApi.updateSettings({
      ui: { ...settings.ui, sidebarVisible: !settings.ui.sidebarVisible },
    });
    setSettings(saved);
  };

  const pickDefaultDownloadDir = async () => {
    if (!settingsDraft) return;
    const picked = await window.terminalApi.pickDirectory(settingsDraft.behavior.defaultDownloadDir || runtimeInfo?.runtimeDir);
    if (!picked) return;
    setSettingsDraft({
      ...settingsDraft,
      behavior: { ...settingsDraft.behavior, defaultDownloadDir: picked },
    });
  };

  const cancelSettingsModal = () => {
    setShowSettings(false);
    setSettingsDraft(null);
    setSettingsTab('appearance');
    setCursorStyleMenuOpen(false);
  };

  const saveSettingsModal = async () => {
    if (!settingsDraft) return;
    const normalizedDraft: Settings = {
      ...settingsDraft,
      theme: {
        ...settingsDraft.theme,
        terminalCursorStyle: settingsDraft.theme.terminalCursorStyle || 'block',
        terminalCursorBlink: settingsDraft.theme.terminalCursorBlink ?? true,
        terminalCursorWidth: Math.max(1, Math.min(8, Number(settingsDraft.theme.terminalCursorWidth ?? 2))),
      },
      behavior: {
        ...settingsDraft.behavior,
        singleInstance: settingsDraft.behavior.singleInstance ?? true,
      },
    };
    const saved = await window.terminalApi.updateSettings(normalizedDraft);
    setSettings(saved);
    setSettingsDraft(null);
    setShowSettings(false);
    setSettingsTab('appearance');
    setCursorStyleMenuOpen(false);
  };

  return {
    openSettingsModal,
    toggleSidebarVisible,
    pickDefaultDownloadDir,
    cancelSettingsModal,
    saveSettingsModal,
  };
}
