/**
 * Advanced .clip → PSD conversion helpers.
 * Parses CSP-specific data (text, adjustment, solid/gradient, effects)
 * and converts them to ag-psd Layer properties.
 */
import type { Layer as PsdLayer } from 'ag-psd';

// ========================================
// Text layer parsing
// ========================================

export interface ClipTextInfo {
  text: string;
  fontSize: number;
  fontName: string;
  color: { r: number; g: number; b: number };
}

/**
 * Parse text layer data from modern schema (TextLayerString + TextLayerAttributes).
 */
export function parseTextLayer(
  textString: Buffer | null,
  textAttributes: Buffer | null,
): PsdLayer['text'] | null {
  if (!textString) return null;

  const text = textString.toString('utf-8');
  if (!text) return null;

  const textData: PsdLayer['text'] = {
    text,
    orientation: 'horizontal',
    antiAlias: 'sharp',
  };

  // Parse attributes if available
  if (textAttributes && textAttributes.length > 20) {
    try {
      const parsed = parseTextAttributes(textAttributes);
      if (parsed) {
        textData.style = {
          fontSize: parsed.fontSize,
          font: { name: parsed.fontName },
          fillColor: parsed.color,
        };
      }
    } catch {
      // Fall back to text-only
    }
  }

  return textData;
}

function parseTextAttributes(buf: Buffer): ClipTextInfo | null {
  // TextLayerAttributes is a binary blob with parameter sections
  // Basic structure: series of (paramId: int32, ...) entries
  let pos = 0;
  let fontSize = 24;
  let fontName = 'Arial';
  let color = { r: 0, g: 0, b: 0 };

  try {
    while (pos + 8 < buf.length) {
      const paramId = buf.readUInt32LE(pos);
      const sectionSize = buf.readUInt32LE(pos + 4);

      if (sectionSize <= 0 || sectionSize > buf.length - pos) break;

      const sectionEnd = pos + 8 + sectionSize;

      // Known param IDs from clip_to_psd analysis
      if (paramId === 32 && pos + 12 <= buf.length) {
        // Font size
        fontSize = buf.readUInt32LE(pos + 8);
      }

      pos = sectionEnd;
    }
  } catch {
    // Best effort
  }

  return { text: '', fontSize, fontName, color };
}

// ========================================
// Adjustment layer parsing (FilterLayerInfo)
// ========================================

/**
 * Parse FilterLayerInfo to determine adjustment type and params.
 * Format: filterType (uint32 BE) + dataSize (uint32 BE) + data
 */
export function parseFilterLayerInfo(
  filterInfo: Buffer | null,
  specialRenderType: number | null,
): PsdLayer['adjustment'] | null {
  if (specialRenderType !== 13) return null;
  if (!filterInfo || filterInfo.length < 8) return null;

  try {
    const filterType = filterInfo.readUInt32BE(0);
    const dataSize = filterInfo.readUInt32BE(4);
    const data = filterInfo.subarray(8, 8 + dataSize);

    switch (filterType) {
      case 1: return parseBrightnessContrast(data);
      case 2: return parseLevels(data);
      case 3: return parseCurves(data);
      case 4: return parseHueSaturation(data);
      case 5: return parseColorBalance(data);
      case 6: return { type: 'invert' } as any;
      case 9: return { type: 'gradient map' } as any;
      default: return null;
    }
  } catch {
    return null;
  }
}

function parseBrightnessContrast(data: Buffer): PsdLayer['adjustment'] {
  if (data.length < 8) return { type: 'brightness/contrast', brightness: 0, contrast: 0 } as any;
  return {
    type: 'brightness/contrast',
    brightness: data.readInt32BE(0),
    contrast: data.readInt32BE(4),
  } as any;
}

function parseLevels(data: Buffer): PsdLayer['adjustment'] {
  if (data.length < 10) return { type: 'levels' } as any;
  // 5 x int16 BE per channel entry
  return {
    type: 'levels',
    rgb: {
      inputFloor: data.readUInt16BE(0),
      inputCeiling: data.readUInt16BE(2),
      outputFloor: data.readUInt16BE(4),
      outputCeiling: data.readUInt16BE(6),
      gamma: data.readUInt16BE(8) / 100,
    },
  } as any;
}

function parseCurves(data: Buffer): PsdLayer['adjustment'] {
  // 130 bytes per channel (Composite, R, G, B)
  // Each channel: first uint16 = point count, then pairs of (input, output) uint16
  const channelSize = 130;
  const channels: Record<string, Array<{ input: number; output: number }>> = {};
  const channelNames = ['rgb', 'red', 'green', 'blue'];

  for (let ch = 0; ch < 4 && (ch * channelSize + channelSize) <= data.length; ch++) {
    const offset = ch * channelSize;
    const pointCount = data.readUInt16BE(offset);
    const points: Array<{ input: number; output: number }> = [];

    // Skip first 2 values (point count + unknown), then read point pairs
    // Each point: 2 bytes unknown/flags, then actual curve data follows
    // The structure varies; for PSD we need (input, output) pairs 0-255
    if (pointCount >= 2 && pointCount <= 32) {
      // Default: straight line
      points.push({ input: 0, output: 0 });
      points.push({ input: 255, output: 255 });
    }

    channels[channelNames[ch]] = points;
  }

  return {
    type: 'curves',
    ...channels,
  } as any;
}

function parseHueSaturation(data: Buffer): PsdLayer['adjustment'] {
  if (data.length < 12) return { type: 'hue/saturation', master: { hue: 0, saturation: 0, lightness: 0 } } as any;
  return {
    type: 'hue/saturation',
    master: {
      hue: data.readInt32BE(0),
      saturation: data.readInt32BE(4),
      lightness: data.readInt32BE(8),
    },
  } as any;
}

function parseColorBalance(data: Buffer): PsdLayer['adjustment'] {
  // Structure: subCount(4BE) + 9 x int32 BE values
  // Values: shadow(CR, MG, YB), midtone(CR, MG, YB), highlight(CR, MG, YB)
  if (data.length < 40) {
    return {
      type: 'color balance',
      shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: true,
    } as any;
  }

  const pos = 4; // skip subCount
  return {
    type: 'color balance',
    shadows: {
      cyanRed: data.readInt32BE(pos),
      magentaGreen: data.readInt32BE(pos + 4),
      yellowBlue: data.readInt32BE(pos + 8),
    },
    midtones: {
      cyanRed: data.readInt32BE(pos + 12),
      magentaGreen: data.readInt32BE(pos + 16),
      yellowBlue: data.readInt32BE(pos + 20),
    },
    highlights: {
      cyanRed: data.readInt32BE(pos + 24),
      magentaGreen: data.readInt32BE(pos + 28),
      yellowBlue: data.readInt32BE(pos + 32),
    },
    preserveLuminosity: true,
  } as any;
}

// ========================================
// Solid color / gradient fill parsing
// ========================================

export function parseSolidOrGradientFill(
  gradationFillInfo: Buffer | null,
): { type: 'solid'; color: { r: number; g: number; b: number } } |
   { type: 'gradient' } |
   null {
  if (!gradationFillInfo || gradationFillInfo.length < 40) return null;

  // GradationFillInfo contains UTF-16BE "GradationData" section
  // Parse color stops to determine if it's solid (1 color) or gradient
  try {
    // Search for color data
    // First bytes: total size, section count, then UTF-16BE "GradationData" name
    const pos = 8; // skip header
    // Read section name length
    const nameLen = gradationFillInfo.readUInt32BE(pos);
    if (nameLen > 0 && nameLen < 50) {
      const nameEnd = pos + 4 + nameLen * 2;
      if (nameEnd + 80 <= gradationFillInfo.length) {
        // After name section, look for color values
        // Color stops are encoded as int32 values shifted by 24 bits
        // For a solid fill, there's typically one color
        const dataStart = nameEnd;

        // Try to find RGB values in the remaining data
        // Look for the pattern after header sections
        let searchPos = dataStart + 20;
        if (searchPos + 12 <= gradationFillInfo.length) {
          const r = Math.min(255, gradationFillInfo.readUInt32BE(searchPos) >>> 24);
          const g = Math.min(255, gradationFillInfo.readUInt32BE(searchPos + 4) >>> 24);
          const b = Math.min(255, gradationFillInfo.readUInt32BE(searchPos + 8) >>> 24);

          if (r > 0 || g > 0 || b > 0) {
            return { type: 'solid', color: { r, g, b } };
          }
        }
      }
    }
  } catch {
    // Fall through
  }

  return { type: 'gradient' };
}

// ========================================
// Layer effects (LayerEffectInfo) parsing
// ========================================

export function parseLayerEffects(
  effectInfo: Buffer | null,
): PsdLayer['effects'] | null {
  if (!effectInfo || effectInfo.length < 20) return null;

  try {
    // Search for UTF-16BE "EffectEdge" in the blob
    const effectEdge = Buffer.from('EffectEdge', 'utf16le');
    // Swap to BE
    for (let i = 0; i < effectEdge.length; i += 2) {
      const tmp = effectEdge[i];
      effectEdge[i] = effectEdge[i + 1]!;
      effectEdge[i + 1] = tmp;
    }

    const idx = effectInfo.indexOf(effectEdge);
    if (idx < 0) return null;

    // After the name, parse: enabled (int32), thickness (double), R/G/B (int32 each)
    let pos = idx + effectEdge.length;
    if (pos + 28 > effectInfo.length) return null;

    const enabled = effectInfo.readUInt32BE(pos);
    if (!enabled) return null;

    const thickness = effectInfo.readDoubleBE(pos + 4);
    const r = (effectInfo.readUInt32BE(pos + 12) >>> 24) & 0xff;
    const g = (effectInfo.readUInt32BE(pos + 16) >>> 24) & 0xff;
    const b = (effectInfo.readUInt32BE(pos + 20) >>> 24) & 0xff;

    return {
      stroke: [{
        enabled: true,
        size: { value: thickness, units: 'Pixels' } as any,
        position: 'outside',
        fillType: 'color',
        color: { r, g, b },
        opacity: { value: 100, units: 'Percent' } as any,
      }],
    } as any;
  } catch {
    return null;
  }
}
