import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import type { ClipFile } from '../core/types.js';

function toUtf16BE(str: string): Buffer {
  const buf = Buffer.from(str, 'utf16le');
  for (let i = 0; i < buf.length; i += 2) {
    const tmp = buf[i];
    buf[i] = buf[i + 1]!;
    buf[i + 1] = tmp;
  }
  return buf;
}

const BLOCK_DATA_BEGIN = toUtf16BE('BlockDataBeginChunk');
const BLOCK_DATA_END = toUtf16BE('BlockDataEndChunk');
const BLOCK_STATUS = toUtf16BE('BlockStatus');
const BLOCK_CHECKSUM = toUtf16BE('BlockCheckSum');

const TILE_SIZE = 256;

export interface PixelData {
  width: number;
  height: number;
  /** RGBA pixel buffer, 4 bytes per pixel, row-major */
  rgba: Buffer;
}

/**
 * Extract pixel data for a layer from a .clip file.
 *
 * @param clipFilePath Path to the .clip file
 * @param externalId The external ID (from Offscreen.BlockData / mipmap chain)
 * @param canvasWidth Canvas width in pixels
 * @param canvasHeight Canvas height in pixels
 */
const MAX_CANVAS_DIMENSION = 65536;
const MAX_UNCOMPRESSED_TILE_SIZE = 256 * 320 * 4 * 2; // 2x safety margin for 16-bit

export function extractLayerPixels(
  clipFilePath: string,
  externalId: string,
  canvasWidth: number,
  canvasHeight: number,
): PixelData {
  if (canvasWidth <= 0 || canvasHeight <= 0 ||
      canvasWidth > MAX_CANVAS_DIMENSION || canvasHeight > MAX_CANVAS_DIMENSION) {
    throw new Error(`Canvas dimensions out of range: ${canvasWidth}x${canvasHeight}`);
  }
  const fileData = readFileSync(clipFilePath);
  const chunkData = findExternalChunkData(fileData, externalId);
  if (!chunkData) {
    throw new Error(`External chunk not found: ${externalId}`);
  }

  const blocks = parseBlocks(chunkData);

  const tilesX = Math.ceil(canvasWidth / TILE_SIZE);
  const tilesY = Math.ceil(canvasHeight / TILE_SIZE);
  const paddedW = tilesX * TILE_SIZE;
  const paddedH = tilesY * TILE_SIZE;

  // Allocate RGBA output buffer
  const rgba = Buffer.alloc(paddedW * paddedH * 4);

  for (let i = 0; i < blocks.length && i < tilesX * tilesY; i++) {
    const tileX = i % tilesX;
    const tileY = Math.floor(i / tilesX);
    const block = blocks[i];

    if (!block || block.length === 0) continue;

    // Determine packing: check if block size matches (1+4)*256*256 = 5*65536 = 327680
    const expectedColorSize = TILE_SIZE * TILE_SIZE * 5; // 1 alpha + 4 BGRA
    if (block.length >= expectedColorSize) {
      // Color layer: first 256*256 bytes = alpha, next 256*256*4 bytes = BGRA
      const alphaSize = TILE_SIZE * TILE_SIZE;
      for (let py = 0; py < TILE_SIZE; py++) {
        for (let px = 0; px < TILE_SIZE; px++) {
          const srcAlphaIdx = py * TILE_SIZE + px;
          const srcColorIdx = alphaSize + (py * TILE_SIZE + px) * 4;
          const dstIdx = ((tileY * TILE_SIZE + py) * paddedW + (tileX * TILE_SIZE + px)) * 4;

          const b = block[srcColorIdx];
          const g = block[srcColorIdx + 1];
          const r = block[srcColorIdx + 2];
          const a = block[srcAlphaIdx];

          rgba[dstIdx] = r;
          rgba[dstIdx + 1] = g;
          rgba[dstIdx + 2] = b;
          rgba[dstIdx + 3] = a;
        }
      }
    } else if (block.length >= TILE_SIZE * TILE_SIZE) {
      // Grayscale/mask: single channel
      for (let py = 0; py < TILE_SIZE; py++) {
        for (let px = 0; px < TILE_SIZE; px++) {
          const srcIdx = py * TILE_SIZE + px;
          const dstIdx = ((tileY * TILE_SIZE + py) * paddedW + (tileX * TILE_SIZE + px)) * 4;
          const v = block[srcIdx];
          rgba[dstIdx] = v;
          rgba[dstIdx + 1] = v;
          rgba[dstIdx + 2] = v;
          rgba[dstIdx + 3] = 255;
        }
      }
    }
  }

  // Crop to actual canvas size
  if (paddedW === canvasWidth && paddedH === canvasHeight) {
    return { width: canvasWidth, height: canvasHeight, rgba };
  }

  const cropped = Buffer.alloc(canvasWidth * canvasHeight * 4);
  for (let y = 0; y < canvasHeight; y++) {
    rgba.copy(cropped, y * canvasWidth * 4, y * paddedW * 4, y * paddedW * 4 + canvasWidth * 4);
  }
  return { width: canvasWidth, height: canvasHeight, rgba: cropped };
}

/**
 * Find the CHNKExta chunk data for a given external ID.
 */
function findExternalChunkData(fileData: Buffer, externalId: string): Buffer | null {
  const extIdBuf = Buffer.from(externalId, 'ascii');

  let pos = 0;
  while (pos < fileData.length - 16) {
    // Look for "CHNKExta"
    if (
      fileData[pos] === 0x43 && // C
      fileData[pos + 1] === 0x48 && // H
      fileData[pos + 2] === 0x4e && // N
      fileData[pos + 3] === 0x4b && // K
      fileData[pos + 4] === 0x45 && // E
      fileData[pos + 5] === 0x78 && // x
      fileData[pos + 6] === 0x74 && // t
      fileData[pos + 7] === 0x61    // a
    ) {
      const chunkSize = fileData.readUInt32BE(pos + 8) * 0x100000000 + fileData.readUInt32BE(pos + 12);
      const dataStart = pos + 16;

      // Read external ID from chunk
      if (dataStart + 8 <= fileData.length) {
        const idLen = fileData.readUInt32BE(dataStart) * 0x100000000 + fileData.readUInt32BE(dataStart + 4);
        if (idLen > 0 && idLen < 1000 && dataStart + 8 + idLen <= fileData.length) {
          const chunkExtId = fileData.subarray(dataStart + 8, dataStart + 8 + idLen);
          if (chunkExtId.equals(extIdBuf)) {
            // Found the right chunk - return the data portion after the ID and size fields
            const dataAfterIdStart = dataStart + 8 + idLen + 8; // +8 for data size field
            return fileData.subarray(dataAfterIdStart, dataStart + chunkSize);
          }
        }
      }

      pos = dataStart + chunkSize;
    } else {
      pos++;
    }
  }

  return null;
}

/**
 * Parse block data from a CHNKExta chunk's data section.
 * Returns an array of decompressed tile buffers.
 */
function parseBlocks(data: Buffer): (Buffer | null)[] {
  const blocks: (Buffer | null)[] = [];
  let pos = 0;

  while (pos < data.length - 8) {
    // Read sub-block header: two uint32 values
    const val1 = data.readUInt32BE(pos);
    const val2 = data.readUInt32BE(pos + 4);

    // Detect block name by checking if val2 matches start of UTF-16BE "Bl" (0x0042006C)
    let blockNameLen: number;
    let blockDataLen: number;

    if (val2 === 0x0042006C) {
      // val2 is actually the start of the block name, not a separate field
      blockNameLen = val1;
      blockDataLen = 0;
      pos += 4; // advance past val1 only; name starts at val2's position
    } else {
      blockDataLen = val1;
      blockNameLen = val2;
      pos += 8; // advance past both fields; name starts after
    }

    if (blockNameLen <= 0 || blockNameLen > 200) break;

    const nameBytes = data.subarray(pos, pos + blockNameLen * 2);
    pos += blockNameLen * 2;

    if (nameBytes.length < BLOCK_DATA_BEGIN.length && nameBytes.length < BLOCK_STATUS.length) {
      break;
    }

    if (bufStartsWith(nameBytes, BLOCK_DATA_BEGIN)) {
      // BlockDataBeginChunk: parse tile data
      if (pos + 20 > data.length) break;

      const _blockIndex = data.readUInt32BE(pos);
      const uncompressedSize = data.readUInt32BE(pos + 4);
      const _blockWidth = data.readUInt32BE(pos + 8);
      const _blockHeight = data.readUInt32BE(pos + 12);
      const existFlag = data.readUInt32BE(pos + 16);

      if (existFlag > 0) {
        if (pos + 28 > data.length) break;
        const blockLen = data.readUInt32BE(pos + 20);
        const compressedLen = data.readUInt32LE(pos + 24); // Little-endian!
        const compressedData = data.subarray(pos + 28, pos + 28 + compressedLen);

        if (uncompressedSize > MAX_UNCOMPRESSED_TILE_SIZE) {
          throw new Error(`Tile uncompressed size too large: ${uncompressedSize}`);
        }
        try {
          const decompressed = inflateSync(compressedData);
          blocks.push(decompressed);
        } catch {
          blocks.push(Buffer.alloc(uncompressedSize));
        }
        pos = pos + 20 + blockLen;
      } else {
        blocks.push(Buffer.alloc(uncompressedSize));
        pos += 20;
      }
    } else if (bufStartsWith(nameBytes, BLOCK_DATA_END)) {
      // End marker
      continue;
    } else if (bufStartsWith(nameBytes, BLOCK_STATUS) || bufStartsWith(nameBytes, BLOCK_CHECKSUM)) {
      // Metadata blocks: skip 24 bytes
      pos += 24;
    } else {
      // Unknown block type, try to skip
      if (blockDataLen > 0) {
        pos += blockDataLen;
      }
    }
  }

  return blocks;
}

function bufStartsWith(buf: Buffer, prefix: Buffer): boolean {
  if (buf.length < prefix.length) return false;
  return buf.subarray(0, prefix.length).equals(prefix);
}
