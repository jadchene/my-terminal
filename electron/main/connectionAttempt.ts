export const SSH_CONNECT_CANCELLED = 'SSH_CONNECT_CANCELLED';

type DestroyableClient = {
  destroy: () => unknown;
};

export type PendingConnectionAttempt = {
  token: symbol;
  cancelled: boolean;
  client?: DestroyableClient;
  reject?: (error: Error) => void;
};

const pendingConnectionAttempts = new Map<number, PendingConnectionAttempt>();

export const cancelPendingConnectionAttempt = (connectionId: number): boolean => {
  const attempt = pendingConnectionAttempts.get(connectionId);
  if (!attempt) return false;
  pendingConnectionAttempts.delete(connectionId);
  attempt.cancelled = true;
  try {
    attempt.client?.destroy();
  } catch {
    // Rejection below still settles the renderer request.
  }
  attempt.reject?.(new Error(SSH_CONNECT_CANCELLED));
  return true;
};

export const beginConnectionAttempt = (connectionId: number): PendingConnectionAttempt => {
  cancelPendingConnectionAttempt(connectionId);
  const attempt: PendingConnectionAttempt = {
    token: Symbol(`ssh-connect:${connectionId}`),
    cancelled: false,
  };
  pendingConnectionAttempts.set(connectionId, attempt);
  return attempt;
};

export const releaseConnectionAttempt = (
  connectionId: number,
  attempt: PendingConnectionAttempt,
): void => {
  if (pendingConnectionAttempts.get(connectionId)?.token === attempt.token) {
    pendingConnectionAttempts.delete(connectionId);
  }
};

export const cancelAllPendingConnectionAttempts = (): void => {
  for (const connectionId of Array.from(pendingConnectionAttempts.keys())) {
    cancelPendingConnectionAttempt(connectionId);
  }
};
