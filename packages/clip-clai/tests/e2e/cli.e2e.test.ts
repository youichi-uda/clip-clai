import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { copyFileSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CLI = resolve(import.meta.dirname, '../../src/index.ts');
const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');
const TAMA_CLIP = resolve(FIXTURES, 'tama.clip');

function run(args: string): string {
  return execSync(`npx tsx "${CLI}" ${args}`, {
    cwd: resolve(import.meta.dirname, '../..'),
    encoding: 'utf-8',
    env: { ...process.env, CLIP_CLAI_LICENSE_BYPASS: '1' },
  });
}

describe('E2E: Read operations on test0323.clip', () => {
  it('info → layers → export round-trip', () => {
    // Step 1: Get info
    const infoJson = JSON.parse(run(`info "${TEST_CLIP}" --json`));
    expect(infoJson.canvas.width).toBe(1600);
    expect(infoJson.canvas.height).toBe(1200);

    // Step 2: Get layers
    const layers = JSON.parse(run(`layers "${TEST_CLIP}" --flat --json`));
    const rasterLayer = layers.find((l: any) => l.kind === 'raster');
    expect(rasterLayer).toBeDefined();
    expect(rasterLayer.blendMode).toBe('add');

    const vectorLayer = layers.find((l: any) => l.kind === 'vector');
    expect(vectorLayer).toBeDefined();
    expect(vectorLayer.blendMode).toBe('add-glow');

    const textLayer = layers.find((l: any) => l.kind === 'text');
    expect(textLayer).toBeDefined();
    expect(textLayer.blendMode).toBe('subtract');
    expect(textLayer.textContent).toBe('テスト');

    // Step 3: Export raster layer
    const outPng = join(tmpdir(), 'e2e-export.png');
    try {
      run(`export "${TEST_CLIP}" ${rasterLayer.id} -o "${outPng}"`);
      const png = readFileSync(outPng);
      expect(png[0]).toBe(0x89);
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    } finally {
      try { unlinkSync(outPng); } catch {}
    }
  });

  it('thumbnail extraction', () => {
    const outPng = join(tmpdir(), 'e2e-thumb.png');
    try {
      run(`thumbnail "${TEST_CLIP}" -o "${outPng}"`);
      expect(existsSync(outPng)).toBe(true);
      const png = readFileSync(outPng);
      expect(png[0]).toBe(0x89);
    } finally {
      try { unlinkSync(outPng); } catch {}
    }
  });

  it('inspect shows tables and chunks', () => {
    const data = JSON.parse(run(`inspect "${TEST_CLIP}" --json`));
    expect(data.file.chunks.length).toBeGreaterThan(3);
    expect(data.tables.find((t: any) => t.name === 'Layer')).toBeDefined();
    expect(data.schemaVersion).toBe('modern');
  });
});

describe('E2E: Read operations on tama.clip (legacy schema)', () => {
  it('info works with legacy schema', () => {
    const infoJson = JSON.parse(run(`info "${TAMA_CLIP}" --json`));
    expect(infoJson.canvas.width).toBe(2894);
    expect(infoJson.schemaVersion).toBe('legacy');
  });

  it('layers work with legacy schema', () => {
    const tree = JSON.parse(run(`layers "${TAMA_CLIP}" --json`));
    expect(tree[0].kind).toBe('root-folder');
    expect(tree[0].children.length).toBeGreaterThan(0);
  });
});

describe('E2E: Write → Read round-trip', () => {
  const tmpFile = join(tmpdir(), 'e2e-write-test.clip');

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch {}
    try { unlinkSync(tmpFile + '.bak'); } catch {}
  });

  it('rename → verify → rename back', () => {
    copyFileSync(TEST_CLIP, tmpFile);

    // Read original name
    const before = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    const layer7 = before.find((l: any) => l.id === 7);
    const originalName = layer7.name;
    expect(originalName).toBe('ラスターレイヤー');

    // Rename
    run(`rename "${tmpFile}" 7 "E2E_renamed"`);

    // Verify
    const after = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    expect(after.find((l: any) => l.id === 7).name).toBe('E2E_renamed');

    // Rename back
    run(`rename "${tmpFile}" 7 "${originalName}"`);
    const restored = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    expect(restored.find((l: any) => l.id === 7).name).toBe(originalName);
  });

  it('edit opacity + blend → verify → revert', () => {
    copyFileSync(TEST_CLIP, tmpFile);

    // Edit
    run(`edit "${tmpFile}" 7 --opacity 30 --blend multiply`);

    // Verify
    const after = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    const layer7 = after.find((l: any) => l.id === 7);
    expect(layer7.opacity).toBe(30);
    expect(layer7.blendMode).toBe('multiply');

    // Revert
    run(`edit "${tmpFile}" 7 --opacity 100 --blend add`);
    const reverted = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    expect(reverted.find((l: any) => l.id === 7).opacity).toBe(100);
    expect(reverted.find((l: any) => l.id === 7).blendMode).toBe('add');
  });

  it('edit visibility toggle', () => {
    copyFileSync(TEST_CLIP, tmpFile);

    // Hide
    run(`edit "${tmpFile}" 7 --hidden`);
    const hidden = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    expect(hidden.find((l: any) => l.id === 7).visible).toBe(false);

    // Show
    run(`edit "${tmpFile}" 7 --visible`);
    const visible = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    expect(visible.find((l: any) => l.id === 7).visible).toBe(true);
  });

  it('multiple writes preserve file integrity', () => {
    copyFileSync(TEST_CLIP, tmpFile);

    // Do 5 successive writes
    for (let i = 0; i < 5; i++) {
      run(`rename "${tmpFile}" 7 "Round_${i}"`);
    }

    // Verify final state and all other layers unchanged
    const final = JSON.parse(run(`layers "${tmpFile}" --flat --json`));
    expect(final.find((l: any) => l.id === 7).name).toBe('Round_4');
    expect(final.length).toBe(9); // Same layer count

    // Verify export still works
    const outPng = join(tmpdir(), 'e2e-integrity.png');
    try {
      run(`export "${tmpFile}" 7 -o "${outPng}"`);
      expect(existsSync(outPng)).toBe(true);
    } finally {
      try { unlinkSync(outPng); } catch {}
    }
  });
});
