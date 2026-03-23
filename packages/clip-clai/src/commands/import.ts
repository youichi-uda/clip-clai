import sharp from 'sharp';
import { ClipWriter } from '../core/writer.js';

export async function importCommand(
  filePath: string,
  imagePath: string,
  opts: { name?: string; opacity?: string; blend?: string; output?: string },
): Promise<void> {
  // Read the image and convert to raw RGBA
  const image = sharp(imagePath);
  const meta = await image.metadata();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const writer = new ClipWriter(filePath);
  try {
    const layerId = writer.addLayer(data, info.width, info.height, {
      name: opts.name ?? imagePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''),
      opacity: opts.opacity ? parseInt(opts.opacity, 10) : undefined,
      blendMode: opts.blend,
    });

    writer.save(opts.output);
    console.log(`Imported "${imagePath}" as layer #${layerId} "${opts.name ?? ''}" (${info.width}x${info.height})`);
  } finally {
    writer.close();
  }
}
