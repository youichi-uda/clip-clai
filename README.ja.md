# clip-clai — AI-powered CLI for Clip Studio Paint

クリスタを開かずにレイヤーの閲覧・エクスポート・編集が可能

[English README](README.md)

---

## clip-clai とは？

clip-clai は、AI アシスタント（Claude Code など）が Clip Studio Paint の `.clip` ファイルを直接操作するためのコマンドラインツールです。バイナリコンテナ形式を解析し、内蔵の SQLite データベースを抽出して、レイヤーデータの確認・エクスポート・編集をプログラムから実行できます。

**主な機能:**
- キャンバス情報の確認（サイズ、DPI、色深度、ICCプロファイル）
- レイヤーツリーの一覧表示（ラスター、ベクター、テキスト、フォルダ、色調補正）
- 個別レイヤーやサムネイルのPNGエクスポート
- レイヤー名変更、プロパティ編集（不透明度、ブレンドモード、表示/非表示）
- Claude Code `/clip` Skill による自然言語操作
- 新旧両方の .clip スキーマバージョンに対応

## インストール

```bash
npm install -g clip-clai
```

または直接実行:
```bash
npx clip-clai <command>
```

**動作要件:** Node.js 20以上

## 使い方

```bash
# ファイル情報を表示
clip-clai info artwork.clip

# レイヤーをツリー表示
clip-clai layers artwork.clip

# レイヤーをPNGでエクスポート（IDは layers で確認）
clip-clai export artwork.clip 7 -o layer7.png

# プレビューサムネイルをエクスポート
clip-clai thumbnail artwork.clip -o preview.png

# JSON出力（AI・スクリプト連携に最適）
clip-clai layers artwork.clip --json
```

## コマンド一覧

### 無料

| コマンド | 説明 |
|---------|------|
| `info <file> [--json]` | キャンバス情報（サイズ、DPI、レイヤー数、スキーマ） |
| `layers <file> [--json] [--flat]` | レイヤーツリー（種別、ブレンドモード、不透明度付き） |
| `inspect <file> [--json]` | SQLite構造の詳細ダンプ |
| `thumbnail <file> -o <path>` | プレビュー画像をPNGエクスポート |
| `export <file> <layer-id> -o <path>` | レイヤー画像をPNGエクスポート |

### Pro（有料）

| コマンド | 説明 |
|---------|------|
| `rename <file> <layer-id> <name>` | レイヤー名変更 |
| `edit <file> <layer-id> [options]` | 不透明度・ブレンドモード・表示状態の変更 |
| `activate <key>` | Proライセンスの有効化 |
| `deactivate` | ライセンスの無効化 |
| `status` | ライセンス状態の確認 |

**edit オプション:** `--opacity <0-100>` `--blend <mode>` `--visible` `--hidden` `-o <output-file>`

**ブレンドモード:** normal(通常), multiply(乗算), screen(スクリーン), overlay(オーバーレイ), add(加算), add-glow(加算発光), subtract(減算), soft-light(ソフトライト), hard-light(ハードライト), color-dodge(覆い焼きカラー), color-burn(焼き込みカラー), lighten(比較明), darken(比較暗), difference(差の絶対値), exclusion(除外), hue(色相), saturation(彩度), color(カラー), luminosity(輝度), pass-through(通過), divide(除算)

## Claude Code 連携

clip-clai には Claude Code 用の `/clip` Skill が付属しています。プロジェクトに配置:

```
.claude/skills/clip/SKILL.md
```

自然言語で操作:
```
/clip artwork.clip のレイヤー構成を教えて
/clip 背景レイヤーをPNGでエクスポートして
/clip レイヤー名を全部英語に変えて
/clip レイヤー7の不透明度を50%にして
```

## 仕組み

Clip Studio Paint の `.clip` ファイルは以下のバイナリコンテナ形式です:
1. **CSFCHUNK ヘッダー** — ファイルメタデータ
2. **CHNKExta チャンク** — ピクセルデータ（256x256タイル、zlib圧縮、BGRA形式）
3. **CHNKSQLi チャンク** — 内蔵SQLiteデータベース（全レイヤーメタデータ）
4. **CHNKFoot** — フッター

clip-clai はこのコンテナを解析し、SQLite データベースを抽出して、レイヤーデータの参照・変更に型付きAPIを提供します。ピクセルエクスポートは個別タイルを解凍し、[sharp](https://sharp.pixelplumbing.com/) で高解像度画像に組み立てます。

## .clip ファイルフォーマット仕様

[docs/clip-format-spec.md](docs/clip-format-spec.md) にリバースエンジニアリングによる完全な仕様書があります:
- SQLiteテーブルスキーマ（Layerテーブル: バージョンにより52-73カラム）
- ブレンドモード値のマッピング（加算発光などクリスタ固有モード含む）
- ピクセルタイル形式と圧縮の詳細
- CSPリリース間のスキーマバージョン差異

## Pro ライセンス

書き込みコマンド（rename, edit）には Pro ライセンスが必要です。

**Pro を取得:** [https://youichi-uda.gumroad.com/l/clip-clai-pro](https://youichi-uda.gumroad.com/l/clip-clai-pro)

```bash
clip-clai activate <ライセンスキー>
```

## 開発

```bash
git clone https://github.com/youichi-uda/clip-clai.git
cd clip-clai/packages/clip-clai
npm install
npm test                      # 全42テスト実行
npm run dev -- info <file>    # 開発モードで実行
```

## 技術スタック

- **TypeScript** + Node.js
- **better-sqlite3** — SQLiteアクセス
- **sharp** — 画像処理
- **commander.js** — CLIフレームワーク
- **vitest** — テスト（42テスト: ユニット + 統合 + E2E）

## ライセンス

MIT

---

**AIにあなたの作品を理解させるために作られたツール。**
