import { describe, it, expect, afterEach } from 'vitest';
import { extractLayerPixels } from '../src/utils/pixel.js';
import { ClipDatabase } from '../src/core/database.js';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');

describe('extractLayerPixels', () => {
  let db: ClipDatabase;

  afterEach(() => db?.close());

  it('should extract raster layer pixels from test0323.clip', () => {
    db = new ClipDatabase(TEST_CLIP);
    const canvas = db.getCanvasInfo();
    const layers = db.getLayers();
    const raster = layers.find(l => l.name === 'ラスターレイヤー');
    expect(raster).toBeDefined();
    expect(raster!.renderMipmapId).toBeGreaterThan(0);

    const chain = db.getMipmapChain(raster!.renderMipmapId);
    expect(chain).not.toBeNull();

    const pixels = extractLayerPixels(
      TEST_CLIP,
      chain!.externalId,
      canvas.width,
      canvas.height,
    );

    expect(pixels.width).toBe(canvas.width);
    expect(pixels.height).toBe(canvas.height);
    expect(pixels.rgba.length).toBe(canvas.width * canvas.height * 4);

    // Should have at least some non-zero pixels (the user drew something)
    let nonZeroCount = 0;
    for (let i = 3; i < pixels.rgba.length; i += 4) {
      if (pixels.rgba[i] > 0) nonZeroCount++;
    }
    expect(nonZeroCount).toBeGreaterThan(0);
  });

  it('should throw for invalid external ID', () => {
    expect(() =>
      extractLayerPixels(TEST_CLIP, 'extrnlidINVALID', 100, 100),
    ).toThrow('External chunk not found');
  });
});
