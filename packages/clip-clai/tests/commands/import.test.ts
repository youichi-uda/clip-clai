import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { copyFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
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

describe('import command', () => {
  const tmpClip = join(tmpdir(), 'clip-clai-import-test.clip');
  const tmpPng = join(tmpdir(), 'clip-clai-import-test.png');

  afterEach(() => {
    try { unlinkSync(tmpClip); } catch {}
    try { unlinkSync(tmpClip + '.bak'); } catch {}
    try { unlinkSync(tmpPng); } catch {}
  });

  it('should import a PNG as a new raster layer', async () => {
    // Create a test PNG (red 100x100 square)
    await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } },
    }).png().toFile(tmpPng);

    copyFileSync(TEST_CLIP, tmpClip);

    // Count layers before
    const dbBefore = new ClipDatabase(tmpClip);
    const layersBefore = dbBefore.getLayers().length;
    dbBefore.close();

    // Import
    const out = run(`import "${tmpClip}" "${tmpPng}" --name "Red Square"`);
    expect(out).toContain('Imported');
    expect(out).toContain('Red Square');

    // Verify layer was added
    const dbAfter = new ClipDatabase(tmpClip);
    try {
      const layersAfter = dbAfter.getLayers();
      expect(layersAfter.length).toBe(layersBefore + 1);

      const newLayer = layersAfter.find(l => l.name === 'Red Square');
      expect(newLayer).toBeDefined();
      expect(newLayer!.kind).toBe('raster');
      expect(newLayer!.visible).toBe(true);
    } finally {
      dbAfter.close();
    }
  });

  it('should import with custom blend mode and opacity', async () => {
    await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 128 } },
    }).png().toFile(tmpPng);

    copyFileSync(TEST_CLIP, tmpClip);

    run(`import "${tmpClip}" "${tmpPng}" --name "Green Overlay" --blend overlay --opacity 75`);

    const db = new ClipDatabase(tmpClip);
    try {
      const layer = db.getLayers().find(l => l.name === 'Green Overlay');
      expect(layer).toBeDefined();
      expect(layer!.blendMode).toBe('overlay');
      expect(layer!.opacity).toBe(75);
    } finally {
      db.close();
    }
  });

  it('should be able to export the imported layer back as PNG', async () => {
    await sharp({
      create: { width: 200, height: 150, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 255 } },
    }).png().toFile(tmpPng);

    copyFileSync(TEST_CLIP, tmpClip);

    const importOut = run(`import "${tmpClip}" "${tmpPng}" --name "Blue Rect"`);
    // Extract layer ID from output
    const idMatch = importOut.match(/layer #(\d+)/);
    expect(idMatch).not.toBeNull();
    const newLayerId = idMatch![1];

    // Export the imported layer
    const exportPng = join(tmpdir(), 'clip-clai-reimport-test.png');
    try {
      run(`export "${tmpClip}" ${newLayerId} -o "${exportPng}"`);

      // Verify the exported PNG has non-zero pixels
      const { data, info } = await sharp(exportPng).raw().toBuffer({ resolveWithObject: true });
      // The blue rect should have blue pixels somewhere
      let bluePixelCount = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 2]! > 200 && data[i]! < 50 && data[i + 1]! < 50) {
          bluePixelCount++;
        }
      }
      expect(bluePixelCount).toBeGreaterThan(0);
    } finally {
      try { unlinkSync(exportPng); } catch {}
    }
  });
});
