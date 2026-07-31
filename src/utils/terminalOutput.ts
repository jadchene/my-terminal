const IMMEDIATE_TERMINAL_WRITE_CHUNK = 2 * 1024;

export const canWriteTerminalOutputImmediately = (data: string): boolean =>
  data.length <= IMMEDIATE_TERMINAL_WRITE_CHUNK;
