import { writeFileSync } from 'node:fs';
import { writePsd, Layer as PsdLayer, Psd } from 'ag-psd';
import { ClipDatabase } from '../core/database.js';
import { extractLayerPixels } from '../utils/pixel.js';
import { parseTextLayer, parseFilterLayerInfo, parseSolidOrGradientFill, parseLayerEffects } from '../utils/clip-to-psd-advanced.js';
import type { LayerInfo } from '../core/types.js';

// ag-psd Node.js canvas shim
import { initializeCanvas } from 'ag-psd';

function createCanvas(width: number, height: number) {
  return {
    width, height,
    getContext: () => ({
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: () => {},
      createImageData: (w: number, h: number) => ({
        width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
      }),
      fillRect: () => {},
      clearRect: () => {},
      canvas: { width, height },
    }),
  } as any;
}
initializeCanvas(createCanvas, (imgData: any) => createCanvas(imgData.width, imgData.height));

const BLEND_MODE_MAP: Record<string, string> = {
  'normal': 'normal', 'multiply': 'multiply', 'screen': 'screen',
  'overlay': 'overlay', 'darken': 'darken', 'lighten': 'lighten',
  'color-dodge': 'color dodge', 'color-burn': 'color burn',
  'hard-light': 'hard light', 'soft-light': 'soft light',
  'difference': 'difference', 'exclusion': 'exclusion',
  'hue': 'hue', 'saturation': 'saturation', 'color': 'color',
  'luminosity': 'luminosity', 'linear-burn': 'linear burn',
  'add': 'linear dodge', 'add-glow': 'linear dodge',
  'subtract': 'subtract', 'divide': 'divide',
  'vivid-light': 'vivid light', 'linear-light': 'linear light',
  'pin-light': 'pin light', 'hard-mix': 'hard mix',
  'pass-through': 'pass through',
};

export async function toPsdCommand(
  filePath: string,
  opts: { output?: string; skipPixels?: boolean },
): Promise<void> {
  const db = new ClipDatabase(filePath);

  try {
    const canvas = db.getCanvasInfo();

    if (canvas.channelBytes !== 1) {
      console.error(`Unsupported color depth: ${canvas.channelBytes * 8}bit (only 8bit supported)`);
      process.exit(1);
    }

    const tree = db.getLayerTree();
    if (tree.length === 0) {
      console.error('No layers found');
      process.exit(1);
    }

    const root = tree[0];
    let layerCount = 0;
    let textCount = 0;
    let adjustmentCount = 0;
    let effectCount = 0;
    let fillCount = 0;

    function convertLayer(layer: LayerInfo): PsdLayer | null {
      if (layer.kind === 'root-folder' || layer.kind === 'paper') return null;

      const psdLayer: PsdLayer = {
        name: layer.name || `Layer ${layer.id}`,
        opacity: Math.min(255, layer.opacityRaw) / 255,
        blendMode: (BLEND_MODE_MAP[layer.blendMode] ?? 'normal') as any,
        hidden: !layer.visible,
        clipping: layer.clipping,
      };

      // Get raw data for advanced features
      const rawData = db.getLayerRawData(layer.id);

      // === Folder ===
      if (layer.kind === 'folder') {
        psdLayer.opened = true;
        psdLayer.children = (layer.children ?? [])
          .map(c => convertLayer(c))
          .filter((l): l is PsdLayer => l !== null);
        layerCount++;
        return psdLayer;
      }

      // === Text layer ===
      if (layer.kind === 'text' && layer.textContent) {
        const textData = parseTextLayer(rawData.textString, rawData.textAttributes);
        if (textData) {
          psdLayer.text = textData;
          textCount++;
        }
        layerCount++;
        return psdLayer;
      }

      // === Adjustment layer ===
      if (layer.kind === 'adjustment') {
        const adjustment = parseFilterLayerInfo(rawData.filterLayerInfo, layer.specialRenderType);
        if (adjustment) {
          psdLayer.adjustment = adjustment;
          adjustmentCount++;
        }
        layerCount++;
        return psdLayer;
      }

      // === Solid fill / Gradient ===
      if (layer.kind === 'solid-fill' || layer.kind === 'gradient') {
        const fill = parseSolidOrGradientFill(rawData.gradationFillInfo);
        if (fill?.type === 'solid') {
          psdLayer.adjustment = {
            type: 'solid color',
            color: fill.color,
          } as any;
          fillCount++;
        }
        layerCount++;
        return psdLayer;
      }

      // === Layer effects ===
      const effects = parseLayerEffects(rawData.layerEffectInfo);
      if (effects) {
        psdLayer.effects = effects;
        effectCount++;
      }

      // === Raster layer — extract pixels ===
      if (!opts.skipPixels && layer.renderMipmapId) {
        try {
          const chain = db.getMipmapChain(layer.renderMipmapId);
          if (chain) {
            const pixels = extractLayerPixels(filePath, chain.externalId, canvas.width, canvas.height);
            psdLayer.imageData = {
              width: pixels.width,
              height: pixels.height,
              data: new Uint8ClampedArray(pixels.rgba.buffer, pixels.rgba.byteOffset, pixels.rgba.byteLength),
            };
          }
        } catch {
          // Skip pixel extraction errors
        }
      }

      layerCount++;
      return psdLayer;
    }

    const psdLayers: PsdLayer[] = (root.children ?? [])
      .map(c => convertLayer(c))
      .filter((l): l is PsdLayer => l !== null);

    const psd: Psd = {
      width: canvas.width,
      height: canvas.height,
      children: psdLayers,
    };

    const outPath = opts.output ?? filePath.replace(/\.clip$/i, '.psd');
    const buffer = writePsd(psd);
    writeFileSync(outPath, Buffer.from(buffer));

    const details = [
      `${layerCount} layers`,
      textCount > 0 ? `${textCount} text` : '',
      adjustmentCount > 0 ? `${adjustmentCount} adjustment` : '',
      fillCount > 0 ? `${fillCount} fill` : '',
      effectCount > 0 ? `${effectCount} effects` : '',
    ].filter(Boolean).join(', ');

    console.log(`Exported PSD: ${outPath} (${canvas.width}x${canvas.height}, ${details})`);
  } finally {
    db.close();
  }
}
