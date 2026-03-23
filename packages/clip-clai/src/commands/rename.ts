import { ClipWriter } from '../core/writer.js';

export function renameCommand(filePath: string, layerIdStr: string, newName: string, opts: { output?: string }): void {
  const layerId = parseInt(layerIdStr, 10);
  if (isNaN(layerId)) {
    console.error(`Invalid layer ID: ${layerIdStr}`);
    process.exit(1);
  }

  const writer = new ClipWriter(filePath);
  try {
    writer.renameLayer(layerId, newName);
    writer.save(opts.output);
    console.log(`Renamed layer #${layerId} → "${newName}"`);
  } finally {
    writer.close();
  }
}
