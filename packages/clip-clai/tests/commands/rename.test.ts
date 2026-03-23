import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ClipDatabase } from '../../src/core/database.js';

const CLI = resolve(import.meta.dirname, '../../src/index.ts');
const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');

function run(args: string): string {
  return execSync(`npx tsx "${CLI}" ${args}`, {
    cwd: resolve(import.meta.dirname, '../..'),
    encoding: 'utf-8',
    env: { ...process.env, CLIP_CLAI_LICENSE_BYPASS: '1' },
  });
}

describe('rename command', () => {
  const tmpFile = join(tmpdir(), 'clip-clai-rename-test.clip');

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch {}
    try { unlinkSync(tmpFile + '.bak'); } catch {}
  });

  it('should rename a layer', () => {
    copyFileSync(TEST_CLIP, tmpFile);
    const out = run(`rename "${tmpFile}" 7 "新しいレイヤー名"`);
    expect(out).toContain('Renamed layer #7');

    // Verify the change
    const db = new ClipDatabase(tmpFile);
    try {
      const layers = db.getLayers();
      const layer = layers.find(l => l.id === 7);
      expect(layer).toBeDefined();
      expect(layer!.name).toBe('新しいレイヤー名');
    } finally {
      db.close();
    }
  });

  it('should save to output file without modifying original', () => {
    const outFile = join(tmpdir(), 'clip-clai-rename-out.clip');
    try {
      const out = run(`rename "${TEST_CLIP}" 7 "テスト名" -o "${outFile}"`);
      expect(out).toContain('Renamed layer #7');

      // Original should be unchanged
      const dbOrig = new ClipDatabase(TEST_CLIP);
      try {
        const layers = dbOrig.getLayers();
        expect(layers.find(l => l.id === 7)!.name).toBe('ラスターレイヤー');
      } finally {
        dbOrig.close();
      }

      // Output should have new name
      const dbOut = new ClipDatabase(outFile);
      try {
        const layers = dbOut.getLayers();
        expect(layers.find(l => l.id === 7)!.name).toBe('テスト名');
      } finally {
        dbOut.close();
      }
    } finally {
      try { unlinkSync(outFile); } catch {}
    }
  });
});
