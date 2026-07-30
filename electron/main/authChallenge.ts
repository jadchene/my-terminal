import { randomUUID } from 'node:crypto';
import { safeSend } from './window';
import { registerTrustedHandle } from './ipcSecurity';

export type AuthChallengePrompt = {
  prompt: string;
  echo: boolean;
};

type PendingAuthChallenge = {
  connectionId: number;
  resolve: (answers: string[] | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAuthChallenges = new Map<string, PendingAuthChallenge>();

export const requestAuthChallengeAnswers = (
  connectionId: number,
  sessionName: string,
  prompts: AuthChallengePrompt[],
): Promise<string[] | null> => new Promise((resolve) => {
  const requestId = randomUUID();
  const timer = setTimeout(() => {
    pendingAuthChallenges.delete(requestId);
    safeSend('ssh:auth-challenge-expired', { requestId });
    resolve(null);
  }, 120_000);
  timer.unref();
  pendingAuthChallenges.set(requestId, { connectionId, resolve, timer });
  safeSend('ssh:auth-challenge', { requestId, connectionId, sessionName, prompts });
});

export const registerAuthChallengeIpc = (): void => {
  registerTrustedHandle(
    'ssh:auth-challenge-response',
    async (_, requestId: string, answers: string[] | null) => {
      const pending = pendingAuthChallenges.get(String(requestId || ''));
      if (!pending) return false;
      pendingAuthChallenges.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve(Array.isArray(answers) ? answers.map((answer) => String(answer ?? '')) : null);
      return true;
    },
  );
};

export const cancelPendingAuthChallenges = (connectionId?: number): void => {
  for (const [requestId, pending] of pendingAuthChallenges) {
    if (connectionId !== undefined && pending.connectionId !== connectionId) continue;
    clearTimeout(pending.timer);
    safeSend('ssh:auth-challenge-expired', { requestId });
    pending.resolve(null);
    pendingAuthChallenges.delete(requestId);
  }
};
