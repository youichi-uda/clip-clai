import { readFileSync, copyFileSync } from 'node:fs';
import { ClipWriter } from '../core/writer.js';
import { ClipDatabase } from '../core/database.js';

interface TemplateLayer {
  name: string;
  opacity?: number;
  blend?: string;
  parent?: string; // folder name to put this layer in
}

interface TemplateConfig {
  base: string; // path to template .clip file
  output: string; // output .clip file path
  layers: TemplateLayer[];
}

/**
 * Expand a template config into a fully populated .clip file.
 */
export function templateCommand(configPath: string): void {
  const raw = readFileSync(configPath, 'utf-8');
  const config: TemplateConfig = JSON.parse(raw);

  if (!config.base) {
    console.error('Template config must have "base" (path to template .clip file)');
    process.exit(1);
  }
  if (!config.output) {
    console.error('Template config must have "output" (output .clip path)');
    process.exit(1);
  }

  // Copy base template
  copyFileSync(config.base, config.output);

  // Build a folder name → ID map from the base template
  const db = new ClipDatabase(config.output);
  const existingLayers = db.getLayers();
  const folderMap = new Map<string, number>();
  for (const l of existingLayers) {
    if (l.kind === 'folder' || l.kind === 'root-folder') {
      folderMap.set(l.name, l.id);
    }
  }
  db.close();

  // Add layers one by one
  for (const layerDef of config.layers) {
    const writer = new ClipWriter(config.output);
    try {
      let parentId: number | undefined;
      if (layerDef.parent) {
        parentId = folderMap.get(layerDef.parent);
        if (!parentId) {
          console.error(`Folder "${layerDef.parent}" not found in template. Available: ${[...folderMap.keys()].join(', ')}`);
          process.exit(1);
        }
      }

      const layerId = writer.addEmptyLayer({
        name: layerDef.name,
        opacity: layerDef.opacity,
        blendMode: layerDef.blend,
        parentId,
      });

      writer.save();
      console.log(`  + ${layerDef.parent ? layerDef.parent + '/' : ''}${layerDef.name}${layerDef.blend ? ' [' + layerDef.blend + ']' : ''}${layerDef.opacity !== undefined ? ' ' + layerDef.opacity + '%' : ''}`);
    } finally {
      writer.close();
    }
  }

  // Show final structure
  const finalDb = new ClipDatabase(config.output);
  const tree = finalDb.getLayerTree();
  const { formatLayers } = require('../utils/format.js');
  console.log(`\nCreated: ${config.output}`);
  console.log(formatLayers(tree, false));
  finalDb.close();
}
