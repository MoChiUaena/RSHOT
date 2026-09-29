// Only --live sends one short request; errors never print provider bodies or secret values.
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readLocalModel, projectRoot } from "./lib/local-model.ts";
const model = readLocalModel();
const record = (passed: boolean, httpStatus: number | null) => {
  const dir = path.join(projectRoot, ".data/pilot"); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "connection-status.json"), JSON.stringify({ checkedAt: new Date().toISOString(), passed, httpStatus, keyPrinted: false }));
};
if (!model.ready || !process.argv.includes("--live")) {
  console.log(JSON.stringify({ status: model.ready ? "configured" : "needs_configuration", file: model.file, missing: model.missing, problems: model.problems, requestsSent: 0 }));
  process.exitCode = model.ready ? 0 : 1;
} else {
  process.env.MODEL_CALLS_ENABLED = "true";
  Object.assign(process.env, model.env);
  const { sql, closeDb } = await import("@aihot/backend/db");
  try {
    // Never loosen an existing lower limit; a deliberate zero remains a stop.
    await sql`INSERT INTO budgets (service,per_minute,per_hour,per_day,note) VALUES ('llm',20,60,200,'RSHOT 初始小批量试运行')
      ON CONFLICT (service) DO UPDATE SET per_minute=LEAST(budgets.per_minute,20),per_hour=LEAST(budgets.per_hour,60),per_day=LEAST(budgets.per_day,200)`;
    const { chatJson } = await import("@aihot/backend/providers/llm");
    const { completeReceipt } = await import("@aihot/backend/providers/receipts");
    const started = Date.now();
    const result = await chatJson({ model: "default", purpose: "rshot.connection-probe", subject: `connection-probe:${Date.now()}`, promptVersion: "probe-v1",
      attemptTag: randomUUID(),
      system: 'Return only JSON: {"ok":true}.', user: "Check structured JSON output.", schema: z.object({ ok: z.literal(true) }), temperature: 0, maxTokens: 128, timeoutMs: 45_000 });
    await completeReceipt(sql, result.receiptId);
    const usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter((key) => typeof result.usage?.[key] === "number").map((key) => [key, result.usage![key]]));
    record(true, 200);
    console.log(JSON.stringify({ status: "passed", requestsSent: 1, elapsedMs: Date.now() - started, usage, matchedValuesPrinted: false }));
  } catch (error) {
    record(false, (error as { status?: number }).status ?? null);
    console.error(JSON.stringify({ status: "failed", errorType: error instanceof Error ? error.name : "unknown", httpStatus: (error as { status?: number }).status ?? null, providerBodyPrinted: false }));
    process.exitCode = 1;
  } finally { await closeDb(); }
}
