// Read-only status, no credential values or model calls.
import { sql, closeDb } from "@aihot/backend/db";
import { CollectionPolicySchema } from "@aihot/backend/sources/collection-policy";
try {
  const [policyRow] = await sql`SELECT value FROM settings WHERE key='collection.policy'`;
  const policy = policyRow ? CollectionPolicySchema.parse(policyRow.value) : null;
  const [heartbeat] = await sql`SELECT value->>'at' AS at,(value->>'at')::timestamptz>now()-interval '2 minutes' AS active FROM settings WHERE key='heartbeat.worker'`;
  const [counts] = await sql`SELECT count(*) FILTER(WHERE admitted_at>now()-interval '1 hour')::int AS hour,count(*)::int AS day FROM collection_admissions WHERE admitted_at>now()-interval '1 day'`;
  const sources = await sql`SELECT id,health,last_fetch_at,last_ok_at,fail_count FROM sources WHERE enabled AND participation_mode='editorial' ORDER BY id`;
  const [budget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
  console.log(JSON.stringify({ worker: { active: heartbeat?.active ?? false, lastHeartbeat: heartbeat?.at ?? null }, policy, admitted: counts, modelRequestLimits: budget, sources }, null, 2));
} finally { await closeDb(); }
