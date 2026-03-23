import { describe, it, expect, afterEach } from 'vitest';
import { ClipDatabase } from '../src/core/database.js';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const TAMA_CLIP = resolve(FIXTURES, 'tama.clip');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');

describe('ClipDatabase - tama.clip (legacy schema)', () => {
  let db: ClipDatabase;

  afterEach(() => db?.close());

  it('should detect legacy schema', () => {
    db = new ClipDatabase(TAMA_CLIP);
    expect(db.schemaVersion).toBe('legacy');
  });

  it('should read project info', () => {
    db = new ClipDatabase(TAMA_CLIP);
    const info = db.getProjectInfo();
    expect(info.internalVersion).toBe('1.1.0');
    expect(info.canvasId).toBe(1);
  });

  it('should read canvas info', () => {
    db = new ClipDatabase(TAMA_CLIP);
    const canvas = db.getCanvasInfo();
    expect(canvas.width).toBe(2894);
    expect(canvas.height).toBe(4093);
    expect(canvas.resolution).toBe(350);
    expect(canvas.channelBytes).toBe(1);
    expect(canvas.rootFolderId).toBe(2);
  });

  it('should read preview image', () => {
    db = new ClipDatabase(TAMA_CLIP);
    const preview = db.getPreview();
    expect(preview).not.toBeNull();
    expect(preview!.width).toBeGreaterThan(0);
    expect(preview!.height).toBeGreaterThan(0);
    // Should be a PNG (starts with 0x89 50 4E 47)
    expect(preview!.data[0]).toBe(0x89);
    expect(preview!.data.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('should read layers', () => {
    db = new ClipDatabase(TAMA_CLIP);
    const layers = db.getLayers();
    expect(layers.length).toBeGreaterThan(10);

    // Root folder
    const root = layers.find(l => l.kind === 'root-folder');
    expect(root).toBeDefined();
    expect(root!.id).toBe(2);

    // Paper layer
    const paper = layers.find(l => l.kind === 'paper');
    expect(paper).toBeDefined();
    expect(paper!.name).toBe('用紙');

    // Adjustment layers
    const adjustments = layers.filter(l => l.kind === 'adjustment');
    expect(adjustments.length).toBe(2);

    // Check blend modes
    const overlay = layers.find(l => l.blendMode === 'overlay');
    expect(overlay).toBeDefined();
    const screen = layers.find(l => l.blendMode === 'screen');
    expect(screen).toBeDefined();
    const passThrough = layers.find(l => l.blendMode === 'pass-through');
    expect(passThrough).toBeDefined();

    // Opacity check
    const lowOpacity = layers.find(l => l.opacity < 50 && l.opacity > 0);
    expect(lowOpacity).toBeDefined();
  });

  it('should build layer tree', () => {
    db = new ClipDatabase(TAMA_CLIP);
    const tree = db.getLayerTree();
    expect(tree.length).toBe(1); // Single root
    expect(tree[0].kind).toBe('root-folder');
    expect(tree[0].children).toBeDefined();
    expect(tree[0].children!.length).toBeGreaterThan(0);
  });

  it('should list tables', () => {
    db = new ClipDatabase(TAMA_CLIP);
    const tables = db.getTableNames();
    expect(tables).toContain('Layer');
    expect(tables).toContain('Canvas');
    expect(tables).toContain('Offscreen');
  });
});

describe('ClipDatabase - test0323.clip (modern schema)', () => {
  let db: ClipDatabase;

  afterEach(() => db?.close());

  it('should detect modern schema', () => {
    db = new ClipDatabase(TEST_CLIP);
    expect(db.schemaVersion).toBe('modern');
  });

  it('should read canvas info', () => {
    db = new ClipDatabase(TEST_CLIP);
    const canvas = db.getCanvasInfo();
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.resolution).toBe(72);
  });

  it('should classify layer types correctly', () => {
    db = new ClipDatabase(TEST_CLIP);
    const layers = db.getLayers();

    // Raster layer with 加算 blend mode
    const raster = layers.find(l => l.name === 'ラスターレイヤー');
    expect(raster).toBeDefined();
    expect(raster!.kind).toBe('raster');
    expect(raster!.blendMode).toBe('add');

    // Vector layer with 加算(発光) blend mode
    const vector = layers.find(l => l.name === 'ベクターレイヤー');
    expect(vector).toBeDefined();
    expect(vector!.kind).toBe('vector');
    expect(vector!.blendMode).toBe('add-glow');

    // Text layer with 減算 blend mode
    const text = layers.find(l => l.name === 'テスト');
    expect(text).toBeDefined();
    expect(text!.kind).toBe('text');
    expect(text!.blendMode).toBe('subtract');
    expect(text!.textContent).toBe('テスト');

    // べた塗り
    const solid = layers.find(l => l.name === 'べた塗り 1');
    expect(solid).toBeDefined();
    expect(solid!.kind).toBe('solid-fill');

    // グラデーション
    const grad = layers.find(l => l.name === 'グラデーション 1');
    expect(grad).toBeDefined();
    // Both solid-fill and gradient have layerType=2, distinguished by GradationFillInfo content
    expect(['solid-fill', 'gradient']).toContain(grad!.kind);

    // Folder
    const folder = layers.find(l => l.name === 'フォルダー 1');
    expect(folder).toBeDefined();
    expect(folder!.kind).toBe('folder');

    // Paper
    const paper = layers.find(l => l.name === '用紙');
    expect(paper).toBeDefined();
    expect(paper!.kind).toBe('paper');
  });

  it('should resolve mipmap chain for raster layer', () => {
    db = new ClipDatabase(TEST_CLIP);
    const layers = db.getLayers();
    const raster = layers.find(l => l.name === 'ラスターレイヤー');
    expect(raster).toBeDefined();

    if (raster!.renderMipmapId) {
      const chain = db.getMipmapChain(raster!.renderMipmapId);
      expect(chain).not.toBeNull();
      expect(chain!.externalId).toMatch(/^extrnlid/);
    }
  });

  it('should build layer tree', () => {
    db = new ClipDatabase(TEST_CLIP);
    const tree = db.getLayerTree();
    expect(tree.length).toBe(1);
    expect(tree[0].children).toBeDefined();

    // Folder should have child
    const folder = tree[0].children!.find(l => l.name === 'フォルダー 1');
    if (folder) {
      expect(folder.children).toBeDefined();
      expect(folder.children!.length).toBeGreaterThan(0);
    }
  });
});
