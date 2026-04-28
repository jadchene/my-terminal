export function hasMultilineInput(text: string): boolean {
  return /\r|\n/.test(text);
}

export function normalizeTerminalPaste(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r');
}

export function normalizeTerminalDataInput(input: string): string {
  if (input.length <= 1 || !hasMultilineInput(input)) return input;
  return normalizeTerminalPaste(input);
}
