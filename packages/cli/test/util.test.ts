import { describe, expect, it } from 'vitest';
import { isAbort, runStreamed, sleep } from '../src/core/util.js';

describe('runStreamed', () => {
  it('streams every output line, stdout and stderr', async () => {
    const lines: string[] = [];
    await runStreamed('sh', ['-c', 'echo one; echo two >&2; printf three'], { onLine: (l) => lines.push(l) });
    expect(lines.sort()).toEqual(['one', 'three', 'two']);
  });

  it('rejects on a non-zero exit code', async () => {
    await expect(runStreamed('sh', ['-c', 'exit 3'], { onLine: () => undefined })).rejects.toThrow(/code 3/);
  });

  it('kills the process when aborted', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const run = runStreamed('sleep', ['10'], { onLine: () => undefined, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const err: unknown = await run.catch((e: unknown) => e);
    expect(isAbort(err)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('sleep', () => {
  it('stops early when aborted', async () => {
    const err: unknown = await sleep(10_000, AbortSignal.timeout(20)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });
});
