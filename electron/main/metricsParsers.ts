export function parseCpu(line: string): { total: number; idle: number } {
  const parts = line.trim().split(/\s+/).slice(1).map((value) => Number(value) || 0);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  return { total: parts.reduce((sum, value) => sum + value, 0), idle };
}

export function parseMem(lines: string[]): { total: number; available: number } {
  let total = 0;
  let available = 0;
  for (const line of lines) {
    if (line.startsWith('MemTotal:')) total = (Number(line.replace(/[^0-9]/g, '')) || 0) * 1024;
    if (line.startsWith('MemAvailable:')) available = (Number(line.replace(/[^0-9]/g, '')) || 0) * 1024;
  }
  return { total, available };
}
