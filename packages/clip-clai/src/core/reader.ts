import { readFileSync } from 'node:fs';
import type { ClipChunk, ClipFile } from './types.js';

const CSFCHUNK_MAGIC = Buffer.from('CSFCHUNK', 'ascii');
const CHUNK_MARKER = Buffer.from('CHNK', 'ascii');
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii');

/**
 * Parse a .clip file and extract chunk structure.
 * Does NOT extract SQLite to disk - that's done lazily by database.ts.
 */
export function readClipFile(filePath: string): ClipFile {
  const data = readFileSync(filePath);
  return parseClipBuffer(data, filePath);
}

export function parseClipBuffer(data: Buffer, filePath: string = '<buffer>'): ClipFile {
  if (data.length < 24) {
    throw new Error(`File too small to be a .clip file: ${data.length} bytes`);
  }

  // Validate CSFCHUNK header
  if (!data.subarray(0, 8).equals(CSFCHUNK_MAGIC)) {
    throw new Error(`Not a .clip file: missing CSFCHUNK magic at offset 0`);
  }

  const chunks: ClipChunk[] = [];
  let sqliteOffset = -1;
  let sqliteSize = 0;

  // Skip CSFCHUNK header (24 bytes: 8 magic + 8 file length + 8 offset)
  let pos = 24;

  while (pos + 16 <= data.length) {
    // Each chunk: 4 bytes "CHNK" + 4 bytes type + 8 bytes size
    if (!data.subarray(pos, pos + 4).equals(CHUNK_MARKER)) {
      break; // No more chunks
    }

    const typeStr = data.subarray(pos + 4, pos + 8).toString('ascii');
    const chunkSize = readBigEndianUint64(data, pos + 8);
    const dataOffset = pos + 16;

    // Validate chunk boundary fits in file
    if (dataOffset + chunkSize > data.length) {
      throw new Error(
        `Chunk "${typeStr}" at offset ${pos} declares size ${chunkSize} but only ${data.length - dataOffset} bytes remain`,
      );
    }

    chunks.push({
      type: typeStr,
      offset: pos,
      size: chunkSize,
      dataOffset,
    });

    if (typeStr === 'SQLi') {
      if (sqliteOffset >= 0) {
        throw new Error('Multiple SQLi chunks found in .clip file');
      }
      sqliteOffset = dataOffset;
      sqliteSize = chunkSize;

      // Verify SQLite magic inside the chunk
      if (chunkSize >= 16 && !data.subarray(dataOffset, dataOffset + 16).equals(SQLITE_MAGIC)) {
        throw new Error('SQLi chunk does not contain valid SQLite data');
      }
    }

    pos = dataOffset + chunkSize;
  }

  if (sqliteOffset < 0) {
    throw new Error('No SQLite database found in .clip file');
  }

  return {
    filePath,
    fileSize: data.length,
    chunks,
    sqliteOffset,
    sqliteSize,
  };
}

/**
 * Extract the raw SQLite database bytes from a .clip file.
 */
export function extractSqliteBuffer(filePath: string): Buffer;
export function extractSqliteBuffer(data: Buffer, clipFile: ClipFile): Buffer;
export function extractSqliteBuffer(
  filePathOrData: string | Buffer,
  clipFile?: ClipFile,
): Buffer {
  if (typeof filePathOrData === 'string') {
    const data = readFileSync(filePathOrData);
    const cf = parseClipBuffer(data, filePathOrData);
    return data.subarray(cf.sqliteOffset, cf.sqliteOffset + cf.sqliteSize);
  }
  if (!clipFile) throw new Error('clipFile required when passing Buffer');
  return filePathOrData.subarray(
    clipFile.sqliteOffset,
    clipFile.sqliteOffset + clipFile.sqliteSize,
  );
}

/**
 * Read a big-endian uint64. Throws if the value exceeds Number.MAX_SAFE_INTEGER.
 * In practice .clip chunk sizes are well under 4GB so high word is always 0.
 */
function readBigEndianUint64(buf: Buffer, offset: number): number {
  const high = buf.readUInt32BE(offset);
  const low = buf.readUInt32BE(offset + 4);
  const value = high * 0x100000000 + low;
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Chunk size ${value} exceeds safe integer range`);
  }
  return value;
}
