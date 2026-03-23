import { createEmptyClip } from '../core/writer.js';

export function createCommand(
  filePath: string,
  opts: { width?: string; height?: string; dpi?: string; template?: string },
): void {
  const width = opts.width ? parseInt(opts.width, 10) : 1920;
  const height = opts.height ? parseInt(opts.height, 10) : 1080;
  const dpi = opts.dpi ? parseInt(opts.dpi, 10) : 72;

  createEmptyClip(filePath, { width, height, dpi, templatePath: opts.template });
  console.log(`Created ${filePath} (${width}x${height} @ ${dpi}dpi)`);
}
