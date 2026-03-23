import { ClipWriter } from '../core/writer.js';

export function addLayerCommand(
  filePath: string,
  opts: { name?: string; parent?: string; opacity?: string; blend?: string; output?: string },
): void {
  const writer = new ClipWriter(filePath);
  try {
    const parentId = opts.parent ? parseInt(opts.parent, 10) : undefined;
    const layerId = writer.addEmptyLayer({
      name: opts.name,
      parentId,
      opacity: opts.opacity ? parseInt(opts.opacity, 10) : undefined,
      blendMode: opts.blend,
    });
    writer.save(opts.output);
    console.log(`Created empty layer #${layerId} "${opts.name ?? ''}"`);
  } finally {
    writer.close();
  }
}
