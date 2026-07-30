export type SftpErrorCode =
  | 'NOT_CONNECTED'
  | 'CONNECTION_CLOSED'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'CONFLICT'
  | 'CANCELLED'
  | 'INVALID_PATH'
  | 'UNKNOWN';

export type SftpErrorPayload = {
  code: SftpErrorCode;
  message: string;
};

export const toSftpErrorPayload = (error: unknown): SftpErrorPayload => {
  const message = String(error instanceof Error ? error.message : error || '未知 SFTP 错误');
  const text = message.toLocaleLowerCase();
  if (text.includes('未连接') || text.includes('not connected')) return { code: 'NOT_CONNECTED', message };
  if (text.includes('connection') && (text.includes('closed') || text.includes('lost') || text.includes('reset'))) {
    return { code: 'CONNECTION_CLOSED', message };
  }
  if (text.includes('no such file') || text.includes('not found') || text.includes('不存在')) {
    return { code: 'NOT_FOUND', message };
  }
  if (text.includes('permission denied') || text.includes('无权限')) return { code: 'PERMISSION_DENIED', message };
  if (text.includes('already exists') || text.includes('冲突')) return { code: 'CONFLICT', message };
  if (text.includes('cancel')) return { code: 'CANCELLED', message };
  if (text.includes('路径') || text.includes('path')) return { code: 'INVALID_PATH', message };
  return { code: 'UNKNOWN', message };
};
