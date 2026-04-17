import type { Dispatch, SetStateAction } from 'react';

type UseWindowActionsParams = {
  closeTab: (tabId: number) => Promise<void>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export function useWindowActions(params: UseWindowActionsParams) {
  const { closeTab, setMenuOpen } = params;

  return {
    onCloseTab: (tabId: number) => {
      closeTab(tabId).catch(() => null);
    },
    onToggleMenu: () => {
      setMenuOpen((v) => !v);
    },
    onMinimize: () => {
      void window.terminalApi.minimizeWindow();
    },
    onToggleMaximize: () => {
      void window.terminalApi.toggleMaximizeWindow();
    },
    onCloseWindow: () => {
      void window.terminalApi.closeWindow();
    },
  };
}
