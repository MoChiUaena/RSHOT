import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, config } from "@aihot/backend/config";
import { validateCuratedBundle, importCuratedBundle } from "@aihot/backend/editorial/curation";
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";

const fileAt = process.argv.indexOf("--file");
const file = fileAt >= 0 ? path.resolve(process.argv[fileAt + 1]!) : path.join(REPO_ROOT, "industry/curation/2026-09-29.json");
const bundle = validateCuratedBundle(JSON.parse(readFileSync(file, "utf8")));
try {
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ edition: bundle.id, items: bundle.items.length, selected: bundle.items.filter((i) => i.selected).length, action: "validated; add --apply to import" }));
  } else {
    if (config.modelCallsEnabled || process.env.COLLECT_ENABLED !== "false") throw new Error("导入编辑包前请关闭 MODEL_CALLS_ENABLED 和 COLLECT_ENABLED");
    console.log(JSON.stringify(await importCuratedBundle(bundle)));
  }
} finally { await stopBoss(); await closeDb(); }
