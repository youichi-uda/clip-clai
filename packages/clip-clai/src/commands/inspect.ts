import { ClipDatabase } from '../core/database.js';
import { readClipFile } from '../core/reader.js';

export function inspectCommand(filePath: string, opts: { json?: boolean }): void {
  const clipFile = readClipFile(filePath);
  const db = new ClipDatabase(filePath);

  try {
    const tables = db.getTableNames();
    const result: Record<string, unknown> = {
      file: {
        path: clipFile.filePath,
        size: clipFile.fileSize,
        chunks: clipFile.chunks.map(c => ({
          type: c.type,
          offset: c.offset,
          size: c.size,
        })),
        sqliteOffset: clipFile.sqliteOffset,
        sqliteSize: clipFile.sqliteSize,
      },
      schemaVersion: db.schemaVersion,
      tables: tables.map(t => ({
        name: t,
        columns: db.getTableSchema(t),
        rowCount: db.getTableRowCount(t),
      })),
    };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`File: ${clipFile.filePath} (${clipFile.fileSize} bytes)`);
      console.log(`Chunks: ${clipFile.chunks.length}`);
      for (const c of clipFile.chunks) {
        console.log(`  ${c.type} at ${c.offset} (${c.size} bytes)`);
      }
      console.log(`\nSQLite: offset=${clipFile.sqliteOffset} size=${clipFile.sqliteSize}`);
      console.log(`Schema: ${db.schemaVersion}`);
      console.log(`\nTables (${tables.length}):`);
      for (const t of tables) {
        const cols = db.getTableSchema(t);
        const count = db.getTableRowCount(t);
        console.log(`  ${t} (${count} rows, ${cols.length} cols)`);
      }
    }
  } finally {
    db.close();
  }
}
