// Used by both local startup and production setup; existing policies and tighter budgets survive updates.
import { sql } from "../db.ts";
import { CollectionPolicySchema, DEFAULT_COLLECTION_LIMITS, DEFAULT_UPDATE_MODEL_LIMITS } from "./collection-policy.ts";

export async function prepareCollectionPolicy(updatedBy: string) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('rshot.collection.admission'))`;
    const [existing] = await tx`SELECT value FROM settings WHERE key='collection.policy'`;
    let policy;
    if (existing) policy = CollectionPolicySchema.parse(existing.value);
    else {
      const sourceIds = (await tx`SELECT id FROM sources WHERE enabled AND participation_mode='editorial'
        AND kind IN('rss','web_list','json_list') ORDER BY id`).map((row) => row.id as string);
      policy = CollectionPolicySchema.parse({ enabled: true, ...DEFAULT_COLLECTION_LIMITS, sourceIds,
        since: new Date(Date.now() - DEFAULT_COLLECTION_LIMITS.maxAgeHours * 3600000).toISOString() });
      await tx`INSERT INTO settings(key,value,updated_by) VALUES('collection.policy',${tx.json(policy)},${updatedBy})`;
    }
    const limits = DEFAULT_UPDATE_MODEL_LIMITS;
    await tx`INSERT INTO budgets(service,per_minute,per_hour,per_day,note)
      VALUES('llm',${limits.perMinute},${limits.perHour},${limits.perDay},'RSHOT 自动更新')
      ON CONFLICT(service) DO UPDATE SET per_minute=LEAST(budgets.per_minute,EXCLUDED.per_minute),
        per_hour=LEAST(budgets.per_hour,EXCLUDED.per_hour),per_day=LEAST(budgets.per_day,EXCLUDED.per_day)`;
    return policy;
  });
}
