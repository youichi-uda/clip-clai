import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '../../src/index.ts');
const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');

function run(args: string): string {
  return execSync(`npx tsx "${CLI}" ${args}`, { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf-8' });
}

describe('layers command', () => {
  it('should show layer tree', () => {
    const out = run(`layers "${TEST_CLIP}"`);
    expect(out).toContain('ラスターレイヤー');
    expect(out).toContain('ベクターレイヤー');
    expect(out).toContain('テスト');
    expect(out).toContain('[add]');
    expect(out).toContain('[add-glow]');
    expect(out).toContain('[subtract]');
    expect(out).toContain('FOLDER');
  });

  it('should output JSON', () => {
    const out = run(`layers "${TEST_CLIP}" --json`);
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
    // Root folder
    expect(data[0].kind).toBe('root-folder');
    expect(data[0].children.length).toBeGreaterThan(0);
  });

  it('should support flat mode', () => {
    const out = run(`layers "${TEST_CLIP}" --flat --json`);
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
    // Flat mode should not have children property populated as tree
    expect(data.length).toBe(9);
  });
});
