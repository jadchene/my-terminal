import type { SftpItem } from '../types';

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

export function formatSftpMeta(item: SftpItem) {
  const rights = item.rights ? `${item.rights.user}${item.rights.group}${item.rights.other}` : '-';
  const timeText = item.modifyTime ? new Date(item.modifyTime).toLocaleString() : '-';
  return `权限: ${rights}\n大小: ${formatBytes(item.size || 0)}\n时间: ${timeText}`;
}
