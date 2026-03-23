import Database from 'better-sqlite3';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { extractSqliteBuffer } from './reader.js';
import type {
  CanvasInfo,
  LayerInfo,
  LayerKind,
  BlendMode,
  PreviewImage,
  ProjectInfo,
  SchemaVersion,
  MipmapChain,
} from './types.js';

const BLEND_MODE_MAP: Record<number, BlendMode> = {
  0: 'normal',
  1: 'darken',
  2: 'multiply',
  3: 'color-burn',
  4: 'linear-burn',
  5: 'subtract',
  6: 'darker-color',
  7: 'lighten',
  8: 'screen',
  9: 'color-dodge',
  10: 'color-dodge-2',
  11: 'add',
  12: 'add-glow',
  13: 'lighter-color',
  14: 'overlay',
  15: 'soft-light',
  16: 'hard-light',
  17: 'vivid-light',
  18: 'linear-light',
  19: 'pin-light',
  20: 'hard-mix',
  21: 'difference',
  22: 'exclusion',
  23: 'hue',
  24: 'saturation',
  25: 'color',
  26: 'luminosity',
  30: 'pass-through',
  36: 'divide',
};

/**
 * Open a .clip file's SQLite database for querying.
 * Extracts the SQLite blob to a temp file, opens it, and returns a ClipDatabase handle.
 */
export class ClipDatabase {
  private db: Database.Database;
  private tmpPath: string;
  private _schemaVersion: SchemaVersion | null = null;

  constructor(clipFilePath: string) {
    const sqlBuf = extractSqliteBuffer(clipFilePath);
    this.tmpPath = join(
      tmpdir(),
      `clip-clai-${randomBytes(8).toString('hex')}.db`,
    );
    writeFileSync(this.tmpPath, sqlBuf);
    try {
      this.db = new Database(this.tmpPath, { readonly: true });
    } catch (err) {
      try { unlinkSync(this.tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
    try { unlinkSync(this.tmpPath); } catch { /* ignore */ }
  }

  get schemaVersion(): SchemaVersion {
    if (!this._schemaVersion) {
      this._schemaVersion = this.detectSchemaVersion();
    }
    return this._schemaVersion;
  }

  private detectSchemaVersion(): SchemaVersion {
    const cols = this.db
      .prepare("PRAGMA table_info('Layer')")
      .all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    return colNames.has('TextLayerType') ? 'modern' : 'legacy';
  }

  getProjectInfo(): ProjectInfo {
    const row = this.db
      .prepare('SELECT ProjectInternalVersion, ProjectName, ProjectCanvas FROM Project')
      .get() as { ProjectInternalVersion: string; ProjectName: string; ProjectCanvas: number } | undefined;

    if (!row) throw new Error('No Project record found');
    return {
      internalVersion: row.ProjectInternalVersion,
      name: row.ProjectName ?? '',
      canvasId: row.ProjectCanvas,
    };
  }

  getCanvasInfo(): CanvasInfo {
    const row = this.db
      .prepare(
        `SELECT CanvasWidth, CanvasHeight, CanvasResolution, CanvasChannelBytes,
                CanvasRootFolder, CanvasCurrentLayer, CanvasSrcProfileName, CanvasUnit
         FROM Canvas`,
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) throw new Error('No Canvas record found');
    return {
      width: row.CanvasWidth as number,
      height: row.CanvasHeight as number,
      resolution: row.CanvasResolution as number,
      channelBytes: (row.CanvasChannelBytes as number) ?? 1,
      rootFolderId: row.CanvasRootFolder as number,
      currentLayerId: row.CanvasCurrentLayer as number,
      srcProfileName: (row.CanvasSrcProfileName as string) ?? null,
      unit: (row.CanvasUnit as number) ?? 0,
    };
  }

  getPreview(): PreviewImage | null {
    const row = this.db
      .prepare('SELECT ImageType, ImageWidth, ImageHeight, ImageData FROM CanvasPreview')
      .get() as Record<string, unknown> | undefined;

    if (!row || !row.ImageData) return null;
    return {
      imageType: (row.ImageType as number) ?? 0,
      width: row.ImageWidth as number,
      height: row.ImageHeight as number,
      data: row.ImageData as Buffer,
    };
  }

  getLayers(): LayerInfo[] {
    const rows = this.db
      .prepare(
        `SELECT MainId, LayerName, LayerType, LayerComposite, LayerOpacity,
                LayerVisibility, LayerFolder, LayerClip, LayerLock,
                LayerFirstChildIndex, LayerNextIndex,
                LayerOffsetX, LayerOffsetY,
                LayerRenderMipmap, LayerLayerMaskMipmap,
                SpecialRenderType
         FROM Layer ORDER BY MainId`,
      )
      .all() as Array<Record<string, unknown>>;

    const isModern = this.schemaVersion === 'modern';
    let modernRows: Map<number, Record<string, unknown>> | null = null;

    if (isModern) {
      const mRows = this.db
        .prepare(
          `SELECT MainId, TextLayerType, TextLayerString, VectorNormalType,
                  GradationFillInfo, MaterialContentType
           FROM Layer`,
        )
        .all() as Array<Record<string, unknown>>;
      modernRows = new Map(mRows.map((r) => [r.MainId as number, r]));
    }

    return rows.map((row) => {
      const id = row.MainId as number;
      const layerType = row.LayerType as number;
      const folder = row.LayerFolder as number;
      const srt = row.SpecialRenderType as number | null;

      let kind: LayerKind;
      let textContent: string | null = null;

      if (isModern && modernRows) {
        const mod = modernRows.get(id);
        kind = classifyLayerModern(layerType, folder, srt, mod);
        if (mod?.TextLayerString) {
          const buf = mod.TextLayerString as Buffer;
          textContent = buf.toString('utf-8');
        }
      } else {
        kind = classifyLayerLegacy(layerType, folder, srt);
      }

      const compositeValue = row.LayerComposite as number;
      const opacityRaw = row.LayerOpacity as number;
      const vis = row.LayerVisibility as number;

      return {
        id,
        name: (row.LayerName as string) ?? '',
        kind,
        layerType,
        blendMode: BLEND_MODE_MAP[compositeValue] ?? 'unknown',
        compositeValue,
        opacity: Math.round((opacityRaw / 256) * 100),
        opacityRaw,
        visible: (vis & 1) !== 0,
        maskEnabled: (vis & 2) !== 0,
        clipping: (row.LayerClip as number) !== 0,
        locked: (row.LayerLock as number) !== 0,
        folderId: folder,
        firstChildId: row.LayerFirstChildIndex as number,
        nextSiblingId: row.LayerNextIndex as number,
        offsetX: (row.LayerOffsetX as number) ?? 0,
        offsetY: (row.LayerOffsetY as number) ?? 0,
        renderMipmapId: (row.LayerRenderMipmap as number) ?? 0,
        maskMipmapId: (row.LayerLayerMaskMipmap as number) ?? 0,
        specialRenderType: srt,
        textContent,
      };
    });
  }

  /**
   * Build the layer tree from flat list using FirstChildIndex / NextIndex traversal.
   */
  getLayerTree(): LayerInfo[] {
    const layers = this.getLayers();
    const byId = new Map(layers.map((l) => [l.id, l]));

    const globalVisited = new Set<number>();

    function buildChildren(parentId: number): LayerInfo[] {
      const parent = byId.get(parentId);
      if (!parent || parent.firstChildId === 0) return [];

      const children: LayerInfo[] = [];
      let currentId = parent.firstChildId;

      while (currentId !== 0 && !globalVisited.has(currentId)) {
        globalVisited.add(currentId);
        const child = byId.get(currentId);
        if (!child) break;

        child.children = buildChildren(child.id);
        children.push(child);
        currentId = child.nextSiblingId;
      }

      return children;
    }

    const canvas = this.getCanvasInfo();
    const root = byId.get(canvas.rootFolderId);
    if (!root) return layers;

    root.children = buildChildren(root.id);
    return [root];
  }

  /**
   * Resolve the mipmap chain for a layer's render data.
   * Returns the external ID needed to find pixel data in CHNKExta chunks.
   */
  getMipmapChain(renderMipmapId: number): MipmapChain | null {
    if (!renderMipmapId) return null;

    const mipmap = this.db
      .prepare('SELECT MainId, BaseMipmapInfo FROM Mipmap WHERE MainId = ?')
      .get(renderMipmapId) as { MainId: number; BaseMipmapInfo: number } | undefined;
    if (!mipmap) return null;

    const mipmapInfo = this.db
      .prepare('SELECT MainId, Offscreen FROM MipmapInfo WHERE MainId = ?')
      .get(mipmap.BaseMipmapInfo) as { MainId: number; Offscreen: number } | undefined;
    if (!mipmapInfo) return null;

    const offscreen = this.db
      .prepare('SELECT MainId, BlockData, Attribute FROM Offscreen WHERE MainId = ?')
      .get(mipmapInfo.Offscreen) as { MainId: number; BlockData: Buffer | string; Attribute: Buffer | null } | undefined;
    if (!offscreen) return null;

    let externalId: string;
    if (Buffer.isBuffer(offscreen.BlockData)) {
      externalId = offscreen.BlockData.toString('utf-8');
    } else {
      externalId = offscreen.BlockData;
    }

    return {
      mipmapId: mipmap.MainId,
      baseMipmapInfoId: mipmap.BaseMipmapInfo,
      offscreenId: mipmapInfo.Offscreen,
      externalId,
    };
  }

  /**
   * Get raw data blobs for PSD conversion (text, filter, effects, gradient).
   */
  getLayerRawData(layerId: number): {
    textString: Buffer | null;
    textAttributes: Buffer | null;
    filterLayerInfo: Buffer | null;
    layerEffectInfo: Buffer | null;
    gradationFillInfo: Buffer | null;
  } {
    if (this.schemaVersion === 'modern') {
      const row = this.db.prepare(
        `SELECT TextLayerString, TextLayerAttributes, GradationFillInfo FROM Layer WHERE MainId = ?`,
      ).get(layerId) as Record<string, unknown> | undefined;
      // Modern schema has no FilterLayerInfo, check for LayerEffectInfo if column exists
      let effectInfo: Buffer | null = null;
      try {
        const eRow = this.db.prepare('SELECT LayerEffectInfo FROM Layer WHERE MainId = ?').get(layerId) as Record<string, unknown> | undefined;
        effectInfo = (eRow?.LayerEffectInfo as Buffer) ?? null;
      } catch { /* column may not exist */ }

      return {
        textString: (row?.TextLayerString as Buffer) ?? null,
        textAttributes: (row?.TextLayerAttributes as Buffer) ?? null,
        filterLayerInfo: null,
        layerEffectInfo: effectInfo,
        gradationFillInfo: (row?.GradationFillInfo as Buffer) ?? null,
      };
    }

    // Legacy schema
    const row = this.db.prepare(
      `SELECT FilterLayerInfo FROM Layer WHERE MainId = ?`,
    ).get(layerId) as Record<string, unknown> | undefined;

    let effectInfo: Buffer | null = null;
    try {
      const eRow = this.db.prepare('SELECT LayerEffectInfo FROM Layer WHERE MainId = ?').get(layerId) as Record<string, unknown> | undefined;
      effectInfo = (eRow?.LayerEffectInfo as Buffer) ?? null;
    } catch { /* column may not exist */ }

    return {
      textString: null,
      textAttributes: null,
      filterLayerInfo: (row?.FilterLayerInfo as Buffer) ?? null,
      layerEffectInfo: effectInfo,
      gradationFillInfo: null,
    };
  }

  getTableNames(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  getTableSchema(tableName: string): Array<{ name: string; type: string }> {
    const rows = this.db
      .prepare(`PRAGMA table_info('${tableName.replace(/'/g, "''")}')`)
      .all() as Array<{ name: string; type: string }>;
    return rows.map((r) => ({ name: r.name, type: r.type }));
  }

  getTableRowCount(tableName: string): number {
    const validTables = this.getTableNames();
    if (!validTables.includes(tableName)) {
      throw new Error(`Unknown table: ${tableName}`);
    }
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get() as { cnt: number };
    return row.cnt;
  }

  /** Raw query for inspect command */
  queryAll(sql: string): unknown[] {
    return this.db.prepare(sql).all();
  }
}

function classifyLayerModern(
  layerType: number,
  folder: number,
  srt: number | null,
  mod: Record<string, unknown> | undefined,
): LayerKind {
  if (layerType === 256) return 'root-folder';
  if (layerType === 1584) return 'paper';
  if (layerType === 4098) return 'adjustment';
  if (layerType === 2) {
    return mod?.GradationFillInfo ? 'solid-fill' : 'gradient';
  }
  if (layerType === 0) {
    if (folder > 0) return 'folder';
    if (mod?.VectorNormalType != null) return 'vector';
    if (mod?.TextLayerType != null) return 'text';
    return 'unknown';
  }
  if (layerType === 1) return 'raster';
  return 'unknown';
}

function classifyLayerLegacy(
  layerType: number,
  folder: number,
  srt: number | null,
): LayerKind {
  if (layerType === 256) return 'root-folder';
  if (layerType === 1584) return 'paper';
  if (layerType === 4098) return 'adjustment';
  if (layerType === 2) return 'solid-fill';
  if (layerType === 0) {
    if (folder > 0) return 'folder';
    return 'unknown';
  }
  if (layerType === 1) return 'raster';
  return 'unknown';
}
