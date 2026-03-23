import type { CanvasInfo, LayerInfo, ProjectInfo, BlendMode, LayerKind } from '../core/types.js';

export function formatInfo(
  project: ProjectInfo,
  canvas: CanvasInfo,
  layerCount: number,
  schemaVersion: string,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify({ project, canvas, layerCount, schemaVersion }, null, 2);
  }

  const bitDepth = canvas.channelBytes === 1 ? '8bit' : canvas.channelBytes === 2 ? '16bit' : `${canvas.channelBytes * 8}bit`;

  return [
    `Canvas: ${canvas.width}x${canvas.height} @ ${canvas.resolution}dpi (${bitDepth})`,
    `Profile: ${canvas.srcProfileName ?? 'none'}`,
    `Layers: ${layerCount}`,
    `Schema: ${schemaVersion}`,
    `Version: ${project.internalVersion}`,
  ].join('\n');
}

export function formatLayers(tree: LayerInfo[], json: boolean): string {
  if (json) {
    return JSON.stringify(tree, null, 2);
  }

  const lines: string[] = [];
  function walk(layers: LayerInfo[], depth: number) {
    for (const l of layers) {
      const indent = '  '.repeat(depth);
      const vis = l.visible ? ' ' : 'H';
      const mask = l.maskEnabled ? 'M' : ' ';
      const clip = l.clipping ? 'C' : ' ';
      const kind = kindLabel(l.kind);
      const blend = l.blendMode !== 'normal' ? ` [${l.blendMode}]` : '';
      const opacity = l.opacity < 100 ? ` ${l.opacity}%` : '';
      const text = l.textContent ? ` "${l.textContent}"` : '';
      lines.push(`${indent}${vis}${mask}${clip} #${l.id} ${kind} "${l.name}"${blend}${opacity}${text}`);
      if (l.children) walk(l.children, depth + 1);
    }
  }
  walk(tree, 0);
  return lines.join('\n');
}

function kindLabel(kind: LayerKind): string {
  const labels: Record<LayerKind, string> = {
    'raster': 'RASTER',
    'vector': 'VECTOR',
    'text': 'TEXT',
    'folder': 'FOLDER',
    'root-folder': 'ROOT',
    'solid-fill': 'SOLID',
    'gradient': 'GRADIENT',
    'adjustment': 'ADJUST',
    'paper': 'PAPER',
    'unknown': '???',
  };
  return labels[kind];
}
