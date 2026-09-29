import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGoldRows } from "@aihot/backend/editorial/gold";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const row = { caseId: "case-1", material: { title: "遥感数据产品", sourceName: "Local source" }, sourceFacts: { sourceKind: "rss" }, gold: { decision: "select" } };
test("unlabelled and duplicate gold cases are rejected before model evaluation", () => {
  assert.throws(() => parseGoldRows(JSON.stringify({ ...row, gold: { decision: null } })), /未完成/);
  assert.throws(() => parseGoldRows([JSON.stringify(row), JSON.stringify(row)].join("\n")), /重复/);
  assert.throws(() => parseGoldRows(""), /为空/);
  assert.equal(parseGoldRows(JSON.stringify(row))[0]!.material.bodyOriginal, null);
});
test("evaluation without --live validates labels without loading database or model providers", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rshot-gold-"));
  try {
    const file = path.join(directory, "labelled.jsonl");
    writeFileSync(file, JSON.stringify(row));
    const output = execFileSync(process.execPath, ["scripts/eval-selection.ts", "--gold", file, "--n", "1"], {
      cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8",
      env: { ...process.env, MODEL_CALLS_ENABLED: "true", DATABASE_URL: "postgres://127.0.0.1:1/unreachable_test" },
    });
    assert.deepEqual(JSON.parse(output), { status: "ready_for_evaluation", cases: 1, requestsSent: 0 });
  } finally {
    const parent = path.resolve(tmpdir()); const actual = path.resolve(directory);
    if (!actual.startsWith(parent + path.sep) || !path.basename(actual).startsWith("rshot-gold-")) throw new Error("Unsafe test cleanup path");
    rmSync(actual, { recursive: true, force: true });
  }
});
