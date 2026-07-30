type MountableTerminal = {
  element?: HTMLElement;
  open: (parent: HTMLElement) => void;
};

export const mountTerminal = (container: HTMLElement, terminal: MountableTerminal): void => {
  container.replaceChildren();
  if (terminal.element) {
    container.appendChild(terminal.element);
    return;
  }
  terminal.open(container);
};
