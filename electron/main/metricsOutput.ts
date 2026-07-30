export class CappedMetricsOutput {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    this.byteLength += chunk.byteLength;
    if (this.byteLength > this.maxBytes) {
      throw new Error(`远程指标输出超过限制（${this.maxBytes} bytes）`);
    }
    this.chunks.push(chunk);
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}
