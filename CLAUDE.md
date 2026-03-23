# clip-clai project

## Overview
CLI tool + Claude Code Skill for manipulating Clip Studio Paint .clip files.

## Structure
- `packages/clip-clai/` - Main CLI package (TypeScript, Node.js)
- `docs/clip-format-spec.md` - .clip file format specification
- `docs/proposal.md` - Project proposal
- `samples/` - Sample .clip files for testing
- `skills/clip/` - Claude Code Skill definition

## Development
```bash
cd packages/clip-clai
npm install
npm run dev -- <command> [args]   # Run in dev mode
npm test                          # Run tests
npm run build                     # Build for production
```

## Testing
- Unit tests: `vitest run`
- Test fixtures: `tests/fixtures/` (symlinks to sample .clip files)
- Real samples: `../../samples/tama/tama.clip`, `../../test0323.clip`

## Key specs
- .clip files are binary containers with SQLite embedded (see docs/clip-format-spec.md)
- Two schema versions exist (old: 52 Layer cols, new: 73 Layer cols) - both must be supported
- Pixel data: 256x256 tiles, zlib compressed, BGRA format
