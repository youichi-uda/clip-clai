import { writeFileSync } from 'node:fs';
import { ClipDatabase } from '../core/database.js';

export function thumbnailCommand(filePath: string, opts: { output?: string }): void {
  const db = new ClipDatabase(filePath);
  try {
    const preview = db.getPreview();
    if (!preview) {
      console.error('No preview image found in file');
      process.exit(1);
    }

    const outPath = opts.output ?? filePath.replace(/\.clip$/i, '_thumb.png');
    writeFileSync(outPath, preview.data);
    console.log(`Thumbnail saved: ${outPath} (${preview.width}x${preview.height})`);
  } finally {
    db.close();
  }
}
