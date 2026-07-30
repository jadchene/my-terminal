import type { SftpItem } from '../types';

export type SessionSftpState = {
  path: string;
  pathInput: string;
  items: SftpItem[];
  selectedPaths: string[];
};

export const createSessionSftpState = (): SessionSftpState => ({
  path: '~',
  pathInput: '~',
  items: [],
  selectedPaths: [],
});

export const updateSessionSftpState = (
  states: Map<number, SessionSftpState>,
  sessionId: number,
  updater: (current: SessionSftpState) => SessionSftpState,
): Map<number, SessionSftpState> => {
  const next = new Map(states);
  next.set(sessionId, updater(states.get(sessionId) ?? createSessionSftpState()));
  return next;
};
