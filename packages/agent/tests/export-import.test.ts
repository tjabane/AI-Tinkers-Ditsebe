import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

test("export CLI stages and deduplicates without touching live messages", async () => {
  const folder = await mkdtemp(join(tmpdir(), "ditsebe-import-test-"));
  try {
    const source = join(folder, "chat.txt");
    await writeFile(source, "12/09/2026, 14:30 - Sam: Call 082 123 4567\n12/09/2026, 14:31 - Jo: <attached: missing.pdf>");
    const dbPath = join(folder, "test.db");
    for (let n = 0; n < 2; n++) {
      const process = Bun.spawn([Bun.which("bun")!, "run", fileURLToPath(new URL("../scripts/import-export.ts", import.meta.url)), source, "Test", "DMY"], {
        env: { ...Bun.env, DB_PATH: dbPath }, cwd: folder, stdout: "pipe", stderr: "pipe",
      });
      const output = await new Response(process.stdout).text();
      const error = await new Response(process.stderr).text();
      expect(await process.exited, error).toBe(0);
      expect(output).not.toContain("082 123 4567");
    }
    const db = new Database(dbPath);
    try {
      expect(db.query("SELECT COUNT(*) AS n FROM archive_messages").get()).toEqual({ n: 2 });
      expect(db.query("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
      expect(db.query("SELECT SUM(duplicates) AS n FROM import_runs").get()).toEqual({ n: 2 });
      expect(db.query("SELECT attachment_status FROM archive_messages WHERE text LIKE '%missing.pdf%'").get()).toEqual({ attachment_status: "missing_or_invalid" });
    } finally { db.close(); }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
