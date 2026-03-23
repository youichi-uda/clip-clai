# .clip ファイルフォーマット仕様書

> 本ドキュメントはコミュニティによるリバースエンジニアリング成果 + 実ファイル解析をもとにまとめたものです。
> 公式仕様は非公開であり、バージョンにより構造が変わる可能性があります。
>
> 主要な情報源:
> - [clip-d/SPEC.md (Inochi2D)](https://github.com/Inochi2D/clip-d/blob/main/SPEC.md)
> - [clip_to_psd (dobrokot)](https://github.com/dobrokot/clip_to_psd)
> - [clip_studio_paint_tool (Kazuhito00)](https://github.com/Kazuhito00/clip_studio_paint_tool)
> - [Krita Artists: libmarugarou discussion](https://krita-artists.org/t/libmarugarou-lets-cut-up-clip-studio-paint/59235)
> - 実ファイル解析: セルシス公式サンプル `tama.clip`（ProjectInternalVersion: 1.1.0）

---

## 1. ファイル全体構造（チャンク方式）

.clipファイルはバイナリコンテナであり、複数のチャンクで構成される。
数値はすべて **ビッグエンディアン** で格納される（一部例外あり）。

```
+------------------+
| CSFCHUNK header  |  8 bytes magic + 8 bytes file length + 8 bytes offset (24 bytes)
+------------------+
| CHNKHead         |  ヘッダー情報（詳細不明）
+------------------+
| CHNKExta #1      |  外部データ（レイヤーのピクセルデータ等）
+------------------+
| CHNKExta #2      |
+------------------+
| ...              |  （レイヤー数に応じて複数）
+------------------+
| CHNKSQLi         |  SQLiteデータベース（メタデータ全体）
+------------------+
| CHNKFoot         |  フッター
+------------------+
```

### チャンクヘッダー構造

各チャンク（CSFCHUNK以降）:
```
Offset  Size  Description
0       4     "CHNK" マーカー
4       4     チャンク種別（"Exta", "SQLi", "Head", "Foot"）
8       8     チャンクデータサイズ（big-endian uint64）
16      N     チャンクデータ本体
```

---

## 2. CHNKExta（ピクセルデータチャンク）

各CHNKExtaチャンクは1つのレイヤーまたはマスクのピクセルデータを格納する。

### 内部構造

```
Offset  Description
0       External ID 文字列長（8 bytes, big-endian）
8       External ID 文字列（ASCII, 可変長）-- Offscreenテーブルの BlockData と対応
+8      外部データ総サイズ（8 bytes, スキップ）
+N      サブブロックの繰り返し
```

### External ID の形式

`ExternalChunk` テーブルに全External IDとファイル内オフセットが格納されている。
形式: `extrnlid` + 32文字の16進UUID（例: `extrnlid50BC32B806794F968E0F109EB9D96449`）

### サブブロック

サブブロック名は **UTF-16BE** でエンコードされている。

| サブブロック名 | 役割 |
|---|---|
| `BlockDataBeginChunk` | 圧縮ピクセルデータを含む |
| `BlockDataEndChunk` | 終了マーカー（データなし） |
| `BlockStatus` | ブロックメタデータ（24 bytes, ピクセルなし） |
| `BlockCheckSum` | チェックサム（24 bytes, ピクセルなし） |

### BlockDataBeginChunk の構造

```
Offset  Size  Endian  Description
0       4     Big     ブロックインデックス
4       4     Big     非圧縮サイズ
8       4     Big     ブロック幅
12      4     Big     ブロック高さ
16      4     Big     存在フラグ（0=空, >0=データあり）

--- 存在フラグ > 0 の場合 ---
20      4     Big     block_len（ブロック全体長）
24      4     Little  block_len_2（圧縮データ長） *** リトルエンディアン注意 ***
28      N     -       zlib圧縮されたピクセルデータ
```

**重要**: `block_len_2` のみ **リトルエンディアン** である。これはファイル全体のビッグエンディアン規約の例外。

---

## 3. CHNKSQLi（SQLiteデータベース）

チャンクデータ部分がそのままSQLiteデータベースのバイナリ。
`sqlite_chunk_start + 16` からEOFまでがSQLiteファイル本体。

SQLiteヘッダ `SQLite format 3\0` をファイル内検索することでも位置を特定可能。

---

## 4. SQLiteテーブル定義

### 実ファイルで確認されたテーブル一覧（17テーブル）

| テーブル | 役割 |
|---|---|
| **Project** | プロジェクト全体情報 |
| **Canvas** | キャンバス設定（32カラム） |
| **CanvasPreview** | プレビュー画像 |
| **CanvasItem** | キャンバスアイテム |
| **CanvasItemBank** | アイテムバンク |
| **Layer** | レイヤーメタデータ（**52カラム**） |
| **LayerThumbnail** | レイヤーサムネイル（**43カラム**） |
| **Offscreen** | オフスクリーンデータ参照 |
| **Mipmap** | ミップマップチェーン |
| **MipmapInfo** | ミップマップ詳細 |
| **AnimationCutBank** | アニメーション |
| **ExternalChunk** | 外部チャンクのオフセット索引 |
| **ExternalTableAndColumnName** | 外部データを持つカラム一覧 |
| **ElemScheme** | 要素スキーマ（全テーブル・MaxIndex管理） |
| **ParamScheme** | パラメータスキーマ |
| **RemovedExternal** | 削除された外部データ |
| **sqlite_sequence** | SQLite内部 |

### 4.1 Project（プロジェクト情報）

| カラム | 型 | 説明 | サンプル値 |
|---|---|---|---|
| ProjectInternalVersion | TEXT | 内部バージョン | `"1.1.0"` |
| ProjectName | TEXT | プロジェクト名 | |
| ProjectCanvas | INTEGER | CanvasのMainId | `1` |
| ProjectItemBank | INTEGER | ItemBankのMainId | |
| ProjectCutBank | INTEGER | CutBankのMainId | |
| ProjectRootCanvasNode | INTEGER | ルートキャンバスノード | |

### 4.2 Canvas（キャンバス情報）-- 32カラム

| カラム | 型 | 説明 | サンプル値 |
|---|---|---|---|
| MainId | INTEGER | ID | `1` |
| CanvasUnit | INTEGER | 単位（0=px?） | `0` |
| CanvasWidth | REAL | キャンバス幅（px） | `2894.0` |
| CanvasHeight | REAL | キャンバス高さ（px） | `4093.0` |
| CanvasResolution | REAL | 解像度（DPI） | `350.0` |
| **CanvasChannelBytes** | **INTEGER** | **色深度** | **`1`=8bit, `2`=16bit, `4`=32bit(推定)** |
| CanvasDefaultChannelOrder | INTEGER | チャンネル順序 | `33` |
| CanvasRootFolder | INTEGER | ルートフォルダのLayerMainId | `2` |
| CanvasCurrentLayer | INTEGER | 現在選択中のレイヤーID | `69` |
| CanvasDoSimulateColor | INTEGER | カラーシミュレーション有効 | `0` |
| CanvasRenderingIntent | INTEGER | レンダリングインテント | `1` |
| CanvasUseLibraryType | INTEGER | ライブラリ種別 | `2` |
| CanvasSrcProfileName | TEXT | ソースICCプロファイル名 | `"sRGB IEC61966-2.1"` |
| CanvasSrcProfile | BLOB | ソースICCプロファイルバイナリ | |
| CanvasDstProfileName | TEXT | 出力先ICCプロファイル名 | |
| CanvasDstProfile | BLOB | 出力先ICCプロファイルバイナリ | |
| CanvasSimulate* | 各種 | カラーシミュレーション設定 | |
| CanvasUseColorAdjustment | INTEGER | 色調補正使用 | `0` |
| CanvasColorAdjustmentToneCurve | BLOB | 全体トーンカーブ | |
| CanvasColorAdjustmentLevel | BLOB | 全体レベル補正 | |
| CanvasDefaultColorTypeIndex | INTEGER | デフォルト表現色 | `0` |
| CanvasDefaultColorBlackChecked | INTEGER | | `1` |
| CanvasDefaultColorWhiteChecked | INTEGER | | `1` |
| CanvasDefaultToneLine | REAL | デフォルトトーン線数 | `60.0` |
| CanvasDoublePage | INTEGER | 見開き | `0` |
| Canvas3DModelDataLoaderIndex | INTEGER | 3Dモデルローダー | `2` |

### 4.3 CanvasPreview（プレビュー画像）

| カラム | 型 | 説明 |
|---|---|---|
| MainId | INTEGER | ID |
| CanvasId | INTEGER | キャンバスID |
| ImageType | INTEGER | 画像形式種別 |
| ImageWidth | INTEGER | プレビュー幅 |
| ImageHeight | INTEGER | プレビュー高さ |
| ImageData | BLOB | PNG形式のプレビュー画像バイナリ |

### 4.4 Layer（レイヤーメタデータ）-- 最重要テーブル

> **バージョンによるスキーマ差異あり**:
> - tama.clip（旧バージョン?）: 52カラム、`FilterLayerInfo` あり
> - test0323.clip（2026年版CSP）: **73カラム**、`FilterLayerInfo` なし、代わりに `TextLayer*`, `GradationFillInfo`, `VectorNormal*` 等の専用カラム
>
> 新バージョンでは FilterLayerInfo に詰め込んでいたデータが個別カラムに分離されている。

#### 基本情報
| カラム | 型 | 説明 |
|---|---|---|
| MainId | INTEGER | レイヤーID（主キー的） |
| CanvasId | INTEGER | キャンバスID |
| LayerName | TEXT | レイヤー名（UTF-8） |
| LayerUuid | TEXT | UUID |
| **LayerType** | **INTEGER** | **レイヤー種別（後述、整数値）** |

#### 描画属性
| カラム | 型 | 説明 |
|---|---|---|
| LayerComposite | INTEGER | ブレンドモード（後述） |
| **LayerOpacity** | **INTEGER** | **不透明度（0-256、256=100%）** |
| LayerVisibility | INTEGER | 表示状態（ビットフラグ） |
| LayerLock | INTEGER | ロック状態 |
| LayerClip | INTEGER | 下のレイヤーでクリッピング（0/1） |
| LayerMasking | INTEGER | マスキング |

#### ツリー構造
| カラム | 型 | 説明 |
|---|---|---|
| LayerFolder | INTEGER | フォルダフラグ（0=通常, 1=ルートフォルダ, 17=通常フォルダ） |
| LayerFirstChildIndex | INTEGER | 最初の子レイヤーのMainId（0=子なし） |
| LayerNextIndex | INTEGER | 次の兄弟レイヤーのMainId（0=末尾） |
| LayerSelect | INTEGER | 選択状態（ビットフラグ） |

#### 位置・オフセット
| カラム | 型 | 説明 |
|---|---|---|
| LayerOffsetX / Y | INTEGER | レイヤー位置オフセット |
| LayerRenderOffscrOffsetX / Y | INTEGER | 描画オフスクリーンオフセット |
| LayerMaskOffsetX / Y | INTEGER | マスク位置オフセット |
| LayerMaskOffscrOffsetX / Y | INTEGER | マスクオフスクリーンオフセット |

#### データ参照
| カラム | 型 | 説明 |
|---|---|---|
| LayerRenderMipmap | INTEGER | 描画用MipmapのMainId |
| LayerLayerMaskMipmap | INTEGER | マスク用MipmapのMainId |
| LayerRenderThumbnail | INTEGER | 描画サムネイルのMainId |
| LayerLayerMaskThumbnail | INTEGER | マスクサムネイルのMainId |

#### 描画色
| カラム | 型 | 説明 |
|---|---|---|
| DrawColorEnable | INTEGER | 描画色有効 |
| DrawColorMainRed / Green / Blue | INTEGER | 描画色RGB |

#### パレットカラー（レイヤーカラー表示）
| カラム | 型 | 説明 |
|---|---|---|
| LayerUsePaletteColor | INTEGER | パレットカラー使用 |
| LayerNoticeablePaletteColor | INTEGER | 目立つパレットカラー |
| LayerPaletteRed / Green / Blue | INTEGER | パレットカラーRGB |

#### 特殊属性
| カラム | 型 | 説明 |
|---|---|---|
| FilterLayerInfo | BLOB | フィルタ/テキスト/グラデーション属性 |
| LayerEffectInfo | BLOB | レイヤー効果（境界効果等）-- ※実テーブルでは未確認、要再調査 |
| MonochromeFillInfo | BLOB | モノクロ塗りつぶし情報 |
| DraftLayer | (untyped) | 下書きレイヤーフラグ |
| SpecialRenderType | INTEGER | 特殊描画種別（13=色調補正, 20=用紙 等） |
| FilterLayerV132 | (untyped) | フィルタレイヤーV132互換 |
| FilterLayerColorMixingInfo | (untyped) | フィルタレイヤー色混合情報 (新版のみ) |
| UsePreviewColorType | (untyped) | プレビュー表現色使用 |
| UsePreviewMaskColorType | (untyped) | プレビューマスク表現色使用 |
| EffectRangeType | (untyped) | 効果範囲種別 |
| LightTableInfo | BLOB | ライトテーブル情報 (新版のみ) |
| LayerColorTypeIndex | INTEGER | レイヤー表現色インデックス (新版のみ) |
| LayerColorTypeBlackChecked | INTEGER | 表現色: 黒チェック (新版のみ) |
| LayerColorTypeWhiteChecked | INTEGER | 表現色: 白チェック (新版のみ) |
| MixSubColorForEveryPlot | INTEGER | サブカラー混合 (新版のみ) |
| MaterialContentType | INTEGER | 素材コンテンツ種別 (新版のみ, 110=テキスト) |

#### テキストレイヤー専用カラム（新版のみ、旧版は FilterLayerInfo に格納）
| カラム | 型 | 説明 |
|---|---|---|
| TextLayerType | INTEGER | テキスト種別（0=テキスト） |
| TextLayerString | BLOB | テキスト本文（**UTF-8**エンコード） |
| TextLayerAttributes | BLOB | テキスト属性（フォント、サイズ、色等、1029 bytes程度） |
| TextLayerStringArray | (untyped) | テキスト文字列配列 |
| TextLayerAttributesArray | (untyped) | テキスト属性配列 |
| TextLayerAddAttributesV01 | BLOB | 追加属性V01（904 bytes程度） |
| TextLayerAttributesVersion | INTEGER | 属性バージョン（1） |
| TextLayerVersion | (untyped) | テキストバージョン |
| TextLayerNameAutoChangeEnabled | INTEGER | レイヤー名自動変更 |

#### ベクターレイヤー専用カラム（新版のみ）
| カラム | 型 | 説明 |
|---|---|---|
| VectorNormalType | INTEGER | ベクター種別（0=通常ベクター） |
| VectorNormalStrokeIndex | INTEGER | ストロークインデックス |
| VectorNormalFillIndex | INTEGER | 塗りインデックス |
| VectorNormalBalloonIndex | INTEGER | 吹き出しインデックス |

#### べた塗り・グラデーション専用カラム（新版のみ）
| カラム | 型 | 説明 |
|---|---|---|
| GradationFillInfo | BLOB | グラデーション/べた塗り情報（300 bytes程度） |
| GradationFillColorMixingInfo | (untyped) | グラデーション色混合情報 |

#### 旧版専用カラム（新版では削除）
| カラム | 型 | 説明 |
|---|---|---|
| FilterLayerInfo | BLOB | フィルタ/テキスト/グラデーション全属性（旧版のみ） |

#### レンダリング制御
| カラム | 型 | 説明 |
|---|---|---|
| DrawToRenderOffscreenType | INTEGER | オフスクリーン描画種別 |
| DrawToRenderMipmapType | INTEGER | ミップマップ描画種別 |
| MoveOffsetAndExpandType | INTEGER | 移動オフセット・拡張種別 |
| FixOffsetAndExpandType | INTEGER | 固定オフセット・拡張種別 |
| RenderBoundForLayerMoveType | INTEGER | レイヤー移動時描画範囲種別 |
| SetRenderThumbnailInfoType | INTEGER | サムネイル描画情報設定種別 |
| DrawRenderThumbnailType | INTEGER | サムネイル描画種別 |

### 4.5 LayerThumbnail（レイヤーサムネイル）-- 43カラム

主要カラムのみ記載:

| カラム | 型 | 説明 |
|---|---|---|
| MainId | INTEGER | ID |
| CanvasId | INTEGER | キャンバスID |
| LayerId | INTEGER | レイヤーID |
| ThumbnailCanvasWidth | INTEGER | サムネイル幅 |
| ThumbnailCanvasHeight | INTEGER | サムネイル高さ |
| ThumbnailOffscreen | INTEGER | サムネイル用OffscreenのMainId |
| ThumbnailDrewMode | INTEGER | 描画モード |
| ThumbnailFixMode | INTEGER | 固定モード |
| ThumbnailUseDrawColor | INTEGER | 描画色使用 |
| ThumbnailMainColor* | INTEGER | メイン描画色RGB |
| ThumbnailSubColor* | INTEGER | サブ描画色RGB |
| ThumbnailColorTypeIndex | INTEGER | 表現色インデックス |
| ThumbnailPrewviewColorType* | INTEGER | プレビュー表現色各種（Opacity, Image, Alpha等） |
| ThumbnailPrewviewMaskBinarize | INTEGER | マスク二値化 |
| ThumbnailPrewviewMaskThreshold | INTEGER | マスク閾値 |
| Thumbnail*NeedRefresh / NeedRefresh1 | INTEGER | 各サイズの再描画フラグ（Smaller/Small/Middle/Large/Larger/Middle2x/Larger2x） |

### 4.6 Offscreen（オフスクリーンデータ参照）

| カラム | 型 | 説明 |
|---|---|---|
| MainId | INTEGER | ID |
| CanvasId | INTEGER | キャンバスID |
| LayerId | INTEGER | レイヤーID |
| Attribute | BLOB | パッキング属性（チャンネル構成等） |
| BlockData | **BLOB** | External ID（CHNKExtaチャンクとの紐付けキー）**※実際はBLOB型** |

### 4.7 Mipmap（ミップマップチェーン）

| カラム | 型 | 説明 |
|---|---|---|
| MainId | INTEGER | ID |
| CanvasId | INTEGER | キャンバスID |
| LayerId | INTEGER | レイヤーID |
| MipmapCount | INTEGER | ミップマップレベル数 |
| BaseMipmapInfo | INTEGER | ベースMipmapInfoのMainId |

### 4.8 MipmapInfo（ミップマップ詳細）

| カラム | 型 | 説明 |
|---|---|---|
| MainId | INTEGER | ID |
| CanvasId | INTEGER | キャンバスID |
| LayerId | INTEGER | レイヤーID |
| ThisScale | REAL | スケール係数 |
| Offscreen | INTEGER | OffscreenのMainId |
| NextIndex | INTEGER | 次のミップマップレベル |

### 4.9 ExternalChunk（外部チャンクオフセット索引）

| カラム | 型 | 説明 |
|---|---|---|
| ExternalID | BLOB | External ID文字列 |
| Offset | INTEGER | ファイル内バイトオフセット |

このテーブルにより、External IDからファイル内の位置をシーク可能。
全チャンクを走査せずにランダムアクセスできる。

### 4.10 ElemScheme（要素スキーマ）

全テーブルの MaxIndex（次に割り当て可能なID）を管理。

| カラム | 型 | 説明 |
|---|---|---|
| TableName | TEXT | テーブル名 |
| ElemType | INTEGER | 要素種別 |
| MaxIndex | INTEGER | 最大インデックス |

**実ファイルで確認された全テーブル名**（58エントリ）:
Offscreen, VOffscreen, MipmapInfo, Mipmap, LayerThumbnail, Layer, LayerObject,
CameraInfo, CharacterInfo, DessinDollInfo, RoomInfo, SmallObjectInfo, LightInfo,
FolderInfo, VectorObjectList, Manager3D, ModelInfo3D, ModelNodeInfo3D, Manager3DOd,
RulerParallel, RulerCurveParallel, RulerMultiCurve, RulerEmit, RulerCurveEmit,
RulerConcentricCircle, RulerGuide, RulerVanishPoint, RulerPerspective, RulerSymmetry,
SpecialRulerManager, StreamLine, SpeechSynthesis, Canvas, BrushEffectorGraphData,
BrushPatternImage, BrushPatternStyle, BrushFixedSpray, BrushStyle, FillStyle,
BrushStyleManager, ModelData3D, CanvasPreview, CanvasNode, CanvasItem, CanvasItemBinary,
Canvas3DModelLoader, Canvas3DModelBank, CanvasItemBank, Track, TimeLineLabel, TimeLine,
SituationCast, SituationSet, Scenario, AnimationCutBank, Project, PrimitiveInfo,
TimeLapseBlob, TimeLapseRecord, TimeLapseManager

### 4.11 ExternalTableAndColumnName（外部データカラム一覧）

CHNKExtaに実データが格納されるカラムの一覧:

| TableName | ColumnName |
|---|---|
| Offscreen | BlockData |
| VectorObjectList | VectorData |
| Canvas3DModelBank | BankData |
| Canvas3DModelLoader | ModelData |
| Track | TrackActionMixer |
| Track | TrackActionMixer2 |
| CanvasItemBinary | ItemBinaryData |
| Manager3DOd | SceneData |
| ModelData3D | Layer3DModelData |
| TimeLapseBlob | BlobData |

### 4.12 ParamScheme（パラメータスキーマ）

| カラム | 型 | 説明 |
|---|---|---|
| TableName | TEXT | テーブル名 |
| LabelName | TEXT | カラム名 |
| DataType | INTEGER | データ型 |
| Flag | INTEGER | フラグ |
| OwnerType | INTEGER | 所有者種別 |
| LockType | INTEGER | ロック種別 |
| LockSpecified | INTEGER | ロック指定 |
| LinkTable | TEXT | リンク先テーブル名 |

### 4.13 その他のテーブル

| テーブル | カラム | 説明 |
|---|---|---|
| AnimationCutBank | MainId, FirstTimeLine, FirstScenario, CurrentIndex, Enable, FlagScenarioV155 | アニメーション管理 |
| CanvasItem | (_PW_IDのみ) | キャンバスアイテム |
| CanvasItemBank | MainId, ModelBankMainIndex, BankRootItemMainIndex | アイテムバンク |
| RemovedExternal | ExternalID (BLOB) | 削除された外部チャンクID |

---

## 5. データ参照チェーン

レイヤーのピクセルデータに到達するまでのリレーション:

```
Layer.LayerRenderMipmap
  → Mipmap.MainId  →  Mipmap.BaseMipmapInfo
    → MipmapInfo.MainId  →  MipmapInfo.Offscreen
      → Offscreen.MainId  →  Offscreen.BlockData (= External ID)
        → ExternalChunk.ExternalID → ExternalChunk.Offset（ファイル内位置）
          → CHNKExta チャンク内のExternal IDと照合
            → BlockDataBeginChunk のzlib圧縮ピクセルデータ
```

マスクの場合は `Layer.LayerLayerMaskMipmap` から同様のチェーンを辿る。

---

## 6. ピクセルデータ形式

### 6.1 タイルグリッド

画像は **256x256ピクセルのタイル** に分割して格納される。

```
blocks_per_row    = ceil(canvas_height / 256)
blocks_per_column = ceil(canvas_width / 256)
padded_width      = blocks_per_column * 256
padded_height     = blocks_per_row * 256
```

### 6.2 タイル内データレイアウト

通常レイヤー（パッキング属性 `(1, 4)`）:
```
1タイル = 256 * 320 * 4 = 327,680 bytes

先頭 65,536 bytes (256*256*1):  アルファチャンネル（1 byte/pixel）
残り 262,144 bytes (256*256*4):  BGRA カラーデータ（4 bytes/pixel）
```

マスク（パッキング属性 `(1,)`）:
```
1タイル = 256 * 256 = 65,536 bytes
単一チャンネル（グレースケール）
```

### 6.3 圧縮

- 各タイルは **zlib** で個別に圧縮
- 空タイル（exist_flag == 0）はデータなし → ゼロ埋め

### 6.4 Offscreen Attribute のパッキング情報

Attribute配列のインデックス:
- `[1]`: 第1パッキングチャンネル数
- `[2]`: 第2パッキングチャンネル数
- `[8]`: ビットパッキング（32 = 1ビットデータ、非対応）

### 6.5 初期色（Init Color）

Attribute の `extra_info_section_size == 58` の場合:
```python
init_color = [min(255, value // (256**3)) for value in 4_int32_values]
```
デフォルトは `[0, 0, 0, 0]`（透明黒）。

### 6.6 色深度

`Canvas.CanvasChannelBytes` で色深度が決まる:
- `1` = 8bit（1 byte/channel） **← 確認済み**
- `2` = 16bit（2 bytes/channel）（推定）
- `4` = 32bit float（4 bytes/channel）（推定）

---

## 7. レイヤー種別（LayerType）-- **整数値**

> **重要**: clip_to_psd では文字列（`"lt_bitmap"` 等）として扱われているが、
> 実ファイルでは **INTEGER** として格納されている。clip_to_psdは内部変換している可能性。

### 確認済みの値

| 値 | 説明 | 補助判別カラム | 確認 |
|---|---|---|---|
| **0** | フォルダ / ベクターレイヤー / テキストレイヤー | LayerFolder, VectorNormalType, TextLayerType で判別 | tama.clip + test0323.clip |
| **1** | ラスターレイヤー | LCTI=0 | tama.clip + test0323.clip |
| **2** | べた塗り / グラデーションレイヤー | GradationFillInfo(BLOB)で判別, Vis=3(マスク付) | test0323.clip |
| **3** | 不明（ラスターレイヤー系？フリル素材？） | Vis=3(マスク付) | tama.clip: 「フリル」 |
| **256** | ルートフォルダ | LayerFolder=1 | tama.clip + test0323.clip |
| **1584** | 用紙レイヤー | SpecialRenderType=20 | tama.clip + test0323.clip |
| **4098** | 色調補正レイヤー | SpecialRenderType=13 | tama.clip |

### LayerType=0 の判別ロジック

LayerType=0は複数のレイヤー種別で共用される。以下のカラムで判別:

```
LayerType=0
  ├─ LayerFolder > 0        → フォルダ
  ├─ VectorNormalType != NULL → ベクターレイヤー（VectorObjectListにデータあり）
  ├─ TextLayerType != NULL   → テキストレイヤー（MaterialContentType=110）
  └─ 上記いずれでもない      → その他（要調査）
```

### 未確認の値（要調査）

| 推定値 | 説明 | 調査方法 |
|---|---|---|
| ? | 3Dレイヤー | クリスタで作成して確認 |
| ? | コマ枠レイヤー | クリスタで作成して確認 |
| 3 | 素材系レイヤー？ | tama.clip「フリル」の詳細調査 |

---

## 8. ブレンドモード（LayerComposite）

### 確認済み（実データ）

| 値 | PSDモード | クリスタ名称 | 確認 |
|---|---|---|---|
| **0** | `norm` | 通常 | tama.clip + test0323.clip |
| **2** | `mul ` | 乗算 | tama.clip |
| **5** | - | **減算** | test0323.clip (テキストレイヤーに設定) |
| **8** | `scrn` | スクリーン | tama.clip |
| **11** | `lddg` | **加算** | test0323.clip (ラスターレイヤーに設定) |
| **12** | - | **加算（発光）** | test0323.clip (ベクターレイヤーに設定) |
| **14** | `over` | オーバーレイ | tama.clip |
| **30** | `pass` | 通過（フォルダ用） | tama.clip |

> **重要な修正**: clip_to_psd では `5=fsub(カラー比較暗)`, `11=lddg(覆い焼きリニア)`,
> `12=lddg(覆い焼きリニア重複)` とされていたが、実ファイル検証の結果:
> - **5 = 減算**（クリスタ固有モード）
> - **11 = 加算**
> - **12 = 加算（発光）**（クリスタ固有モード）
> clip_to_psd のマッピングは一部不正確であった可能性がある。

### コミュニティ解析（未検証）

| 値 | PSDモード | 名称 |
|---|---|---|
| 1 | `dark` | 比較（暗） |
| 3 | `idiv` | 焼き込みカラー |
| 4 | `lbrn` | 焼き込みリニア |
| 6 | `dkCl` | 暗いカラー |
| 7 | `lite` | 比較（明） |
| 9 | `div ` | 覆い焼きカラー |
| 10 | `div ` | 覆い焼きカラー（重複?） |
| 13 | `lgCl` | 明るいカラー |
| 15 | `sLit` | ソフトライト |
| 16 | `hLit` | ハードライト |
| 17 | `vLit` | ビビッドライト |
| 18 | `lLit` | リニアライト |
| 19 | `pLit` | ピンライト |
| 20 | `hMix` | ハードミックス |
| 21 | `diff` | 差の絶対値 |
| 22 | `smud` | 除外 |
| 23 | `hue ` | 色相 |
| 24 | `sat ` | 彩度 |
| 25 | `colr` | カラー |
| 26 | `lum ` | 輝度 |
| 36 | `fdiv` | 除算(?) |

---

## 9. ビットフラグ

### LayerVisibility
| ビット | 意味 | 確認 |
|---|---|---|
| bit 0 (`& 1`) | レイヤー表示/非表示 | tama.clip |
| bit 1 (`& 2`) | マスク有効/無効 | tama.clip (Vis=3でレイヤー表示+マスク有効) |

### LayerFolder
| 値 | 意味 | 確認 |
|---|---|---|
| `0` | 通常レイヤー（フォルダでない） | tama.clip |
| `1` | ルートフォルダ | tama.clip (ID=2) |
| `17` | 通常フォルダ（16=閉じ + 1=フォルダ） | tama.clip |

> **注**: `17 = 16 | 1` で、bit 0がフォルダフラグ、bit 4が閉じ状態と推定

### LayerOpacity
- **値域**: 0-256（256 = 100%不透明）
- **実測値**: 18(≈7%), 84(≈33%), 90(≈35%), 115(≈45%), 174(≈68%), 210(≈82%), 256(100%)
- **計算**: `opacity_percent = value / 256 * 100`

### LayerSelect
| ビット | 意味 |
|---|---|
| bit 8 (`& 256`) | 相対位置指定 |

---

## 10. フィルタレイヤー情報（FilterLayerInfo）

`FilterLayerInfo` カラムに格納されるBLOBデータにより、
テキストレイヤー・色調補正レイヤー・グラデーションレイヤー等が表現される。

### フィルタ種別

| ID | PSD名 | 説明 |
|---|---|---|
| 1 | `brit` | 明るさ・コントラスト |
| 2 | `levl` | レベル補正 |
| 3 | `curv` | トーンカーブ |
| 4 | `hue2` | 色相・彩度・明度 |
| 5 | `blnc` | カラーバランス |
| 6 | `nvrt` | 階調の反転 |
| 9 | `grdm` | グラデーションマップ |

### フィルタパラメータ

**明るさ・コントラスト (1)**: brightness (int32), contrast (int32)
**レベル補正 (2)**: 5x int16 (入力床, 入力天井, 出力床, 出力天井, ガンマ)
**トーンカーブ (3)**: 130-byte配列/チャンネル (x,y座標ペア 16bit)
**色相・彩度 (4)**: hue (signed int32), saturation (signed int32), lightness (signed int32)

### テキストレイヤー属性

FilterLayerInfo内のパラメータIDで識別:

| Param ID | 内容 | 形式 |
|---|---|---|
| 11 | テキストラン（スタイル配列） | 複合構造 |
| 12, 16, 20 | 揃え/下線/取消線 | 位置+長さの範囲 |
| 31 | フォント名 | UTF-8文字列 |
| 32 | フォントサイズ | int32 |
| 34 | 色 | 3x int32 (RGBA) |
| 42 | バウンディングボックス | 4x signed int32 (top, left, bottom, right) |
| 57 | フォントリスト | 表示名+内部フォント名 |
| 64 | 四隅座標 | 8x int32（変形コーナーポイント） |

---

## 11. レイヤー効果（LayerEffectInfo）

UTF-16BE エンコードされた `"EffectEdge"` パラメータ名で検索。

| フィールド | 型 | 説明 |
|---|---|---|
| enabled | int32 | 有効/無効 |
| thickness | double | 太さ |
| red | int32 >> 24 | R値 |
| green | int32 >> 24 | G値 |
| blue | int32 >> 24 | B値 |

---

## 12. SpecialRenderType（特殊描画種別）

| 値 | 説明 | 確認 |
|---|---|---|
| `13` | 色調補正レイヤー | tama.clip |
| `20` | 用紙レイヤー | tama.clip |
| `None` | 通常レイヤー | tama.clip |

---

## 13. 書き込み時の制約（実験で確認済み）

### CSP互換のレイヤー追加ルール

| 操作 | 結果 |
|---|---|
| SQLiteメタデータ変更（rename, opacity, blend） | OK |
| ラスターレイヤー INSERT（RenderMipmap=0, refs=0） | OK |
| ラスターレイヤーを既存フォルダの子に追加 | OK |
| フォルダレイヤー INSERT（全カラム完コピー含む） | **CSPクラッシュ** |
| 既存ラスターを UPDATE でフォルダに変換 | OK |
| INSERT 後に UPDATE でフォルダ化 | **CSPクラッシュ** |

### 回避策

フォルダはクリスタ側で事前に作成し、テンプレートとして使用する。
`add-layer --parent <folder-id>` で既存フォルダ内にレイヤーを追加するのは安全。

### 原因の推定

CSP は Layer テーブル読み込み時にフォルダ行に対して特殊な初期化を行っており、
外部から INSERT された行は内部の整合性チェック（Mipmap チェーン、Offscreen 参照、
または _PW_ID / AUTOINCREMENT 関連）を満たせない。
Access Violation (0xc0000005) で即クラッシュする。

---

## 14. 未解明事項（要調査）
<!-- was section 13 -->

### 高優先（CLIツール開発に必要）
- [x] ~~LayerType の完全列挙~~ → 0(フォルダ/ベクター/テキスト), 1(ラスター), 2(べた塗り/グラデーション), 256(ルート), 1584(用紙), 4098(色調補正) 確認済
- [x] ~~ブレンドモード: 加算、加算（発光）、減算~~ → 11=加算, 12=加算(発光), 5=減算 確認済
- [x] ~~LayerOpacity の値域~~ → 0-256 (256=100%) 確認済
- [ ] **LayerType=3 の正体**: tama.clip「フリル」で出現。素材レイヤー？
- [ ] **16bit/32bit色深度時のピクセルデータ**: CanvasChannelBytes=2,4 のファイル
- [ ] **TextLayerAttributes の内部構造**: 1029 bytesのバイナリ解析
- [ ] **GradationFillInfo の内部構造**: 300 bytesのバイナリ解析（べた塗りとグラデーションの区別方法）
- [ ] **スキーマバージョン差異の体系化**: tama.clip(52カラム) vs test0323.clip(73カラム) -- 両方サポートが必要

### 中優先
- [ ] **CanvasDefaultChannelOrder=33 の意味**: チャンネル順序の列挙
- [ ] **LayerFolder の完全なビット構造**: 1=フォルダ/ルート, 17=通常フォルダ(閉じ) の確認
- [ ] **ベクターデータ形式**: VectorObjectList.VectorData の内部フォーマット
- [ ] **LayerComp / LayerCompManager**: 新版で追加されたテーブルの用途
- [ ] **アニメーションデータ**: Track, TimeLine, Scenario等のテーブル構造
- [ ] **定規データ**: Ruler*テーブル群の使用時の構造

### 低優先
- [ ] **CHNKHead の詳細**: ヘッダー情報の完全な構造
- [ ] **CHNKFoot の詳細**: フッター情報の構造
- [ ] **CSFCHUNK のオフセット情報**: 8bytesのオフセットデータの意味

---

## 14. バージョン間スキーマ差異

両ファイルとも `ProjectInternalVersion: 1.1.0` だが、Layerテーブルのカラム数が異なる。
CSP本体のバージョン違いによるスキーマ拡張と推定。

### test0323.clip にのみ存在するカラム（22カラム）

テキストレイヤー関連(9): `TextLayerType`, `TextLayerString`, `TextLayerAttributes`,
`TextLayerStringArray`, `TextLayerAttributesArray`, `TextLayerAddAttributesV01`,
`TextLayerAttributesVersion`, `TextLayerVersion`, `TextLayerNameAutoChangeEnabled`

ベクター関連(4): `VectorNormalType`, `VectorNormalStrokeIndex`, `VectorNormalFillIndex`, `VectorNormalBalloonIndex`

グラデーション関連(2): `GradationFillInfo`, `GradationFillColorMixingInfo`

表現色関連(3): `LayerColorTypeIndex`, `LayerColorTypeBlackChecked`, `LayerColorTypeWhiteChecked`

その他(4): `FilterLayerColorMixingInfo`, `LightTableInfo`, `MaterialContentType`, `MixSubColorForEveryPlot`

### tama.clip にのみ存在するカラム（1カラム）

`FilterLayerInfo` -- 旧版ではテキスト/フィルタ/グラデーション情報がすべてこの1カラムに格納

### 新テーブル（test0323.clip のみ）

- `LayerComp`: レイヤーカンプ（状態保存）
- `LayerCompManager`: レイヤーカンプ管理
- `BrushEffectorGraphData`, `BrushPatternImage`, `BrushPatternStyle`, `BrushStyle`, `BrushStyleManager`: ブラシ関連
