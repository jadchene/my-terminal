import assert from 'node:assert/strict';
import test from 'node:test';
import { CappedMetricsOutput } from '../electron/main/metricsOutput';
import { parseCpu, parseMem } from '../electron/main/metricsParsers';

test('metrics parsers read Linux counters', () => {
  assert.deepEqual(parseCpu('cpu  10 2 3 40 5 6 7 8'), { total: 81, idle: 45 });
  assert.deepEqual(parseMem(['MemTotal: 2048 kB', 'MemAvailable: 512 kB']), {
    total: 2 * 1024 * 1024,
    available: 512 * 1024,
  });
});

test('metrics output enforces its byte cap', () => {
  const output = new CappedMetricsOutput(5);
  output.append(Buffer.from('abc'));
  output.append(Buffer.from('de'));
  assert.equal(output.toString(), 'abcde');
  assert.throws(() => output.append(Buffer.from('f')), /超过限制/);
});
