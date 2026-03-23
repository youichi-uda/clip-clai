import { ClipWriter } from '../core/writer.js';

export function mkdirCommand(
  filePath: string,
  folderName: string,
  opts: { blend?: string; output?: string },
): void {
  const writer = new ClipWriter(filePath);
  try {
    const folderId = writer.addFolder({
      name: folderName,
      blendMode: opts.blend,
    });
    writer.save(opts.output);
    console.log(`Created folder #${folderId} "${folderName}"`);
  } finally {
    writer.close();
  }
}
