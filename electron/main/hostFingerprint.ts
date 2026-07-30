import { createHash } from 'node:crypto';

export const formatHostKeyFingerprint = (key: Buffer): string =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/g, '')}`;
