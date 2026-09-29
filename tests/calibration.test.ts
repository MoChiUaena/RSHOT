import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { calibrationBatch, chooseDevelopmentCases, exportCalibrationLabels, importCalibrationBatch, PendingCalibrationSchema, saveCalibrationLabel } from "@aihot/backend/admin/calibration";
import { parseGoldRows } from "@aihot/backend/editorial/gold";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { buildApp } from "../apps/api/src/app.ts";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const row = (caseId: string, sourceName: string, sourceUrl: string, split = "development") => PendingCalibrationSchema.parse({ caseId,
  material: { title: `Local material ${caseId}`, sourceName, bodyOriginal: "Private calibration test evidence from a local fixture." },
  sourceFacts: { sourceKind: "rss" }, samplingContext: { benchmarkSplit: split }, review: { sourceUrl, materialScope: "abstract" }, gold: { decision: null } });
const cases = [row(`research-a-${T}`, "Paper A", "https://arxiv.org/abs/2609.10001"), row(`engineering-a-${T}`, "Tool A", "https://example.org/tool"),
  row(`research-b-${T}`, "Paper B", "https://essd.copernicus.org/articles/test"), row(`engineering-b-${T}`, "Tool B", "https://example.org/platform")];
const batchId = `calibration-${T}`;
after(async () => { await stopBoss(); await closeDb(); });

test("the initial review balances sources and leaves holdout and missing evidence out", () => {
  const holdout = row(`holdout-${T}`, "Held out", "https://arxiv.org/abs/2609.10002", "holdout");
  const empty = { ...row(`empty-${T}`, "No evidence", "https://example.org/empty"), material: { ...cases[0]!.material, bodyOriginal: null } };
  const selected = chooseDevelopmentCases([...cases, holdout, empty], 4);
  assert.equal(selected.length, 4);
  assert.equal(selected.filter((r) => r.review.focus === "research").length, 2);
  assert.equal(selected.filter((r) => r.review.focus === "engineering").length, 2);
  assert.ok(selected.every((r) => r.samplingContext?.benchmarkSplit === "development" && r.gold.decision === null));
  assert.deepEqual(selected.map((r) => r.caseId), chooseDevelopmentCases([...cases, holdout, empty].reverse(), 4).map((r) => r.caseId));
});
test("human decisions survive reimport, reject stale changes and export only completed labels", async () => {
  await importCalibrationBatch({ id: batchId, label: "Local review", cases });
  assert.equal((await exportCalibrationLabels(batchId))!.count, 0);
  const first = await saveCalibrationLabel(batchId, cases[0]!.caseId, { decision: "select", notes: "valuable evidence", version: 0 }, "test-editor");
  assert.equal(first!.version, 1);
  assert.equal((await saveCalibrationLabel(batchId, cases[0]!.caseId, { decision: "select", notes: "valuable evidence", version: 0 }, "test-editor"))!.version, 1, "an identical retry is idempotent");
  await assert.rejects(saveCalibrationLabel(batchId, cases[0]!.caseId, { decision: "reject", notes: "stale", version: 0 }, "test-editor"), { code: "conflict" });
  await assert.rejects(saveCalibrationLabel(batchId, cases[1]!.caseId, { decision: "invented", notes: "", version: 0 }, "test-editor"), { statusCode: 400 });
  await importCalibrationBatch({ id: batchId, label: "Local review", cases });
  const saved = await calibrationBatch(batchId);
  assert.equal(saved!.summary.completed, 1);
  assert.equal(saved!.cases[0]!.notes, "valuable evidence");
  const exported = await exportCalibrationLabels(batchId);
  assert.equal(parseGoldRows(exported!.text).length, 1);
  assert.equal(parseGoldRows(exported!.text)[0]!.gold.decision, "select");
  await assert.rejects(importCalibrationBatch({ id: batchId, label: "Changed", cases: [{ ...cases[0], material: { ...cases[0]!.material, title: "Changed evidence" } }, ...cases.slice(1)] }), { code: "conflict" });
  await saveCalibrationLabel(batchId, cases[0]!.caseId, { decision: null, notes: "reconsider", version: 1 }, "test-editor");
  assert.equal((await calibrationBatch(batchId))!.summary.completed, 0);
});
test("review and export require admin login and writes require CSRF", async () => {
  const previous = config.devAdmin;
  config.devAdmin = null;
  const app = await buildApp();
  try {
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/calibration" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: `/api/admin/calibration/${batchId}/export` })).statusCode, 401);
    config.devAdmin = { displayName: "Local reviewer" };
    const payload = { decision: "reject", notes: "a local test only", version: 0 };
    const url = `/api/admin/calibration/${batchId}/cases/${cases[1]!.caseId}`;
    assert.equal((await app.inject({ method: "PATCH", url, payload })).statusCode, 403);
    const saved = await app.inject({ method: "PATCH", url, payload, headers: { "x-csrf-token": "dev" } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().decision, "reject");
    const exported = await app.inject({ method: "GET", url: `/api/admin/calibration/${batchId}/export` });
    assert.equal(exported.headers["cache-control"], "no-store");
    assert.equal(parseGoldRows(exported.body).length, 1);
    const publicItems = await app.inject({ method: "GET", url: "/api/v1/items" });
    assert.ok(!publicItems.body.includes("Private calibration test evidence"));
  } finally { config.devAdmin = previous; await app.close(); }
});
