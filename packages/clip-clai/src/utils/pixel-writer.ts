import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const TILE_SIZE = 256;

function toUtf16BE(str: string): Buffer {
  const buf = Buffer.from(str, 'utf16le');
  for (let i = 0; i < buf.length; i += 2) {
    const tmp = buf[i];
    buf[i] = buf[i + 1]!;
    buf[i + 1] = tmp;
  }
  return buf;
}

/**
 * Generate a unique external ID for a new CHNKExta chunk.
 */
export function generateExternalId(): string {
  return 'extrnlid' + randomBytes(16).toString('hex').toUpperCase();
}

/**
 * Convert RGBA pixel buffer to .clip's tile-based format and build a CHNKExta chunk.
 *
 * @param rgba RGBA buffer (4 bytes/pixel, row-major)
 * @param width Image width
 * @param height Image height
 * @param externalId The external ID for this chunk
 * @returns Complete CHNKExta chunk bytes (including CHNK header)
 */
export function buildExtaChunk(
  rgba: Buffer,
  width: number,
  height: number,
  externalId: string,
): Buffer {
  const tilesX = Math.ceil(width / TILE_SIZE);
  const tilesY = Math.ceil(height / TILE_SIZE);
  const totalTiles = tilesX * tilesY;

  // Build block data for all tiles
  const blockParts: Buffer[] = [];

  for (let tileIdx = 0; tileIdx < totalTiles; tileIdx++) {
    const tileX = tileIdx % tilesX;
    const tileY = Math.floor(tileIdx / tilesX);

    // Extract tile pixels: alpha plane + BGRA plane
    const alphaPlane = Buffer.alloc(TILE_SIZE * TILE_SIZE);
    const colorPlane = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);

    let hasContent = false;

    for (let py = 0; py < TILE_SIZE; py++) {
      for (let px = 0; px < TILE_SIZE; px++) {
        const srcX = tileX * TILE_SIZE + px;
        const srcY = tileY * TILE_SIZE + py;

        let r = 0, g = 0, b = 0, a = 0;
        if (srcX < width && srcY < height) {
          const srcIdx = (srcY * width + srcX) * 4;
          r = rgba[srcIdx]!;
          g = rgba[srcIdx + 1]!;
          b = rgba[srcIdx + 2]!;
          a = rgba[srcIdx + 3]!;
        }

        const tilePixelIdx = py * TILE_SIZE + px;
        alphaPlane[tilePixelIdx] = a;
        colorPlane[tilePixelIdx * 4] = b;     // B
        colorPlane[tilePixelIdx * 4 + 1] = g; // G
        colorPlane[tilePixelIdx * 4 + 2] = r; // R
        colorPlane[tilePixelIdx * 4 + 3] = a; // A (in BGRA plane too)

        if (a > 0) hasContent = true;
      }
    }

    const beginName = toUtf16BE('BlockDataBeginChunk');
    const endName = toUtf16BE('BlockDataEndChunk');

    if (hasContent) {
      // Compress: alpha + color planes concatenated
      const rawTile = Buffer.concat([alphaPlane, colorPlane]);
      const compressed = deflateSync(rawTile);
      const uncompressedSize = rawTile.length;

      // BlockDataBeginChunk header
      // Format: dataLen(4) + nameLen(4) + name + blockIndex(4) + uncompSize(4) + width(4) + height(4) + existFlag(4) + blockLen(4,BE) + compLen(4,LE) + compressedData
      const blockLen = 4 + compressed.length; // compLen field + compressed data
      const headerAfterName = Buffer.alloc(20 + 4 + 4 + compressed.length);
      headerAfterName.writeUInt32BE(tileIdx, 0);           // block index
      headerAfterName.writeUInt32BE(uncompressedSize, 4);   // uncompressed size
      headerAfterName.writeUInt32BE(TILE_SIZE, 8);          // block width
      headerAfterName.writeUInt32BE(TILE_SIZE, 12);         // block height
      headerAfterName.writeUInt32BE(1, 16);                 // exist flag = 1
      headerAfterName.writeUInt32BE(blockLen, 20);          // block_len (big-endian)
      headerAfterName.writeUInt32LE(compressed.length, 24); // block_len_2 (little-endian!)
      compressed.copy(headerAfterName, 28);

      // Sub-block: dataLen + nameLen + name + data
      const subBlockHeader = Buffer.alloc(8);
      subBlockHeader.writeUInt32BE(20 + 4 + 4 + compressed.length, 0); // total data len after name
      subBlockHeader.writeUInt32BE(beginName.length / 2, 4);            // name len in chars
      blockParts.push(subBlockHeader, beginName, headerAfterName);
    } else {
      // Empty tile
      const headerAfterName = Buffer.alloc(20);
      headerAfterName.writeUInt32BE(tileIdx, 0);
      headerAfterName.writeUInt32BE(TILE_SIZE * TILE_SIZE * 5, 4); // uncompressed size
      headerAfterName.writeUInt32BE(TILE_SIZE, 8);
      headerAfterName.writeUInt32BE(TILE_SIZE, 12);
      headerAfterName.writeUInt32BE(0, 16); // exist flag = 0

      const subBlockHeader = Buffer.alloc(8);
      subBlockHeader.writeUInt32BE(20, 0);
      subBlockHeader.writeUInt32BE(beginName.length / 2, 4);
      blockParts.push(subBlockHeader, beginName, headerAfterName);
    }

    // BlockDataEndChunk (uses 0x0042006C detection pattern)
    const endHeader = Buffer.alloc(4);
    endHeader.writeUInt32BE(endName.length / 2, 0); // nameLen as first uint32
    // Second uint32 will be 0x0042006C (first 4 bytes of the name itself)
    blockParts.push(endHeader, endName);
  }

  // BlockStatus
  const statusName = toUtf16BE('BlockStatus');
  const statusHeader = Buffer.alloc(4);
  statusHeader.writeUInt32BE(statusName.length / 2, 0);
  const statusData = Buffer.alloc(24);
  blockParts.push(statusHeader, statusName, statusData);

  // Assemble the block data
  const allBlockData = Buffer.concat(blockParts);

  // Build CHNKExta inner data: idLen(8) + id + dataSize(8) + blockData
  const extIdBuf = Buffer.from(externalId, 'ascii');
  const innerHeader = Buffer.alloc(8 + extIdBuf.length + 8);
  innerHeader.writeUInt32BE(0, 0);
  innerHeader.writeUInt32BE(extIdBuf.length, 4);
  extIdBuf.copy(innerHeader, 8);
  innerHeader.writeUInt32BE(0, 8 + extIdBuf.length);
  innerHeader.writeUInt32BE(allBlockData.length, 8 + extIdBuf.length + 4);

  const chunkData = Buffer.concat([innerHeader, allBlockData]);

  // Build CHNK header: "CHNKExta" + size(8)
  const chunkHeader = Buffer.alloc(16);
  chunkHeader.write('CHNKExta', 0, 8, 'ascii');
  chunkHeader.writeUInt32BE(0, 8);
  chunkHeader.writeUInt32BE(chunkData.length, 12);

  return Buffer.concat([chunkHeader, chunkData]);
}
