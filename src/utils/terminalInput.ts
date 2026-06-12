export function hasMultilineInput(text: string): boolean {
  return /\r|\n/.test(text);
}

export function normalizeTerminalPaste(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r');
}

export function prepareTerminalPaste(text: string, bracketedPasteMode: boolean): string {
  const normalized = normalizeTerminalPaste(text);
  return bracketedPasteMode ? `\x1b[200~${normalized}\x1b[201~` : normalized;
}

export function normalizeTerminalDataInput(input: string): string {
  if (input.length <= 1 || !hasMultilineInput(input)) return input;
  return normalizeTerminalPaste(input);
}
