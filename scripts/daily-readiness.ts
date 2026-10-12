// Read-only check for an intentionally empty daily issue. No model credentials or calls.
import { beijingMidnight } from "@aihot/contracts/time";
import { sql, closeDb } from "@aihot/backend/db";
import { candidates } from "@aihot/backend/reports/compose";

const day = process.argv[2];
if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("expected Beijing report date");
const end = new Date(beijingMidnight(day).getTime() + 8 * 3600_000);
const start = new Date(end.getTime() - 86400_000);
try {
  const [heartbeat] = await sql<{ active: boolean }[]>`
    SELECT (value->>'at')::timestamptz > now() - interval '2 minutes' AS active
    FROM settings WHERE key = 'heartbeat.worker'`;
  const [pending] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM articles
    WHERE discovered_at >= ${start} AND discovered_at < ${end}
      AND processing_state NOT IN ('analyzed', 'blocked', 'skipped')`;
  const selectedCandidates = (await candidates(start, end)).length;
  console.log(JSON.stringify({ day, workerActive: heartbeat?.active ?? false,
    selectedCandidates, pendingArticles: pending?.n ?? 0, modelRequests: 0 }));
} finally { await closeDb(); }
