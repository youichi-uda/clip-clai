import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CLI = resolve(import.meta.dirname, '../../src/index.ts');
const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');

function run(args: string): string {
  return execSync(`npx tsx "${CLI}" ${args}`, { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf-8' });
}

describe('export command', () => {
  it('should export raster layer as PNG', () => {
    const outPath = join(tmpdir(), 'clip-clai-test-export.png');
    try {
      const out = run(`export "${TEST_CLIP}" 7 -o "${outPath}"`);
      expect(out).toContain('Exported layer #7');
      expect(existsSync(outPath)).toBe(true);
      // Verify it's a valid PNG (starts with PNG magic)
      const buf = readFileSync(outPath);
      expect(buf[0]).toBe(0x89);
      expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    } finally {
      try { unlinkSync(outPath); } catch {}
    }
  });
});

describe('thumbnail command', () => {
  it('should export thumbnail as PNG', () => {
    const outPath = join(tmpdir(), 'clip-clai-test-thumb.png');
    try {
      const out = run(`thumbnail "${TEST_CLIP}" -o "${outPath}"`);
      expect(out).toContain('Thumbnail saved');
      expect(existsSync(outPath)).toBe(true);
      const buf = readFileSync(outPath);
      expect(buf[0]).toBe(0x89);
    } finally {
      try { unlinkSync(outPath); } catch {}
    }
  });
});
