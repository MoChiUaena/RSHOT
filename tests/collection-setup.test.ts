import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { prepareCollectionPolicy } from "@aihot/backend/sources/prepare-collection";
import { DEFAULT_COLLECTION_LIMITS } from "@aihot/backend/sources/collection-policy";

const T = tag();
let originalPolicy: unknown = undefined;
let originalBudget: { per_minute: number; per_hour: number; per_day: number } | undefined;
after(async () => {
  if (originalPolicy !== undefined) {
    await sql`DELETE FROM settings WHERE key='collection.policy'`;
    if (originalPolicy !== null) await sql`INSERT INTO settings(key,value,updated_by)
      VALUES('collection.policy',${sql.json(originalPolicy as never)},'test-restore')`;
  }
  if (originalBudget) await sql`UPDATE budgets SET per_minute=${originalBudget.per_minute},
    per_hour=${originalBudget.per_hour},per_day=${originalBudget.per_day} WHERE service='llm'`;
  await closeDb();
});

test("production setup establishes bounded collection and preserves pauses and zero model budgets", async () => {
  const [saved] = await sql`SELECT value FROM settings WHERE key='collection.policy'`;
  originalPolicy = saved?.value ?? null;
  [originalBudget] = await sql<{ per_minute: number; per_hour: number; per_day: number }[]>`
    SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
  await sql`DELETE FROM settings WHERE key='collection.policy'`;
  await sql`INSERT INTO sources(id,name,kind,enabled,next_fetch_at) VALUES
    (${`setup-rss-${T}`},'Supported','rss',true,'2100-01-01'),
    (${`setup-external-${T}`},'Unsupported','external',true,'2100-01-01'),
    (${`setup-disabled-${T}`},'Disabled','rss',false,'2100-01-01')`;
  await sql`UPDATE budgets SET per_minute=1,per_hour=0,per_day=5 WHERE service='llm'`;
  const prepared = await prepareCollectionPolicy("test:setup");
  assert.equal(prepared.enabled,true);
  assert.equal(prepared.perDay,DEFAULT_COLLECTION_LIMITS.perDay);
  assert.ok(prepared.sourceIds.includes(`setup-rss-${T}`));
  assert.ok(!prepared.sourceIds.includes(`setup-external-${T}`));
  assert.ok(!prepared.sourceIds.includes(`setup-disabled-${T}`));
  assert.deepEqual(await prepareCollectionPolicy("test:rerun"),prepared,"updates preserve the original window and allowlist");
  const paused = { ...prepared, enabled:false, perDay:2 };
  await sql`UPDATE settings SET value=${sql.json(paused)} WHERE key='collection.policy'`;
  assert.deepEqual(await prepareCollectionPolicy("test:paused"),paused);
  const [budget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
  assert.deepEqual(budget,{per_minute:1,per_hour:0,per_day:5});
  await sql`UPDATE settings SET value=${sql.json({enabled:false})} WHERE key='collection.policy'`;
  await assert.rejects(prepareCollectionPolicy("test:invalid"),"invalid policy does not silently reset to defaults");
});
