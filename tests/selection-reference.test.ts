import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { importSelectBenchRun, listSelectBenchRuns, selectBenchRun } from "@aihot/backend/admin/selectbench";
after(closeDb);
test("private comparison reports retain their reference type in list and detail views", async () => {
  const cases = [{ caseId: `preference-${tag()}`, title: "Local source fixture", gold: "reject", decision: "select", score: 65 }];
  const run = await importSelectBenchRun({ meta: { referenceKind: "preference", n: 1 }, models: { local: { summary: { accuracy: 0 }, cases } } }, "Personal preference fixture", "test-editor");
  assert.equal((await listSelectBenchRuns()).find((r) => r.id === run.id)!.reference_kind, "preference");
  assert.equal((await selectBenchRun(run.id, {}))!.run.reference_kind, "preference");
  const legacy = await importSelectBenchRun({ models: { local: { summary: { accuracy: 1 }, cases: [] } } }, "Legacy fixture", "test-editor");
  assert.equal((await selectBenchRun(legacy.id, {}))!.run.reference_kind, "gold");
});
