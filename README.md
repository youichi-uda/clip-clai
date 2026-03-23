# clip-clai — AI-powered CLI for Clip Studio Paint

Read, export, and edit layers without opening Clip Studio Paint.

[日本語 README はこちら](README.ja.md)

---

## What is clip-clai?

clip-clai is a command-line tool that lets AI assistants (like Claude Code) directly manipulate Clip Studio Paint's native `.clip` files. It parses the binary container format, extracts the embedded SQLite database, and provides commands to inspect, export, and modify layer data programmatically.

**Key features:**
- Inspect canvas metadata (size, DPI, color depth, ICC profile)
- List and browse the full layer tree (raster, vector, text, folders, adjustments)
- Export individual layers or thumbnails as PNG
- Rename layers and edit properties (opacity, blend mode, visibility)
- Comes with a Claude Code `/clip` Skill for natural language operation
- Supports both legacy and modern .clip schema versions

## Installation

```bash
npm install -g clip-clai
```

Or run directly:
```bash
npx clip-clai <command>
```

**Requirements:** Node.js 20+

## Quick Start

```bash
# View file information
clip-clai info artwork.clip

# List all layers as a tree
clip-clai layers artwork.clip

# Export a layer as PNG (use layer ID from `layers` output)
clip-clai export artwork.clip 7 -o layer7.png

# Export the canvas preview thumbnail
clip-clai thumbnail artwork.clip -o preview.png

# Get structured JSON output (ideal for AI/scripting)
clip-clai layers artwork.clip --json
```

## Commands

### Free Tier

| Command | Description |
|---------|-------------|
| `info <file> [--json]` | Canvas info (size, DPI, layers, schema) |
| `layers <file> [--json] [--flat]` | Layer tree with types, blend modes, opacity |
| `inspect <file> [--json]` | Full SQLite structure dump |
| `thumbnail <file> -o <path>` | Export canvas preview as PNG |
| `export <file> <layer-id> -o <path>` | Export layer pixels as PNG |

### Pro Tier

| Command | Description |
|---------|-------------|
| `rename <file> <layer-id> <name>` | Rename a layer |
| `edit <file> <layer-id> [options]` | Edit opacity, blend mode, visibility |
| `activate <key>` | Activate Pro license |
| `deactivate` | Deactivate license |
| `status` | Show license status |

**Edit options:** `--opacity <0-100>` `--blend <mode>` `--visible` `--hidden` `-o <output-file>`

**Blend modes:** normal, multiply, screen, overlay, add, add-glow, subtract, soft-light, hard-light, color-dodge, color-burn, lighten, darken, difference, exclusion, hue, saturation, color, luminosity, pass-through, divide

## Claude Code Integration

clip-clai ships with a `/clip` Skill for [Claude Code](https://claude.ai/claude-code). Place the skill in your project:

```
.claude/skills/clip/SKILL.md
```

Then use natural language:
```
/clip Show me the layer structure of artwork.clip
/clip Export the background layer as PNG
/clip Rename all layers to English
/clip Set opacity of layer 7 to 50%
```

## How It Works

Clip Studio Paint `.clip` files are binary containers with:
1. **CSFCHUNK header** — File metadata
2. **CHNKExta chunks** — Pixel data (256x256 tiles, zlib compressed, BGRA format)
3. **CHNKSQLi chunk** — Embedded SQLite database with all layer metadata
4. **CHNKFoot** — Footer

clip-clai parses this container, extracts the SQLite database, and provides a typed API for querying and modifying layer data. Pixel export decompresses individual tiles and assembles them into full-resolution images via [sharp](https://sharp.pixelplumbing.com/).

## .clip Format Specification

See [docs/clip-format-spec.md](docs/clip-format-spec.md) for the complete reverse-engineered specification, including:
- SQLite table schemas (Layer: 52-73 columns depending on version)
- Blend mode value mapping (including CSP-specific modes like Add Glow)
- Pixel tile format and compression details
- Schema version differences between CSP releases

## Pro License

Write commands (rename, edit) require a Pro license.

**Get Pro:** [https://youichi-uda.gumroad.com/l/clip-clai-pro](https://youichi-uda.gumroad.com/l/clip-clai-pro)

```bash
clip-clai activate <your-license-key>
```

## Development

```bash
git clone https://github.com/youichi-uda/clip-clai.git
cd clip-clai/packages/clip-clai
npm install
npm test              # Run all 42 tests
npm run dev -- info <file>  # Run in dev mode
```

## Tech Stack

- **TypeScript** + Node.js
- **better-sqlite3** — SQLite access
- **sharp** — Image processing
- **commander.js** — CLI framework
- **vitest** — Testing (42 tests: unit + integration + E2E)

## License

MIT

---

**Built for creators who want AI to understand their artwork.**
