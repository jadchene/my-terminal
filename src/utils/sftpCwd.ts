type SftpLocation = {
  sessionId: number | null;
  path: string;
};

const normalizePath = (value: string): string => value.trim().replace(/\/+$/, '') || '/';

export const shouldApplyCwdCalibration = (
  requestedSessionId: number,
  initialPath: string,
  currentLocation: SftpLocation,
  livePath: string,
): boolean => {
  if (currentLocation.sessionId !== requestedSessionId || !livePath.trim()) return false;
  const initial = normalizePath(initialPath);
  return normalizePath(currentLocation.path) === initial && normalizePath(livePath) !== initial;
};
