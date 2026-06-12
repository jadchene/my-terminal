import type { Terminal } from 'xterm';

const NON_BREAKING_SPACE_REGEX = /\u00a0/g;

function normalizeSelectionSpaces(text: string): string {
  return text.replace(NON_BREAKING_SPACE_REGEX, ' ');
}

function getLineText(term: Terminal, row: number, startColumn: number, endColumn: number): string {
  const line = term.buffer.active.getLine(row);
  if (!line || endColumn <= startColumn) return '';
  return normalizeSelectionSpaces(line.translateToString(true, startColumn, endColumn));
}

function getColumnAlignedMultilineSelection(term: Terminal): string | null {
  const range = term.getSelectionPosition();
  if (!range || range.start.y === range.end.y || range.start.x <= 0) return null;

  const lines: string[] = [];
  const startColumn = Math.max(0, range.start.x);
  for (let row = range.start.y; row <= range.end.y; row += 1) {
    const line = term.buffer.active.getLine(row);
    if (!line) continue;
    const fromColumn = row === range.start.y || !line.isWrapped ? startColumn : 0;
    const toColumn = row === range.end.y ? range.end.x : term.cols;
    const text = getLineText(term, row, fromColumn, toColumn);

    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }

  return lines.join('\r\n');
}

export function getTerminalSelectionText(term: Terminal): string {
  return getColumnAlignedMultilineSelection(term) ?? normalizeSelectionSpaces(term.getSelection());
}
