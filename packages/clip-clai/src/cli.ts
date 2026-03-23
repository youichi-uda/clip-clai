import { Command } from 'commander';
import { infoCommand } from './commands/info.js';
import { layersCommand } from './commands/layers.js';
import { inspectCommand } from './commands/inspect.js';
import { thumbnailCommand } from './commands/thumbnail.js';
import { exportCommand } from './commands/export.js';
import { renameCommand } from './commands/rename.js';
import { editCommand } from './commands/edit.js';
import { importCommand } from './commands/import.js';
import { createCommand } from './commands/create.js';
import { mkdirCommand } from './commands/mkdir.js';
import { addLayerCommand } from './commands/add-layer.js';
import { batchCommand } from './commands/batch.js';
import { templateCommand } from './commands/template.js';
import { toPsdCommand } from './commands/to-psd.js';
import { activateLicense, deactivateLicense, getLicenseStatus, requirePro } from './core/license.js';

export function createCli(): Command {
  const program = new Command()
    .name('clip-clai')
    .description('CLI tool for manipulating Clip Studio Paint .clip files')
    .version('0.1.0');

  // === Free commands ===

  program
    .command('info')
    .description('Show canvas info, layer count, and metadata')
    .argument('<file>', '.clip file path')
    .option('--json', 'Output as JSON')
    .action((file, opts) => infoCommand(file, opts));

  program
    .command('layers')
    .description('List layers as a tree')
    .argument('<file>', '.clip file path')
    .option('--json', 'Output as JSON')
    .option('--flat', 'Flat list instead of tree')
    .action((file, opts) => layersCommand(file, opts));

  program
    .command('inspect')
    .description('Dump SQLite structure and chunk info')
    .argument('<file>', '.clip file path')
    .option('--json', 'Output as JSON')
    .action((file, opts) => inspectCommand(file, opts));

  program
    .command('thumbnail')
    .description('Export canvas preview thumbnail')
    .argument('<file>', '.clip file path')
    .option('-o, --output <path>', 'Output file path')
    .action((file, opts) => thumbnailCommand(file, opts));

  program
    .command('export')
    .description('Export a layer as PNG')
    .argument('<file>', '.clip file path')
    .argument('<layer-id>', 'Layer ID (MainId)')
    .option('-o, --output <path>', 'Output file path')
    .action(async (file, layerId, opts) => {
      await exportCommand(file, layerId, opts);
    });

  // === Pro commands ===

  program
    .command('rename')
    .description('[Pro] Rename a layer')
    .argument('<file>', '.clip file path')
    .argument('<layer-id>', 'Layer ID (MainId)')
    .argument('<new-name>', 'New layer name')
    .option('-o, --output <path>', 'Save to a different file instead of overwriting')
    .action(async (file, layerId, newName, opts) => {
      await requirePro('rename');
      renameCommand(file, layerId, newName, opts);
    });

  program
    .command('edit')
    .description('[Pro] Edit layer properties')
    .argument('<file>', '.clip file path')
    .argument('<layer-id>', 'Layer ID (MainId)')
    .option('--opacity <percent>', 'Set opacity (0-100)')
    .option('--blend <mode>', 'Set blend mode (normal, multiply, add, etc.)')
    .option('--visible', 'Make layer visible')
    .option('--hidden', 'Hide layer')
    .option('-o, --output <path>', 'Save to a different file instead of overwriting')
    .action(async (file, layerId, opts) => {
      await requirePro('edit');
      editCommand(file, layerId, opts);
    });

  program
    .command('import')
    .description('[Pro] Import an image as a new raster layer')
    .argument('<file>', '.clip file path')
    .argument('<image>', 'Image file to import (PNG, JPEG, etc.)')
    .option('--name <name>', 'Layer name')
    .option('--opacity <percent>', 'Layer opacity (0-100)')
    .option('--blend <mode>', 'Blend mode')
    .option('-o, --output <path>', 'Save to a different file instead of overwriting')
    .action(async (file, image, opts) => {
      await requirePro('import');
      await importCommand(file, image, opts);
    });

  program
    .command('create')
    .description('[Pro] Create a new empty .clip file')
    .argument('<file>', 'Output .clip file path')
    .option('--width <px>', 'Canvas width (default: 1920)')
    .option('--height <px>', 'Canvas height (default: 1080)')
    .option('--dpi <dpi>', 'Resolution (default: 72)')
    .option('--template <path>', 'Use an existing .clip file as template (recommended)')
    .action(async (file, opts) => {
      await requirePro('create');
      createCommand(file, opts);
    });

  program
    .command('mkdir')
    .description('[Pro] Create a folder layer')
    .argument('<file>', '.clip file path')
    .argument('<name>', 'Folder name')
    .option('--blend <mode>', 'Blend mode (default: pass-through)')
    .option('-o, --output <path>', 'Save to a different file')
    .action(async (file, name, opts) => {
      await requirePro('mkdir');
      mkdirCommand(file, name, opts);
    });

  program
    .command('add-layer')
    .description('[Pro] Add an empty raster layer')
    .argument('<file>', '.clip file path')
    .option('--name <name>', 'Layer name')
    .option('--parent <id>', 'Parent folder layer ID')
    .option('--opacity <percent>', 'Opacity (0-100)')
    .option('--blend <mode>', 'Blend mode')
    .option('-o, --output <path>', 'Save to a different file')
    .action(async (file, opts) => {
      await requirePro('add-layer');
      addLayerCommand(file, opts);
    });

  program
    .command('batch')
    .description('[Pro] Run an operation on multiple .clip files')
    .argument('<pattern>', 'Glob pattern (e.g. "manga/**/*.clip")')
    .argument('<operation>', 'Operation: info, layers, rename, edit, set-dpi')
    .argument('[args...]', 'Operation arguments')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Preview matched files without changes')
    .action(async (pattern, operation, args, opts) => {
      await requirePro('batch');
      await batchCommand(pattern, operation, args, opts);
    });

  program
    .command('template')
    .description('[Pro] Expand a template config into a .clip file')
    .argument('<config>', 'JSON config file path')
    .action(async (config) => {
      await requirePro('template');
      templateCommand(config);
    });

  program
    .command('to-psd')
    .description('[Pro] Convert .clip to PSD format')
    .argument('<file>', '.clip file path')
    .option('-o, --output <path>', 'Output PSD file path')
    .option('--skip-pixels', 'Export structure only (no pixel data)')
    .action(async (file, opts) => {
      await requirePro('to-psd');
      await toPsdCommand(file, opts);
    });

  // === License management ===

  program
    .command('activate')
    .description('Activate a Pro license key')
    .argument('<key>', 'License key from Gumroad')
    .action(async (key) => {
      const result = await activateLicense(key);
      if (result.success) {
        console.log(`License activated: ${result.message}`);
      } else {
        console.error(`Activation failed: ${result.message}`);
        process.exit(1);
      }
    });

  program
    .command('deactivate')
    .description('Deactivate the current license')
    .action(() => {
      deactivateLicense();
      console.log('License deactivated');
    });

  program
    .command('status')
    .description('Show license status')
    .action(() => {
      const status = getLicenseStatus();
      if (status.active) {
        console.log(`Pro license active`);
        console.log(`  Email: ${status.email}`);
        console.log(`  Last verified: ${status.lastVerified}`);
      } else {
        console.log('Free tier (no Pro license)');
        console.log('  Get Pro: https://youichi-uda.gumroad.com/l/clip-clai-pro');
      }
    });

  return program;
}
