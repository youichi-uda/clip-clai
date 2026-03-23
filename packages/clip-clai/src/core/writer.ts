import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, unlinkSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { parseClipBuffer } from './reader.js';
import { buildExtaChunk, generateExternalId } from '../utils/pixel-writer.js';
import type { BlendMode } from './types.js';

const BLEND_NAME_TO_VALUE: Record<string, number> = {
  'normal': 0, 'darken': 1, 'multiply': 2, 'color-burn': 3,
  'linear-burn': 4, 'subtract': 5, 'darker-color': 6, 'lighten': 7,
  'screen': 8, 'color-dodge': 9, 'add': 11, 'add-glow': 12,
  'lighter-color': 13, 'overlay': 14, 'soft-light': 15, 'hard-light': 16,
  'vivid-light': 17, 'linear-light': 18, 'pin-light': 19, 'hard-mix': 20,
  'difference': 21, 'exclusion': 22, 'hue': 23, 'saturation': 24,
  'color': 25, 'luminosity': 26, 'pass-through': 30, 'divide': 36,
};

export class ClipWriter {
  private filePath: string;
  private data: Buffer;
  private clipFile: ReturnType<typeof parseClipBuffer>;
  private tmpDbPath: string;
  private db: Database.Database;
  private newChunks: Buffer[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = readFileSync(filePath);
    this.clipFile = parseClipBuffer(this.data, filePath);

    const sqlBuf = this.data.subarray(
      this.clipFile.sqliteOffset,
      this.clipFile.sqliteOffset + this.clipFile.sqliteSize,
    );
    this.tmpDbPath = join(tmpdir(), `clip-clai-w-${randomBytes(8).toString('hex')}.db`);
    writeFileSync(this.tmpDbPath, sqlBuf);
    this.db = new Database(this.tmpDbPath);
  }

  private nextId(table: string): number {
    const row = this.db.prepare('SELECT MaxIndex FROM ElemScheme WHERE TableName = ?').get(table) as { MaxIndex: number } | undefined;
    const newId = ((row?.MaxIndex) ?? 0) + 1;
    this.db.prepare('UPDATE ElemScheme SET MaxIndex = ? WHERE TableName = ?').run(newId, table);
    return newId;
  }

  private getCanvasInfo(): { canvasId: number; rootFolderId: number } {
    const row = this.db.prepare('SELECT MainId, CanvasRootFolder FROM Canvas').get() as {
      MainId: number; CanvasRootFolder: number;
    };
    return { canvasId: row.MainId, rootFolderId: row.CanvasRootFolder };
  }

  /** Insert a new layer as the topmost child of a parent folder */
  private insertAsTopChild(parentId: number, newLayerId: number): void {
    const parent = this.db.prepare('SELECT LayerFirstChildIndex FROM Layer WHERE MainId = ?').get(parentId) as {
      LayerFirstChildIndex: number;
    } | undefined;

    if (!parent || parent.LayerFirstChildIndex === 0) {
      this.db.prepare('UPDATE Layer SET LayerFirstChildIndex = ? WHERE MainId = ?').run(newLayerId, parentId);
    } else {
      // New layer becomes first child, old first child becomes its next sibling
      this.db.prepare('UPDATE Layer SET LayerNextIndex = ? WHERE MainId = ?').run(parent.LayerFirstChildIndex, newLayerId);
      this.db.prepare('UPDATE Layer SET LayerFirstChildIndex = ? WHERE MainId = ?').run(newLayerId, parentId);
    }
  }

  /** Insert a new layer as the bottommost child of a parent folder */
  private insertAsBottomChild(parentId: number, newLayerId: number): void {
    const parent = this.db.prepare('SELECT LayerFirstChildIndex FROM Layer WHERE MainId = ?').get(parentId) as {
      LayerFirstChildIndex: number;
    } | undefined;

    if (!parent || parent.LayerFirstChildIndex === 0) {
      this.db.prepare('UPDATE Layer SET LayerFirstChildIndex = ? WHERE MainId = ?').run(newLayerId, parentId);
    } else {
      // Walk to end of sibling chain
      let currentId = parent.LayerFirstChildIndex;
      const visited = new Set<number>();
      while (true) {
        visited.add(currentId);
        const current = this.db.prepare('SELECT LayerNextIndex FROM Layer WHERE MainId = ?').get(currentId) as {
          LayerNextIndex: number;
        } | undefined;
        if (!current || current.LayerNextIndex === 0 || visited.has(current.LayerNextIndex)) break;
        currentId = current.LayerNextIndex;
      }
      this.db.prepare('UPDATE Layer SET LayerNextIndex = ? WHERE MainId = ?').run(newLayerId, currentId);
    }
  }

  renameLayer(layerId: number, newName: string): void {
    const result = this.db.prepare('UPDATE Layer SET LayerName = ? WHERE MainId = ?').run(newName, layerId);
    if (result.changes === 0) throw new Error(`Layer #${layerId} not found`);
  }

  setOpacity(layerId: number, percent: number): void {
    if (percent < 0 || percent > 100) throw new Error('Opacity must be 0-100');
    const raw = Math.round((percent / 100) * 256);
    const result = this.db.prepare('UPDATE Layer SET LayerOpacity = ? WHERE MainId = ?').run(raw, layerId);
    if (result.changes === 0) throw new Error(`Layer #${layerId} not found`);
  }

  setBlendMode(layerId: number, mode: string): void {
    const value = BLEND_NAME_TO_VALUE[mode];
    if (value === undefined) throw new Error(`Unknown blend mode: ${mode}`);
    const result = this.db.prepare('UPDATE Layer SET LayerComposite = ? WHERE MainId = ?').run(value, layerId);
    if (result.changes === 0) throw new Error(`Layer #${layerId} not found`);
  }

  setVisibility(layerId: number, visible: boolean): void {
    const row = this.db.prepare('SELECT LayerVisibility FROM Layer WHERE MainId = ?').get(layerId) as { LayerVisibility: number } | undefined;
    if (!row) throw new Error(`Layer #${layerId} not found`);
    const vis = visible ? (row.LayerVisibility | 1) : (row.LayerVisibility & ~1);
    this.db.prepare('UPDATE Layer SET LayerVisibility = ? WHERE MainId = ?').run(vis, layerId);
  }

  /** Standard LightTableInfo blob (15 bytes, copied from real CSP files) */
  private static LIGHT_TABLE_INFO = Buffer.from('01010108747970656e616d65060000', 'hex');

  /** Insert a LayerThumbnail row for a layer */
  private insertThumbnail(canvasId: number, layerId: number): number {
    const thumbId = this.nextId('LayerThumbnail');
    const canvas = this.db.prepare('SELECT CanvasWidth, CanvasHeight FROM Canvas WHERE MainId = ?').get(canvasId) as {
      CanvasWidth: number; CanvasHeight: number;
    };
    this.db.prepare(`
      INSERT INTO LayerThumbnail (
        MainId, CanvasId, LayerId,
        ThumbnailSmallerNeedRefresh, ThumbnailSmallNeedRefresh,
        ThumbnailMiddleNeedRefresh, ThumbnailLargeNeedRefresh,
        ThumbnailLargerNeedRefresh, ThumbnailMiddle2xNeedRefresh,
        ThumbnailLarger2xNeedRefresh,
        ThumbnailSmallerNeedRefresh1, ThumbnailSmallNeedRefresh1,
        ThumbnailMiddleNeedRefresh1, ThumbnailLargeNeedRefresh1,
        ThumbnailLargerNeedRefresh1, ThumbnailMiddle2xNeedRefresh1,
        ThumbnailLarger2xNeedRefresh1,
        ThumbnailDrewMode, ThumbnailFixMode,
        ThumbnailCanvasWidth, ThumbnailCanvasHeight,
        ThumbnailColorTypeBlack, ThumbnailColorTypeWhite,
        ThumbnailPrewviewColorTypeBlack, ThumbnailPrewviewColorTypeWhite,
        ThumbnailPrewviewColorTypeOpacity,
        ThumbnailPrewviewColorTypeImage, ThumbnailPrewviewColorTypeAlpha,
        ThumbnailPrewviewMaskThreshold,
        ThumbnailDrewUseCanvasAspect0, ThumbnailDrewUseCanvasAspect1
      ) VALUES (
        ?, ?, ?,
        5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5,
        0, -1,
        ?, ?,
        1, 1,
        1, 1, 1,
        2147483648, 2147483648,
        2147483648,
        1, 1
      )
    `).run(thumbId, canvasId, layerId, canvas.CanvasWidth, canvas.CanvasHeight);
    return thumbId;
  }

  /**
   * Add a folder layer. Returns the new folder's MainId.
   */
  addFolder(opts: {
    name?: string;
    parentId?: number;
    blendMode?: string;
    position?: 'top' | 'bottom';
  } = {}): number {
    const { canvasId, rootFolderId } = this.getCanvasInfo();
    const layerId = this.nextId('Layer');
    const parentId = opts.parentId ?? rootFolderId;
    const composite = opts.blendMode ? (BLEND_NAME_TO_VALUE[opts.blendMode] ?? 0) : 30; // default pass-through

    this.db.prepare(`
      INSERT INTO Layer (
        MainId, CanvasId, LayerName, LayerType, LayerLock, LayerClip, LayerMasking,
        LayerOffsetX, LayerOffsetY, LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY,
        LayerMaskOffsetX, LayerMaskOffsetY, LayerMaskOffscrOffsetX, LayerMaskOffscrOffsetY,
        LayerOpacity, LayerComposite, LayerUsePaletteColor, LayerNoticeablePaletteColor,
        LayerPaletteRed, LayerPaletteGreen, LayerPaletteBlue,
        LayerFolder, LayerVisibility, LayerSelect,
        LayerNextIndex, LayerFirstChildIndex, LayerUuid,
        LayerRenderMipmap, LayerLayerMaskMipmap, LayerRenderThumbnail, LayerLayerMaskThumbnail,
        LightTableInfo
      ) VALUES (
        ?, ?, ?, 0, 0, 0, 32,
        0, 0, 0, 0,
        0, 0, 0, 0,
        256, ?, 0, 0,
        0, 0, 0,
        1, 1, 0,
        0, 0, ?,
        0, 0, 0, 0,
        ?
      )
    `).run(layerId, canvasId, opts.name ?? `Folder ${layerId}`, composite, uuidv4(), ClipWriter.LIGHT_TABLE_INFO);

    if (opts.position === 'bottom') {
      this.insertAsBottomChild(parentId, layerId);
    } else {
      this.insertAsTopChild(parentId, layerId);
    }

    return layerId;
  }

  /**
   * Add a new raster layer with pixel data. Returns the new layer's MainId.
   */
  addLayer(
    rgba: Buffer,
    width: number,
    height: number,
    opts: {
      name?: string;
      opacity?: number;
      blendMode?: string;
      parentId?: number;
      position?: 'top' | 'bottom';
    } = {},
  ): number {
    const { canvasId, rootFolderId } = this.getCanvasInfo();
    const parentId = opts.parentId ?? rootFolderId;

    const layerId = this.nextId('Layer');
    const offscreenId = this.nextId('Offscreen');
    const mipmapInfoId = this.nextId('MipmapInfo');
    const mipmapId = this.nextId('Mipmap');

    const externalId = generateExternalId();
    const extaChunk = buildExtaChunk(rgba, width, height, externalId);
    this.newChunks.push(extaChunk);

    this.db.prepare(
      'INSERT INTO Offscreen (MainId, CanvasId, LayerId, Attribute, BlockData) VALUES (?, ?, ?, ?, ?)',
    ).run(offscreenId, canvasId, layerId, null, Buffer.from(externalId, 'ascii'));

    this.db.prepare(
      'INSERT INTO MipmapInfo (MainId, CanvasId, LayerId, ThisScale, Offscreen, NextIndex) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(mipmapInfoId, canvasId, layerId, 1.0, offscreenId, 0);

    this.db.prepare(
      'INSERT INTO Mipmap (MainId, CanvasId, LayerId, MipmapCount, BaseMipmapInfo) VALUES (?, ?, ?, ?, ?)',
    ).run(mipmapId, canvasId, layerId, 1, mipmapInfoId);

    const opacityRaw = opts.opacity !== undefined ? Math.round((opts.opacity / 100) * 256) : 256;
    const composite = opts.blendMode ? (BLEND_NAME_TO_VALUE[opts.blendMode] ?? 0) : 0;

    this.db.prepare(`
      INSERT INTO Layer (
        MainId, CanvasId, LayerName, LayerType, LayerLock, LayerClip, LayerMasking,
        LayerOffsetX, LayerOffsetY, LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY,
        LayerMaskOffsetX, LayerMaskOffsetY, LayerMaskOffscrOffsetX, LayerMaskOffscrOffsetY,
        LayerOpacity, LayerComposite, LayerUsePaletteColor, LayerNoticeablePaletteColor,
        LayerPaletteRed, LayerPaletteGreen, LayerPaletteBlue,
        LayerFolder, LayerVisibility, LayerSelect,
        LayerNextIndex, LayerFirstChildIndex, LayerUuid,
        LayerRenderMipmap, LayerLayerMaskMipmap, LayerRenderThumbnail, LayerLayerMaskThumbnail
      ) VALUES (
        ?, ?, ?, 1, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        ?, ?, 0, 0,
        0, 0, 0,
        0, 1, 0,
        0, 0, ?,
        ?, 0, 0, 0
      )
    `).run(layerId, canvasId, opts.name ?? `Layer ${layerId}`, opacityRaw, composite, uuidv4(), mipmapId);

    if (opts.position === 'bottom') {
      this.insertAsBottomChild(parentId, layerId);
    } else {
      this.insertAsTopChild(parentId, layerId);
    }

    // Register in ExternalChunk table if it exists
    const hasExtChunk = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ExternalChunk'",
    ).get();
    if (hasExtChunk) {
      this.db.prepare('INSERT INTO ExternalChunk (ExternalID, Offset) VALUES (?, ?)').run(
        Buffer.from(externalId, 'ascii'), 0,
      );
    }

    return layerId;
  }

  /**
   * Add an empty raster layer (no pixel data). Returns the new layer's MainId.
   */
  addEmptyLayer(opts: {
    name?: string;
    opacity?: number;
    blendMode?: string;
    parentId?: number;
    position?: 'top' | 'bottom';
  } = {}): number {
    const { canvasId, rootFolderId } = this.getCanvasInfo();
    const parentId = opts.parentId ?? rootFolderId;
    const layerId = this.nextId('Layer');

    const opacityRaw = opts.opacity !== undefined ? Math.round((opts.opacity / 100) * 256) : 256;
    const composite = opts.blendMode ? (BLEND_NAME_TO_VALUE[opts.blendMode] ?? 0) : 0;

    this.db.prepare(`
      INSERT INTO Layer (
        MainId, CanvasId, LayerName, LayerType, LayerLock, LayerClip, LayerMasking,
        LayerOffsetX, LayerOffsetY, LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY,
        LayerMaskOffsetX, LayerMaskOffsetY, LayerMaskOffscrOffsetX, LayerMaskOffscrOffsetY,
        LayerOpacity, LayerComposite, LayerUsePaletteColor, LayerNoticeablePaletteColor,
        LayerPaletteRed, LayerPaletteGreen, LayerPaletteBlue,
        LayerFolder, LayerVisibility, LayerSelect,
        LayerNextIndex, LayerFirstChildIndex, LayerUuid,
        LayerRenderMipmap, LayerLayerMaskMipmap, LayerRenderThumbnail, LayerLayerMaskThumbnail
      ) VALUES (
        ?, ?, ?, 1, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        ?, ?, 0, 0,
        0, 0, 0,
        0, 1, 0,
        0, 0, ?,
        0, 0, 0, 0
      )
    `).run(layerId, canvasId, opts.name ?? `Layer ${layerId}`, opacityRaw, composite, uuidv4());

    if (opts.position === 'bottom') {
      this.insertAsBottomChild(parentId, layerId);
    } else {
      this.insertAsTopChild(parentId, layerId);
    }

    return layerId;
  }

  save(outputPath?: string): void {
    const target = outputPath ?? this.filePath;
    const modifiedSql = readFileSync(this.tmpDbPath);

    const sqliChunk = this.clipFile.chunks.find(c => c.type === 'SQLi');
    const sqliChunkStart = sqliChunk ? sqliChunk.offset : this.clipFile.sqliteOffset - 16;

    const beforeSqli = Buffer.from(this.data.subarray(0, sqliChunkStart));
    const afterSql = this.data.subarray(this.clipFile.sqliteOffset + this.clipFile.sqliteSize);

    const sqliHeader = Buffer.alloc(16);
    sqliHeader.write('CHNKSQLi', 0, 8, 'ascii');
    sqliHeader.writeUInt32BE(0, 8);
    sqliHeader.writeUInt32BE(modifiedSql.length, 12);

    const parts = [beforeSqli, ...this.newChunks, sqliHeader, modifiedSql, afterSql];
    const newFile = Buffer.concat(parts);

    newFile.writeUInt32BE(0, 8);
    newFile.writeUInt32BE(newFile.length, 12);

    if (target === this.filePath) {
      copyFileSync(this.filePath, this.filePath + '.bak');
    }
    writeFileSync(target, newFile);
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
    try { unlinkSync(this.tmpDbPath); } catch { /* ignore */ }
  }
}

export function getValidBlendModes(): string[] {
  return Object.keys(BLEND_NAME_TO_VALUE);
}

/**
 * Create a new empty .clip file by cloning a template file's structure.
 * Uses templatePath if provided, otherwise uses a bundled minimal template.
 */
export function createEmptyClip(
  outputPath: string,
  opts: { width?: number; height?: number; dpi?: number; templatePath?: string } = {},
): void {
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const dpi = opts.dpi ?? 72;

  // Use template: clone its entire binary structure, then modify
  if (opts.templatePath) {
    return createFromTemplate(outputPath, opts.templatePath, width, height, dpi);
  }

  // Fallback: build from scratch (minimal, may not open in all CSP versions)
  createFromScratch(outputPath, width, height, dpi);
}

function createFromTemplate(
  outputPath: string,
  templatePath: string,
  width: number,
  height: number,
  dpi: number,
): void {
  // Copy entire template file
  copyFileSync(templatePath, outputPath);

  // Open as ClipWriter and modify
  const writer = new ClipWriter(outputPath);
  try {
    // Update canvas dimensions
    writer.db.prepare(
      'UPDATE Canvas SET CanvasWidth = ?, CanvasHeight = ?, CanvasResolution = ?',
    ).run(width, height, dpi);

    // Delete all layers except root folder and paper
    const layers = writer.db.prepare(
      'SELECT MainId, LayerType, SpecialRenderType FROM Layer ORDER BY MainId',
    ).all() as Array<{ MainId: number; LayerType: number; SpecialRenderType: number | null }>;

    const keepIds = new Set<number>();
    for (const l of layers) {
      if (l.LayerType === 256) keepIds.add(l.MainId); // root folder
      if (l.LayerType === 1584) keepIds.add(l.MainId); // paper
    }

    for (const l of layers) {
      if (!keepIds.has(l.MainId)) {
        writer.db.prepare('DELETE FROM Layer WHERE MainId = ?').run(l.MainId);
      }
    }

    // Clean up orphaned data
    writer.db.prepare('DELETE FROM Offscreen WHERE LayerId NOT IN (SELECT MainId FROM Layer)').run();
    writer.db.prepare('DELETE FROM MipmapInfo WHERE LayerId NOT IN (SELECT MainId FROM Layer)').run();
    writer.db.prepare('DELETE FROM Mipmap WHERE LayerId NOT IN (SELECT MainId FROM Layer)').run();
    writer.db.prepare('DELETE FROM LayerThumbnail WHERE LayerId NOT IN (SELECT MainId FROM Layer)').run();

    // Fix root folder: paper as only child, no next
    const rootFolder = layers.find(l => l.LayerType === 256);
    const paper = layers.find(l => l.LayerType === 1584);
    if (rootFolder && paper) {
      writer.db.prepare('UPDATE Layer SET LayerFirstChildIndex = ?, LayerNextIndex = 0 WHERE MainId = ?')
        .run(paper.MainId, rootFolder.MainId);
      writer.db.prepare('UPDATE Layer SET LayerNextIndex = 0, LayerFirstChildIndex = 0 WHERE MainId = ?')
        .run(paper.MainId);
      writer.db.prepare('UPDATE Canvas SET CanvasRootFolder = ?, CanvasCurrentLayer = ? WHERE MainId = 1')
        .run(rootFolder.MainId, paper.MainId);
    }

    // Reset ElemScheme MaxIndex for Layer
    const maxLayerId = Math.max(...[...keepIds]);
    writer.db.prepare('UPDATE ElemScheme SET MaxIndex = ? WHERE TableName = ?').run(maxLayerId, 'Layer');

    // Clear preview
    writer.db.prepare('DELETE FROM CanvasPreview').run();

    writer.save();
  } finally {
    writer.close();
  }

  // Remove the .bak created by save()
  try { unlinkSync(outputPath + '.bak'); } catch { /* ignore */ }
}

function createFromScratch(
  outputPath: string,
  width: number,
  height: number,
  dpi: number,
): void {
  const tmpDbPath = join(tmpdir(), `clip-clai-new-${randomBytes(8).toString('hex')}.db`);
  const db = new Database(tmpDbPath);

  try {
    db.exec(`
      CREATE TABLE Project (
        _PW_ID INTEGER PRIMARY KEY,
        ProjectInternalVersion TEXT,
        ProjectName TEXT,
        ProjectCanvas INTEGER,
        ProjectItemBank INTEGER,
        ProjectCutBank INTEGER,
        ProjectRootCanvasNode INTEGER
      );

      CREATE TABLE Canvas (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, CanvasUnit INTEGER,
        CanvasWidth REAL, CanvasHeight REAL, CanvasResolution REAL,
        CanvasChannelBytes INTEGER, CanvasDefaultChannelOrder INTEGER,
        CanvasRootFolder INTEGER, CanvasCurrentLayer INTEGER,
        CanvasDoSimulateColor INTEGER, CanvasRenderingIntent INTEGER,
        CanvasUseLibraryType INTEGER,
        CanvasSrcProfileName TEXT, CanvasSrcProfile BLOB,
        CanvasDstProfileName TEXT, CanvasDstProfile BLOB,
        CanvasSimulateRenderingIntent INTEGER, CanvasSimulateUseLibraryType INTEGER,
        CanvasSimulateSrcProfileName TEXT, CanvasSimulateSrcProfile BLOB,
        CanvasSimulateDstProfileName TEXT, CanvasSimulateDstProfile BLOB,
        CanvasUseColorAdjustment INTEGER,
        CanvasColorAdjustmentToneCurve BLOB, CanvasColorAdjustmentLevel BLOB,
        CanvasDefaultColorTypeIndex INTEGER,
        CanvasDefaultColorBlackChecked INTEGER, CanvasDefaultColorWhiteChecked INTEGER,
        CanvasDefaultToneLine REAL, CanvasDoublePage INTEGER,
        Canvas3DModelDataLoaderIndex INTEGER
      );

      CREATE TABLE CanvasPreview (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, CanvasId INTEGER,
        ImageType INTEGER, ImageWidth INTEGER, ImageHeight INTEGER, ImageData BLOB
      );

      CREATE TABLE Layer (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, CanvasId INTEGER,
        LayerName TEXT, LayerType INTEGER,
        LayerLock INTEGER, LayerClip INTEGER, LayerMasking INTEGER,
        LayerOffsetX INTEGER, LayerOffsetY INTEGER,
        LayerRenderOffscrOffsetX INTEGER, LayerRenderOffscrOffsetY INTEGER,
        LayerMaskOffsetX INTEGER, LayerMaskOffsetY INTEGER,
        LayerMaskOffscrOffsetX INTEGER, LayerMaskOffscrOffsetY INTEGER,
        LayerOpacity INTEGER, LayerComposite INTEGER,
        LayerUsePaletteColor INTEGER, LayerNoticeablePaletteColor INTEGER,
        LayerPaletteRed INTEGER, LayerPaletteGreen INTEGER, LayerPaletteBlue INTEGER,
        LayerFolder INTEGER, LayerVisibility INTEGER, LayerSelect INTEGER,
        LayerNextIndex INTEGER, LayerFirstChildIndex INTEGER,
        LayerUuid TEXT,
        LayerRenderMipmap INTEGER, LayerLayerMaskMipmap INTEGER,
        LayerRenderThumbnail INTEGER, LayerLayerMaskThumbnail INTEGER,
        DrawColorMainRed INTEGER, DrawColorMainGreen INTEGER, DrawColorMainBlue INTEGER,
        DrawColorEnable INTEGER,
        SpecialRenderType INTEGER,
        DrawToRenderOffscreenType INTEGER, DrawToRenderMipmapType INTEGER,
        MoveOffsetAndExpandType INTEGER, FixOffsetAndExpandType INTEGER,
        RenderBoundForLayerMoveType INTEGER,
        SetRenderThumbnailInfoType INTEGER, DrawRenderThumbnailType INTEGER,
        MonochromeFillInfo BLOB
      );

      CREATE TABLE LayerThumbnail (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, CanvasId INTEGER, LayerId INTEGER,
        ThumbnailCanvasWidth INTEGER, ThumbnailCanvasHeight INTEGER,
        ThumbnailOffscreen INTEGER
      );

      CREATE TABLE Offscreen (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, CanvasId INTEGER, LayerId INTEGER,
        Attribute BLOB, BlockData BLOB
      );

      CREATE TABLE Mipmap (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, CanvasId INTEGER, LayerId INTEGER,
        MipmapCount INTEGER, BaseMipmapInfo INTEGER
      );

      CREATE TABLE MipmapInfo (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, CanvasId INTEGER, LayerId INTEGER,
        ThisScale REAL, Offscreen INTEGER, NextIndex INTEGER
      );

      CREATE TABLE ExternalChunk (
        ExternalID BLOB, Offset INTEGER
      );

      CREATE TABLE ExternalTableAndColumnName (
        TableName TEXT, ColumnName TEXT
      );

      CREATE TABLE ElemScheme (
        _PW_ID INTEGER PRIMARY KEY,
        TableName TEXT, ElemType INTEGER, MaxIndex INTEGER
      );

      CREATE TABLE ParamScheme (
        _PW_ID INTEGER PRIMARY KEY,
        TableName TEXT, LabelName TEXT, DataType INTEGER,
        Flag INTEGER, OwnerType INTEGER, LockType INTEGER,
        LockSpecified INTEGER, LinkTable TEXT
      );

      CREATE TABLE RemovedExternal (
        ExternalID BLOB
      );

      CREATE TABLE AnimationCutBank (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, FirstTimeLine INTEGER, FirstScenario INTEGER,
        CurrentIndex INTEGER, Enable INTEGER
      );

      CREATE TABLE VectorObjectList (
        _PW_ID INTEGER PRIMARY KEY,
        MainId INTEGER, VectorData BLOB, LayerId INTEGER
      );
    `);

    // Insert ExternalTableAndColumnName
    db.prepare('INSERT INTO ExternalTableAndColumnName VALUES (?, ?)').run('Offscreen', 'BlockData');
    db.prepare('INSERT INTO ExternalTableAndColumnName VALUES (?, ?)').run('VectorObjectList', 'VectorData');

    // Insert ElemScheme entries
    const elemSchemeInsert = db.prepare('INSERT INTO ElemScheme (TableName, ElemType, MaxIndex) VALUES (?, ?, ?)');
    elemSchemeInsert.run('Layer', 4, 2);
    elemSchemeInsert.run('Offscreen', 0, 0);
    elemSchemeInsert.run('MipmapInfo', 0, 0);
    elemSchemeInsert.run('Mipmap', 0, 0);
    elemSchemeInsert.run('LayerThumbnail', 0, 0);
    elemSchemeInsert.run('Canvas', 2, 1);
    elemSchemeInsert.run('Project', 1, 1);
    elemSchemeInsert.run('CanvasPreview', 0, 0);
    elemSchemeInsert.run('VectorObjectList', 0, 0);

    // Insert Project
    db.prepare(
      'INSERT INTO Project (ProjectInternalVersion, ProjectName, ProjectCanvas, ProjectItemBank, ProjectCutBank, ProjectRootCanvasNode) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('1.1.0', '', 1, 0, 0, 0);

    // Insert Canvas
    db.prepare(`
      INSERT INTO Canvas (
        MainId, CanvasUnit, CanvasWidth, CanvasHeight, CanvasResolution,
        CanvasChannelBytes, CanvasDefaultChannelOrder,
        CanvasRootFolder, CanvasCurrentLayer,
        CanvasDoSimulateColor, CanvasRenderingIntent, CanvasUseLibraryType,
        CanvasUseColorAdjustment,
        CanvasDefaultColorTypeIndex, CanvasDefaultColorBlackChecked, CanvasDefaultColorWhiteChecked,
        CanvasDefaultToneLine, CanvasDoublePage, Canvas3DModelDataLoaderIndex
      ) VALUES (
        1, 0, ?, ?, ?,
        1, 33,
        1, 2,
        0, 1, 2,
        0,
        0, 1, 1,
        60.0, 0, 2
      )
    `).run(width, height, dpi);

    // Insert root folder layer (ID=1)
    db.prepare(`
      INSERT INTO Layer (
        MainId, CanvasId, LayerName, LayerType, LayerLock, LayerClip, LayerMasking,
        LayerOffsetX, LayerOffsetY, LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY,
        LayerMaskOffsetX, LayerMaskOffsetY, LayerMaskOffscrOffsetX, LayerMaskOffscrOffsetY,
        LayerOpacity, LayerComposite, LayerUsePaletteColor, LayerNoticeablePaletteColor,
        LayerPaletteRed, LayerPaletteGreen, LayerPaletteBlue,
        LayerFolder, LayerVisibility, LayerSelect,
        LayerNextIndex, LayerFirstChildIndex, LayerUuid,
        LayerRenderMipmap, LayerLayerMaskMipmap, LayerRenderThumbnail, LayerLayerMaskThumbnail
      ) VALUES (
        1, 1, '', 256, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        256, 0, 0, 0,
        0, 0, 0,
        1, 1, 0,
        0, 2, ?,
        0, 0, 0, 0
      )
    `).run(uuidv4());

    // Insert paper layer (ID=2)
    db.prepare(`
      INSERT INTO Layer (
        MainId, CanvasId, LayerName, LayerType, LayerLock, LayerClip, LayerMasking,
        LayerOffsetX, LayerOffsetY, LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY,
        LayerMaskOffsetX, LayerMaskOffsetY, LayerMaskOffscrOffsetX, LayerMaskOffscrOffsetY,
        LayerOpacity, LayerComposite, LayerUsePaletteColor, LayerNoticeablePaletteColor,
        LayerPaletteRed, LayerPaletteGreen, LayerPaletteBlue,
        LayerFolder, LayerVisibility, LayerSelect,
        LayerNextIndex, LayerFirstChildIndex, LayerUuid,
        LayerRenderMipmap, LayerLayerMaskMipmap, LayerRenderThumbnail, LayerLayerMaskThumbnail,
        SpecialRenderType
      ) VALUES (
        2, 1, '用紙', 1584, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        256, 0, 0, 0,
        0, 0, 0,
        0, 1, 0,
        0, 0, ?,
        0, 0, 0, 0,
        20
      )
    `).run(uuidv4());

    // Read the SQLite database
    const sqliteData = readFileSync(tmpDbPath);

    // Build minimal .clip file
    // CSFCHUNK header
    const csfHeader = Buffer.alloc(24);
    csfHeader.write('CSFCHUNK', 0, 8, 'ascii');
    // File length will be patched later

    // CHNKHead (minimal empty header)
    const headData = Buffer.alloc(0);
    const headChunk = Buffer.alloc(16 + headData.length);
    headChunk.write('CHNKHead', 0, 8, 'ascii');
    headChunk.writeUInt32BE(0, 8);
    headChunk.writeUInt32BE(headData.length, 12);

    // CHNKSQLi
    const sqliChunk = Buffer.alloc(16);
    sqliChunk.write('CHNKSQLi', 0, 8, 'ascii');
    sqliChunk.writeUInt32BE(0, 8);
    sqliChunk.writeUInt32BE(sqliteData.length, 12);

    // CHNKFoot
    const footData = Buffer.alloc(0);
    const footChunk = Buffer.alloc(16 + footData.length);
    footChunk.write('CHNKFoot', 0, 8, 'ascii');
    footChunk.writeUInt32BE(0, 8);
    footChunk.writeUInt32BE(footData.length, 12);

    const file = Buffer.concat([csfHeader, headChunk, sqliChunk, sqliteData, footChunk]);

    // Patch file length in CSFCHUNK header
    file.writeUInt32BE(0, 8);
    file.writeUInt32BE(file.length, 12);

    writeFileSync(outputPath, file);
  } finally {
    db.close();
    try { unlinkSync(tmpDbPath); } catch { /* ignore */ }
  }
}
