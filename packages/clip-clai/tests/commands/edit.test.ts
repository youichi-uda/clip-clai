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

describe('edit command', () => {
  const tmpFile = join(tmpdir(), 'clip-clai-edit-test.clip');

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch {}
    try { unlinkSync(tmpFile + '.bak'); } catch {}
  });

  it('should change opacity', () => {
    copyFileSync(TEST_CLIP, tmpFile);
    run(`edit "${tmpFile}" 7 --opacity 50`);

    const db = new ClipDatabase(tmpFile);
    try {
      const layer = db.getLayers().find(l => l.id === 7);
      expect(layer!.opacity).toBe(50);
    } finally {
      db.close();
    }
  });

  it('should change blend mode', () => {
    copyFileSync(TEST_CLIP, tmpFile);
    run(`edit "${tmpFile}" 7 --blend multiply`);

    const db = new ClipDatabase(tmpFile);
    try {
      const layer = db.getLayers().find(l => l.id === 7);
      expect(layer!.blendMode).toBe('multiply');
    } finally {
      db.close();
    }
  });

  it('should change visibility', () => {
    copyFileSync(TEST_CLIP, tmpFile);
    run(`edit "${tmpFile}" 7 --hidden`);

    const db = new ClipDatabase(tmpFile);
    try {
      const layer = db.getLayers().find(l => l.id === 7);
      expect(layer!.visible).toBe(false);
    } finally {
      db.close();
    }
  });

  it('should apply multiple changes at once', () => {
    copyFileSync(TEST_CLIP, tmpFile);
    run(`edit "${tmpFile}" 7 --opacity 75 --blend overlay`);

    const db = new ClipDatabase(tmpFile);
    try {
      const layer = db.getLayers().find(l => l.id === 7);
      expect(layer!.opacity).toBe(75);
      expect(layer!.blendMode).toBe('overlay');
    } finally {
      db.close();
    }
  });
});
