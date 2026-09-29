import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
test("bounded batch validation sends no model request and rejects more than five materials", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "rshot-batch-"));
  try {
    const file = path.join(folder, "batch.json");
    const rows = Array.from({ length: 5 }, (_, i) => ({ sourceId: "local", originalTitle: `Local case ${i}`, url: `https://example.org/${i}`,
      publishedAt: "2026-09-29T00:00:00Z", text: "Local fixture", materialScope: "abstract" }));
    writeFileSync(file, JSON.stringify(rows));
    const run = () => spawnSync(process.execPath, ["scripts/process-review-batch.ts", "--input", file], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
    const checked = run(); assert.equal(checked.status, 0);
    assert.deepEqual(JSON.parse(checked.stdout), { status: "ready", materials: 5, requestsSent: 0, published: false });
    writeFileSync(file, JSON.stringify([...rows, { ...rows[0], url: "https://example.org/sixth" }]));
    assert.notEqual(run().status, 0);
  } finally {
    const actual = path.resolve(folder);
    if (!actual.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(actual).startsWith("rshot-batch-")) throw new Error("Unsafe test cleanup");
    rmSync(actual, { recursive: true, force: true });
  }
});
