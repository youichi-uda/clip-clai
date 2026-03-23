import { describe, it, expect } from 'vitest';
import { readClipFile, extractSqliteBuffer, parseClipBuffer } from '../src/core/reader.js';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const TAMA_CLIP = resolve(FIXTURES, 'tama.clip');
const TEST_CLIP = resolve(FIXTURES, 'test0323.clip');

describe('readClipFile', () => {
  it('should parse tama.clip chunk structure', () => {
    const clip = readClipFile(TAMA_CLIP);
    expect(clip.fileSize).toBe(59943731);
    expect(clip.chunks.length).toBeGreaterThan(3);
    expect(clip.sqliteOffset).toBeGreaterThan(0);

    // First chunk should be Head
    expect(clip.chunks[0].type).toBe('Head');

    // Should have at least one Exta chunk
    const extaChunks = clip.chunks.filter(c => c.type === 'Exta');
    expect(extaChunks.length).toBeGreaterThan(0);

    // Should have exactly one SQLi chunk
    const sqliChunks = clip.chunks.filter(c => c.type === 'SQLi');
    expect(sqliChunks.length).toBe(1);

    // Last chunk should be Foot
    expect(clip.chunks[clip.chunks.length - 1].type).toBe('Foot');
  });

  it('should parse test0323.clip chunk structure', () => {
    const clip = readClipFile(TEST_CLIP);
    expect(clip.fileSize).toBe(1372022);
    expect(clip.chunks.length).toBeGreaterThan(3);
    expect(clip.sqliteOffset).toBeGreaterThan(0);
  });

  it('should throw on non-.clip file', () => {
    expect(() => readClipFile(resolve(FIXTURES, 'nonexistent.clip'))).toThrow();
  });

  it('should throw on invalid data', () => {
    expect(() => parseClipBuffer(Buffer.from('not a clip file'))).toThrow();
    // Also test with a buffer >= 24 bytes but wrong magic
    const fakeBuf = Buffer.alloc(100, 0);
    expect(() => parseClipBuffer(fakeBuf)).toThrow('Not a .clip file');
  });
});

describe('extractSqliteBuffer', () => {
  it('should extract valid SQLite from tama.clip', () => {
    const sqlBuf = extractSqliteBuffer(TAMA_CLIP);
    expect(sqlBuf.subarray(0, 16).toString('ascii')).toBe('SQLite format 3\0');
    expect(sqlBuf.length).toBeGreaterThan(1000);
  });

  it('should extract valid SQLite from test0323.clip', () => {
    const sqlBuf = extractSqliteBuffer(TEST_CLIP);
    expect(sqlBuf.subarray(0, 16).toString('ascii')).toBe('SQLite format 3\0');
  });
});
