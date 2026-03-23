import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '../../src/index.ts');
const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');

function run(args: string): string {
  return execSync(`npx tsx "${CLI}" ${args}`, { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf-8' });
}

describe('info command', () => {
  it('should show canvas info', () => {
    const out = run(`info "${TEST_CLIP}"`);
    expect(out).toContain('1600x1200');
    expect(out).toContain('72dpi');
    expect(out).toContain('8bit');
    expect(out).toContain('modern');
  });

  it('should output JSON', () => {
    const out = run(`info "${TEST_CLIP}" --json`);
    const data = JSON.parse(out);
    expect(data.canvas.width).toBe(1600);
    expect(data.canvas.height).toBe(1200);
    expect(data.schemaVersion).toBe('modern');
    expect(data.layerCount).toBe(9);
  });
});
