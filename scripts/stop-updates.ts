import { sql, closeDb } from "@aihot/backend/db";
try {
  await sql`INSERT INTO settings(key,value,updated_by) VALUES('worker.stop-request',${sql.json({at:new Date().toISOString()})},'local:update-stop')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(),updated_by=EXCLUDED.updated_by`;
  console.log("已请求 worker 完成当前请求后停止；网页和数据库继续运行");
} finally { await closeDb(); }
