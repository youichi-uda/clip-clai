import { ClipWriter, getValidBlendModes } from '../core/writer.js';

export function editCommand(
  filePath: string,
  layerIdStr: string,
  opts: { opacity?: string; blend?: string; visible?: boolean; hidden?: boolean; output?: string },
): void {
  const layerId = parseInt(layerIdStr, 10);
  if (isNaN(layerId)) {
    console.error(`Invalid layer ID: ${layerIdStr}`);
    process.exit(1);
  }

  const writer = new ClipWriter(filePath);
  try {
    if (opts.visible && opts.hidden) {
      console.error('Cannot use both --visible and --hidden');
      process.exit(1);
    }

    const changes: string[] = [];

    if (opts.opacity !== undefined) {
      const opacity = parseInt(opts.opacity, 10);
      if (isNaN(opacity)) {
        console.error(`Invalid opacity: ${opts.opacity}`);
        process.exit(1);
      }
      writer.setOpacity(layerId, opacity);
      changes.push(`opacity=${opacity}%`);
    }

    if (opts.blend !== undefined) {
      writer.setBlendMode(layerId, opts.blend);
      changes.push(`blend=${opts.blend}`);
    }

    if (opts.visible) {
      writer.setVisibility(layerId, true);
      changes.push('visible=true');
    } else if (opts.hidden) {
      writer.setVisibility(layerId, false);
      changes.push('visible=false');
    }

    if (changes.length === 0) {
      console.error(`No changes specified. Use --opacity, --blend, --visible, or --hidden`);
      process.exit(1);
    }

    writer.save(opts.output);
    console.log(`Updated layer #${layerId}: ${changes.join(', ')}`);
  } finally {
    writer.close();
  }
}
