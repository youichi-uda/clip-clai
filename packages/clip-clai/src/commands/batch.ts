import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { ClipDatabase } from '../core/database.js';
import { ClipWriter } from '../core/writer.js';
import { formatInfo } from '../utils/format.js';
import { Glob } from 'glob';

interface BatchResult {
  file: string;
  success: boolean;
  message: string;
}

/**
 * Run a batch operation across multiple .clip files.
 */
export async function batchCommand(
  pattern: string,
  operation: string,
  args: string[],
  opts: { json?: boolean; dryRun?: boolean },
): Promise<void> {
  const glob = new Glob(pattern, { absolute: true });
  const files: string[] = [];
  for await (const f of glob) {
    if (f.endsWith('.clip')) files.push(f);
  }

  if (files.length === 0) {
    console.error(`No .clip files matched: ${pattern}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} file(s)`);
  if (opts.dryRun) {
    for (const f of files) console.log(`  ${f}`);
    console.log('(dry run — no changes made)');
    return;
  }

  const results: BatchResult[] = [];

  for (const file of files) {
    try {
      const msg = await runOperation(file, operation, args);
      results.push({ file, success: true, message: msg });
      console.log(`OK ${file}: ${msg}`);
    } catch (err) {
      const msg = (err as Error).message;
      results.push({ file, success: false, message: msg });
      console.error(`FAIL ${file}: ${msg}`);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  }

  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`\nDone: ${ok} succeeded, ${fail} failed`);
}

async function runOperation(file: string, operation: string, args: string[]): Promise<string> {
  switch (operation) {
    case 'info': {
      const db = new ClipDatabase(file);
      try {
        const project = db.getProjectInfo();
        const canvas = db.getCanvasInfo();
        const layers = db.getLayers();
        return `${canvas.width}x${canvas.height} @ ${canvas.resolution}dpi, ${layers.length} layers`;
      } finally {
        db.close();
      }
    }

    case 'rename': {
      if (args.length < 2) throw new Error('Usage: batch <pattern> rename <layer-id> <new-name>');
      const layerId = parseInt(args[0], 10);
      const newName = args[1];
      const writer = new ClipWriter(file);
      try {
        writer.renameLayer(layerId, newName);
        writer.save();
        return `Renamed layer #${layerId} → "${newName}"`;
      } finally {
        writer.close();
      }
    }

    case 'edit': {
      if (args.length < 2) throw new Error('Usage: batch <pattern> edit <layer-id> <key=value>...');
      const layerId = parseInt(args[0], 10);
      const writer = new ClipWriter(file);
      try {
        const changes: string[] = [];
        for (let i = 1; i < args.length; i++) {
          const [key, value] = args[i].split('=');
          switch (key) {
            case 'opacity':
              writer.setOpacity(layerId, parseInt(value, 10));
              changes.push(`opacity=${value}%`);
              break;
            case 'blend':
              writer.setBlendMode(layerId, value);
              changes.push(`blend=${value}`);
              break;
            case 'visible':
              writer.setVisibility(layerId, value === 'true');
              changes.push(`visible=${value}`);
              break;
            default:
              throw new Error(`Unknown edit key: ${key}`);
          }
        }
        writer.save();
        return `Edited layer #${layerId}: ${changes.join(', ')}`;
      } finally {
        writer.close();
      }
    }

    case 'set-dpi': {
      if (args.length < 1) throw new Error('Usage: batch <pattern> set-dpi <dpi>');
      const dpi = parseFloat(args[0]);
      const writer = new ClipWriter(file);
      try {
        (writer as any).db.prepare('UPDATE Canvas SET CanvasResolution = ?').run(dpi);
        writer.save();
        return `DPI set to ${dpi}`;
      } finally {
        writer.close();
      }
    }

    case 'layers': {
      const db = new ClipDatabase(file);
      try {
        const layers = db.getLayers();
        const names = layers.map(l => `${l.name}(${l.kind})`).join(', ');
        return names;
      } finally {
        db.close();
      }
    }

    default:
      throw new Error(`Unknown batch operation: ${operation}. Valid: info, layers, rename, edit, set-dpi`);
  }
}
