import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { exportCalibrationLabels, listCalibrationBatches } from "@aihot/backend/admin/calibration";
const { values } = parseArgs({ options: { batch: { type: "string" } } });
try {
  const id = values.batch || (await listCalibrationBatches())[0]?.id;
  if (!id) throw new Error("还没有标注批次");
  const result = await exportCalibrationLabels(id);
  if (!result?.count) throw new Error("还没有保存人工判断，请先在标注页面完成样本");
  const file = path.join(REPO_ROOT, ".data/calibration", `gold-${id}.jsonl`);
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, result.text);
  console.log(JSON.stringify({ labelled: result.count, output: file, requestsSent: 0 }));
} finally { await closeDb(); }
