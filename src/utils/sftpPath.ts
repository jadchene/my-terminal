export function getParentSftpPath(current: string): string {
  const value = (current || '').trim();
  if (!value || value === '/' || value === '~') return value || '~';
  if (value.endsWith('/..')) return value;
  const normalized = value.replace(/\/+$/, '');
  if (!normalized || normalized === '/') return '/';
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '/';
  return normalized.slice(0, index) || '/';
}
