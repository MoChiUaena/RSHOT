import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { chatJson, completionParameters, MODELS } from "@aihot/backend/providers/llm";
import { sql, closeDb } from "@aihot/backend/db";
import { logicalKeyFor } from "@aihot/backend/providers/receipts";
import { sha256 } from "@aihot/backend/lib/ids";
test("GPT-6 Sol uses the current completion limit and retains explicit reasoning choices", () => {
  assert.deepEqual(completionParameters("gpt-6-sol", 512, 0), { max_completion_tokens: 512, reasoning_effort: "none", temperature: 0 });
  assert.deepEqual(completionParameters("gpt-6-sol", 1024, 1, { reasoning_effort: "low" }), { max_completion_tokens: 1024, reasoning_effort: "low" });
  assert.deepEqual(completionParameters("deepseek-flash", 512, 0.2, { thinking: { type: "disabled" } }), { temperature: 0.2, max_tokens: 512, thinking: { type: "disabled" } });
});
test("legacy provider keys reuse earlier receipts and retain custom response formats", async () => {
  const extra = { response_format: { type: "json_schema", json_schema: { name: "probe", schema: { type: "object", properties: { ok: { type: "boolean" } } } } } };
  let format: unknown;
  const provider = await stub((_hit, request) => {
    format = JSON.parse(request.body).response_format;
    return { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  });
  process.env.LLM_BASE_URL = `${provider.url}/v1`;
  process.env.LLM_API_KEY = "test-key";
  MODELS["test-legacy"] = { key: "test-legacy", service: "llm", model: "local-legacy", baseUrlEnv: "LLM_BASE_URL", apiKeyEnv: "LLM_API_KEY", extra, jsonMode: true };
  try {
    const user = `legacy input ${tag()}`;
    const expectedKey = logicalKeyFor({ service: "llm", purpose: "parameter_compatibility", model: "local-legacy",
      identity: { model: "local-legacy", promptVersion: "legacy-v1", system: sha256("Return JSON"), user: sha256(user), temperature: 0.2, maxTokens: 512, extra } });
    const previous = await sql`INSERT INTO receipts (logical_key,service,model,purpose,subject,status,response,usage)
      VALUES (${expectedKey},'llm','local-legacy','parameter_compatibility','legacy-fixture','received',${sql.json({ choices: [{ message: { content: '{"ok":true}' } }] })},${sql.json({ prompt_tokens: 1, completion_tokens: 1 })}) RETURNING id`;
    const options = { model: "test-legacy", purpose: "parameter_compatibility", subject: "legacy-fixture", promptVersion: "legacy-v1", system: "Return JSON", user, schema: z.object({ ok: z.boolean() }), maxTokens: 512 };
    const reused = await chatJson(options);
    assert.equal(reused.receiptId, Number(previous[0]!.id));
    assert.equal(reused.reused, true);
    assert.equal(provider.hits(), 0, "an older received answer is not bought again");
    await chatJson({ ...options, user: `${user} fresh` });
    assert.deepEqual(format, extra.response_format);
    assert.equal(provider.hits(), 1);
  } finally {
    delete MODELS["test-legacy"];
    await provider.close();
    await closeDb();
  }
});
