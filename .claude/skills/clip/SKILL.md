---
name: clip
description: Clip Studio Paint の .clip ファイルを操作する。レイヤー情報の確認、画像エクスポート、PSD変換、レイヤー名変更、属性変更、画像インポート、バッチ処理、テンプレート展開が可能。.clip ファイルに関する操作を求められたときに使用する。
allowed-tools: Bash(npx tsx *), Bash(sharp *), Read, Glob, Write
argument-hint: <.clipファイルパスと操作内容>
---

# /clip - Clip Studio Paint ファイル操作

`clip-clai` CLI を使って .clip ファイルを操作してください。
CLI は `D:/dev/ClipStudioPaint/packages/clip-clai/` にあります。

## コマンド実行方法

```bash
cd D:/dev/ClipStudioPaint/packages/clip-clai && npx tsx src/index.ts <command> [args]
```

Pro コマンドはテスト時に環境変数 `CLIP_CLAI_LICENSE_BYPASS=1` を付けてください。

## 利用可能なコマンド

### 読み取り（Free）
- `info <file> [--json]` -- ファイル情報
- `layers <file> [--json] [--flat]` -- レイヤーツリー
- `export <file> <layer-id> -o <path.png>` -- レイヤーPNGエクスポート
- `thumbnail <file> -o <path.png>` -- プレビュー画像
- `inspect <file> [--json]` -- SQLiteテーブル構造

### 書き込み（Pro）
- `rename <file> <layer-id> <new-name>` -- レイヤー名変更
- `edit <file> <layer-id> [--opacity 0-100] [--blend MODE] [--visible/--hidden]` -- 属性変更
- `add-layer <file> [--name N] [--parent ID] [--opacity N] [--blend MODE]` -- 空ラスターレイヤー追加
- `import <file> <image> [--name N] [--opacity N] [--blend MODE]` -- 画像をレイヤーとして追加

### 変換・バッチ（Pro）
- `to-psd <file> [-o output.psd]` -- .clip → PSD変換
- `batch <glob> <operation> [args...]` -- 複数ファイル一括処理
- `template <config.json>` -- テンプレート設定からレイヤー構成を展開

## バッチ処理の例

```bash
# 全ファイルのDPIを350に統一
clip-clai batch "manga/**/*.clip" set-dpi 350

# 全ファイルの特定レイヤーの不透明度変更
clip-clai batch "*.clip" edit 7 opacity=50

# 全ファイル情報の一覧
clip-clai batch "**/*.clip" info --json
```

## テンプレートの例

```json
{
  "base": "template.clip",
  "output": "new-illustration.clip",
  "layers": [
    { "name": "下描き", "opacity": 20 },
    { "name": "下地", "parent": "塗り" },
    { "name": "影1", "parent": "塗り", "blend": "multiply", "opacity": 50 }
  ]
}
```

## AI画像統合ワークフロー

AI生成画像を .clip に統合する場合:
1. sharp でプログラム的に画像を生成（グラデーション、パターン、テクスチャ等）
2. `import` コマンドでレイヤーとして追加
3. `edit` で不透明度やブレンドモードを調整

```bash
# sharpで画像生成
npx tsx -e "import sharp from 'sharp'; await sharp({create:{width:1920,height:1080,channels:4,background:{r:255,g:200,b:100,alpha:128}}}).png().toFile('/tmp/warm-overlay.png')"

# .clipに追加
clip-clai import artwork.clip /tmp/warm-overlay.png --name "暖色オーバーレイ" --blend overlay --opacity 30
```

## 使い方のルール

1. まず `layers <file> --json` でレイヤー構造を確認する
2. layer-id は JSON 出力の `id` フィールド（= MainId）を使う
3. 書き込み操作は自動バックアップ（.bak）あり
4. フォルダの新規作成は CSP 互換性問題があるため、既存テンプレートのフォルダを使うこと

## ブレンドモード一覧

normal, multiply, screen, overlay, add, add-glow, subtract, soft-light, hard-light,
color-dodge, color-burn, lighten, darken, difference, exclusion, hue, saturation,
color, luminosity, pass-through, divide, vivid-light, linear-light, pin-light, hard-mix,
linear-burn, darker-color, lighter-color

$ARGUMENTS
