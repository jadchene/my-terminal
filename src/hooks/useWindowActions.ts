type UseWindowActionsParams = {
  closeTab: (tabId: number) => Promise<void>;
};

export function useWindowActions(params: UseWindowActionsParams) {
  const { closeTab } = params;

  return {
    onCloseTab: (tabId: number) => {
      closeTab(tabId).catch(() => null);
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
