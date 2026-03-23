# clip-tool: .clipファイル操作CLI & AI Skill 企画書

## 背景と課題

Clip Studio Paint (クリスタ) はプロ・アマ問わず広く使われるペイントツールだが、
AI連携の仕組み（MCP等）を構造的に組み込むのが難しい。

一方で、クリスタの保存形式である **.clipファイルはSQLiteデータベース** であり、
外部ツールから読み書きが技術的に可能である。

## コンセプト

**「AIがクリスタの制作データを直接操作できるCLIツール + Claude Code Skill」**

クリスタ本体を介さず、.clipファイルを外部から操作することで、
AIによるイラスト制作支援ワークフローを実現する。

## ターゲットユーザー

| セグメント | ニーズ |
|---|---|
| イラストレーター / 漫画家 | 大量のレイヤー整理、メタデータ管理の自動化 |
| 同人・商業制作チーム | 複数ファイルの一括処理、テンプレート展開 |
| AI活用クリエイター | AI生成画像のクリスタプロジェクトへの自動統合 |
| テック系クリエイター | スクリプトによるワークフロー自動化 |

## プロダクト構成

### 1. `clip-tool` CLI (コア)

.clipファイルを操作するNode.js/Python製のCLIツール。

#### 主要コマンド（案）

```
clip-tool info <file.clip>          # ファイル情報・メタデータ表示
clip-tool layers <file.clip>        # レイヤー一覧・ツリー表示
clip-tool export-layer <file.clip> <layer> -o out.png   # レイヤー画像エクスポート
clip-tool import-layer <file.clip> <image.png> [options] # 画像をレイヤーとして追加
clip-tool rename-layer <file.clip> <layer> <new-name>    # レイヤー名変更
clip-tool reorder-layers <file.clip> [spec]              # レイヤー順序変更
clip-tool set-canvas <file.clip> --width --height        # キャンバスサイズ変更
clip-tool merge <base.clip> <overlay.clip> -o out.clip   # ファイル合成
clip-tool template <template.clip> --apply <config.json> # テンプレート展開
clip-tool inspect <file.clip>       # SQLite構造の詳細ダンプ（開発者向け）
```

### 2. Claude Code Skill (`/clip`)

Claude Codeから自然言語で.clipファイルを操作するSkill。

```
/clip このファイルのレイヤー構成を教えて → clip-tool layers 実行
/clip 背景レイヤーをPNGでエクスポート → clip-tool export-layer 実行
/clip AI生成した画像を新しいレイヤーとして追加 → clip-tool import-layer 実行
/clip レイヤー名を日本語から英語に一括変換 → 複数rename-layer実行
```

### 3. MCP Server（将来拡張）

clip-toolをMCPサーバーとしてラップし、Claude Desktop等から利用可能にする。

## .clipファイル構造（調査必要）

.clipファイルはSQLiteデータベースで、以下の情報が格納されていると推定される：

- **CanvasInfo**: キャンバスサイズ、解像度、カラーモード
- **Layer**: レイヤーのメタデータ（名前、種類、不透明度、ブレンドモード、表示/非表示）
- **LayerData / ChunkData**: ピクセルデータ（独自圧縮の可能性あり）
- **Offscreen**: サムネイルやプレビュー画像
- **Metadata**: ファイル全体のメタデータ

### 技術リスク

| リスク | 影響 | 対策 |
|---|---|---|
| ピクセルデータの独自圧縮形式 | 画像の読み書きが困難 | まずメタデータ操作から着手、画像はサムネイル経由 |
| バージョン間のDB構造差異 | 互換性問題 | 主要バージョンの構造を調査・テスト |
| 書き込み後にクリスタで開けない | 致命的 | 読み取り専用モードをデフォルトに、書き込みは慎重に検証 |
| セルシスの利用規約 | 法的リスク | リバースエンジニアリング条項の確認 |

## 開発ロードマップ

### Phase 0: 調査（1-2週間）
- [ ] .clipファイルのSQLiteスキーマ完全解析
- [ ] ピクセルデータのフォーマット調査
- [ ] 既存のOSSやコミュニティの知見収集
- [ ] セルシスの利用規約・ライセンス確認

### Phase 1: 読み取り専用CLI（MVP）
- [ ] `info`, `layers`, `inspect` コマンド
- [ ] `export-layer`（サムネイルベース or フルピクセル）
- [ ] npm / pip パッケージとして公開

### Phase 2: 書き込み対応
- [ ] `rename-layer`, `reorder-layers`（メタデータ書き込み）
- [ ] `import-layer`（画像追加）
- [ ] 書き込み後のクリスタ互換性テスト

### Phase 3: AI統合
- [ ] Claude Code Skill作成
- [ ] MCP Server化
- [ ] AI生成画像の自動統合ワークフロー

## 収益モデル（案）

| モデル | 内容 |
|---|---|
| **OSS Core + Pro License** | 基本機能はOSS、書き込み・一括処理・Skillはプロ版（有料） |
| **個人**: $9.99/月 or $79/年 | 全機能利用可 |
| **チーム**: $29.99/月 | 複数人利用、優先サポート |
| **Gumroad / BOOTH 販売** | 日本市場向けに買い切りプランも検討 |

## 競合・類似プロジェクト

- **clip_util (Python)**: コミュニティ製の.clip解析ツール（存在するか要調査）
- **clip-studio-reader**: 非公式のファイルリーダー（要調査）
- **Photoshop関連**: psd.js等のPSD操作ライブラリは充実しているが、.clip向けは皆無に近い

→ **.clip専用の本格的なCLI + AI連携は、ほぼブルーオーシャン**

## 技術選定（案）

| 項目 | 候補 | 理由 |
|---|---|---|
| 言語 | TypeScript (Node.js) | Claude Code Skillとの親和性、npm配布 |
| SQLite | better-sqlite3 | 同期API、高速 |
| 画像処理 | sharp | PNG/JPEG変換 |
| CLI framework | commander.js | 軽量・標準的 |
| テスト | vitest | 高速・モダン |

## 次のアクション

1. **実際の.clipファイルを解析して、SQLiteスキーマを把握する**
2. 既存コミュニティの知見を収集する
3. 法的リスク（利用規約）を確認する
4. Phase 0の調査結果をもとに、技術的実現可能性を判断する
