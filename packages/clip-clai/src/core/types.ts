/** Chunk parsed from the .clip binary container */
export interface ClipChunk {
  type: string; // "Head", "Exta", "SQLi", "Foot"
  offset: number; // byte offset in file
  size: number; // data size
  dataOffset: number; // offset where data begins
}

/** Top-level file info */
export interface ClipFile {
  filePath: string;
  fileSize: number;
  chunks: ClipChunk[];
  sqliteOffset: number;
  sqliteSize: number;
}

/** Canvas metadata from Canvas table */
export interface CanvasInfo {
  width: number;
  height: number;
  resolution: number;
  channelBytes: number; // 1=8bit, 2=16bit, 4=32bit
  rootFolderId: number;
  currentLayerId: number;
  srcProfileName: string | null;
  unit: number;
}

/** Layer type classification */
export type LayerKind =
  | 'raster'
  | 'vector'
  | 'text'
  | 'folder'
  | 'root-folder'
  | 'solid-fill'
  | 'gradient'
  | 'adjustment'
  | 'paper'
  | 'unknown';

/** Blend mode names */
export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'subtract'
  | 'darker-color'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'color-dodge-2'
  | 'add'
  | 'add-glow'
  | 'lighter-color'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'pass-through'
  | 'divide'
  | 'unknown';

/** Layer info from Layer table */
export interface LayerInfo {
  id: number; // MainId
  name: string;
  kind: LayerKind;
  layerType: number; // raw LayerType value
  blendMode: BlendMode;
  compositeValue: number; // raw LayerComposite value
  opacity: number; // 0-100 (percentage)
  opacityRaw: number; // 0-256 raw value
  visible: boolean;
  maskEnabled: boolean;
  clipping: boolean;
  locked: boolean;
  folderId: number; // LayerFolder
  firstChildId: number;
  nextSiblingId: number;
  offsetX: number;
  offsetY: number;
  renderMipmapId: number;
  maskMipmapId: number;
  specialRenderType: number | null;
  textContent: string | null; // UTF-8 text for text layers
  children?: LayerInfo[]; // populated by tree builder
}

/** Preview image from CanvasPreview table */
export interface PreviewImage {
  width: number;
  height: number;
  imageType: number;
  data: Buffer;
}

/** Project metadata */
export interface ProjectInfo {
  internalVersion: string;
  name: string;
  canvasId: number;
}

/** Schema version detection */
export type SchemaVersion = 'legacy' | 'modern';

/** Offscreen data reference */
export interface OffscreenRef {
  mainId: number;
  layerId: number;
  blockData: Buffer | string; // External ID
  attribute: Buffer | null;
}

/** Mipmap chain entry */
export interface MipmapChain {
  mipmapId: number;
  baseMipmapInfoId: number;
  offscreenId: number;
  externalId: string;
}
