export const isSshConnectCancelledError = (error: unknown): boolean => (
  String(error).includes('SSH_CONNECT_CANCELLED')
);
