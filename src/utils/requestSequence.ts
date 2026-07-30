export function isLatestSessionRequest(
  currentSessionId: number | null,
  requestSessionId: number,
  currentSequence: number,
  requestSequence: number,
): boolean {
  return currentSessionId === requestSessionId && currentSequence === requestSequence;
}
