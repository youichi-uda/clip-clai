import sharp from 'sharp';
import { ClipDatabase } from '../core/database.js';
import { extractLayerPixels } from '../utils/pixel.js';

export async function exportCommand(
  filePath: string,
  layerIdStr: string,
  opts: { output?: string },
): Promise<void> {
  const layerId = parseInt(layerIdStr, 10);
  if (isNaN(layerId)) {
    console.error(`Invalid layer ID: ${layerIdStr}`);
    process.exit(1);
  }

  const db = new ClipDatabase(filePath);
  try {
    const canvas = db.getCanvasInfo();
    const layers = db.getLayers();
    const layer = layers.find(l => l.id === layerId);

    if (!layer) {
      console.error(`Layer #${layerId} not found`);
      process.exit(1);
    }

    if (canvas.channelBytes !== 1) {
      console.error(`Unsupported color depth: ${canvas.channelBytes * 8}bit (only 8bit supported)`);
      process.exit(1);
    }

    if (!layer.renderMipmapId) {
      console.error(`Layer #${layerId} "${layer.name}" has no pixel data`);
      process.exit(1);
    }

    const chain = db.getMipmapChain(layer.renderMipmapId);
    if (!chain) {
      console.error(`Could not resolve mipmap chain for layer #${layerId}`);
      process.exit(1);
    }

    const pixels = extractLayerPixels(
      filePath,
      chain.externalId,
      canvas.width,
      canvas.height,
    );

    const outPath = opts.output ?? `layer_${layerId}.png`;

    await sharp(pixels.rgba, {
      raw: { width: pixels.width, height: pixels.height, channels: 4 },
    })
      .png()
      .toFile(outPath);

    console.log(`Exported layer #${layerId} "${layer.name}" → ${outPath} (${pixels.width}x${pixels.height})`);
  } finally {
    db.close();
  }
}
