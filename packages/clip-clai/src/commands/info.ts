import { ClipDatabase } from '../core/database.js';
import { formatInfo } from '../utils/format.js';

export function infoCommand(filePath: string, opts: { json?: boolean }): void {
  const db = new ClipDatabase(filePath);
  try {
    const project = db.getProjectInfo();
    const canvas = db.getCanvasInfo();
    const layers = db.getLayers();
    console.log(formatInfo(project, canvas, layers.length, db.schemaVersion, opts.json ?? false));
  } finally {
    db.close();
  }
}
