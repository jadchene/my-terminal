type BoundedTextChunk = {
  text: string;
  byteLength: number;
};

export type BoundedText = {
  chunks: BoundedTextChunk[];
  head: number;
  byteLength: number;
  truncated: boolean;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const compactChunks = (value: BoundedText) => {
  if (value.head === 0 || (value.head < 128 && value.head * 2 < value.chunks.length)) return;
  value.chunks = value.chunks.slice(value.head);
  value.head = 0;
};

const trimChunkStart = (chunk: BoundedTextChunk, removeBytes: number): BoundedTextChunk => {
  const bytes = encoder.encode(chunk.text);
  let start = Math.min(removeBytes, bytes.byteLength);
  while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start += 1;
  return {
    text: decoder.decode(bytes.subarray(start)),
    byteLength: bytes.byteLength - start,
  };
};

export const appendBoundedUtf8 = (
  previous: BoundedText | undefined,
  appended: string,
  maxBytes: number,
): BoundedText => {
  const value = previous ?? { chunks: [], head: 0, byteLength: 0, truncated: false };
  if (appended) {
    const byteLength = encoder.encode(appended).byteLength;
    if (byteLength > 0) {
      value.chunks.push({ text: appended, byteLength });
      value.byteLength += byteLength;
    }
  }

  const limit = Math.max(0, maxBytes);
  while (value.byteLength > limit && value.head < value.chunks.length) {
    const overflow = value.byteLength - limit;
    const first = value.chunks[value.head];
    value.truncated = true;
    if (overflow >= first.byteLength) {
      value.byteLength -= first.byteLength;
      value.head += 1;
      continue;
    }
    const trimmed = trimChunkStart(first, overflow);
    value.byteLength -= first.byteLength - trimmed.byteLength;
    value.chunks[value.head] = trimmed;
  }
  compactChunks(value);
  return value;
};

export const materializeBoundedUtf8 = (value: BoundedText): string =>
  value.chunks.slice(value.head).map((chunk) => chunk.text).join('');
