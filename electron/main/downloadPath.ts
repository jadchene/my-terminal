import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_LOCAL_NAME_LENGTH = 240;

export const sanitizeLocalFileName = (input: string): string => {
  const baseName = path.win32.basename(String(input || '').replace(/\//g, '\\'));
  const sanitized = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '') || 'download';
  const safeReservedName = WINDOWS_RESERVED_NAME.test(sanitized) ? `_${sanitized}` : sanitized;
  if (safeReservedName.length <= MAX_LOCAL_NAME_LENGTH) return safeReservedName;
  const extension = path.extname(safeReservedName).slice(0, 32);
  const base = path.basename(safeReservedName, extension);
  return `${base.slice(0, Math.max(1, MAX_LOCAL_NAME_LENGTH - extension.length))}${extension}`;
};

export const assertPathInside = (rootDir: string, candidatePath: string): string => {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return candidate;
  throw new Error(`下载路径超出目标目录: ${candidatePath}`);
};

const localPathKey = (input: string): string => path.resolve(input).toLocaleLowerCase();

export const allocateUniqueLocalPath = async (
  targetDir: string,
  requestedName: string,
  reservedPaths: Set<string>,
): Promise<string> => {
  const safeName = sanitizeLocalFileName(requestedName);
  const extension = path.extname(safeName);
  const base = path.basename(safeName, extension);
  let index = 0;
  while (index < 10_000) {
    const candidateName = index === 0 ? `${base}${extension}` : `${base} (${index + 1})${extension}`;
    const candidate = assertPathInside(targetDir, path.join(targetDir, candidateName));
    const key = localPathKey(candidate);
    if (!reservedPaths.has(key)) {
      try {
        await fs.promises.access(candidate, fs.constants.F_OK);
      } catch {
        reservedPaths.add(key);
        return candidate;
      }
    }
    index += 1;
  }
  const fallback = assertPathInside(targetDir, path.join(targetDir, `${base}-${Date.now()}${extension}`));
  reservedPaths.add(localPathKey(fallback));
  return fallback;
};

export const createTemporaryDownloadPath = (finalPath: string): string => {
  const directory = path.dirname(finalPath);
  const fileName = path.basename(finalPath);
  return assertPathInside(directory, path.join(directory, `.${fileName}.${randomUUID()}.part`));
};
