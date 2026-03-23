import { ClipDatabase } from '../core/database.js';
import { formatLayers } from '../utils/format.js';

export function layersCommand(filePath: string, opts: { json?: boolean; flat?: boolean }): void {
  const db = new ClipDatabase(filePath);
  try {
    const layers = opts.flat ? db.getLayers() : db.getLayerTree();
    console.log(formatLayers(layers, opts.json ?? false));
  } finally {
    db.close();
  }
}
