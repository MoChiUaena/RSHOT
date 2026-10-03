import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { getBoss, enqueue, QUEUES, retryReleasedReceiptJobs, stopBoss } from "@aihot/backend/jobs/queue";
import { closeDb, sql } from "@aihot/backend/db";
import { audit } from "@aihot/backend/audit";
import { releaseUnknownReceipt } from "@aihot/backend/providers/receipts";

after(async () => { await stopBoss(); await closeDb(); });

test("a failed first database connection does not poison all later queue requests", async () => {
  const original = config.databaseUrl;
  const missing = new URL(original);
  missing.pathname = "/aihot_missing_queue_recovery_test";
  config.databaseUrl = missing.toString();
  try {
    await assert.rejects(getBoss(), /does not exist/);
  } finally {
    config.databaseUrl = original;
  }
  const boss = await getBoss();
  const id = await enqueue(QUEUES.analyze, { articleId: "recovered" });
  assert.ok(id);
  assert.equal((await boss.getJobById<{ articleId: string }>(QUEUES.analyze, id))?.data.articleId, "recovered");
});

async function unknownReceipt() {
  const key = `release-clock-${tag()}`;
  const [receipt] = await sql<{ id: number }[]>`
    INSERT INTO receipts (logical_key, service, purpose, subject, status, attempts)
    VALUES (${key}, 'invariant-release-clock', 'invariant_test', ${key}, 'unknown', 1) RETURNING id`;
  await sql`INSERT INTO receipt_attempts (receipt_id, attempt, service, status)
            VALUES (${receipt!.id}, 1, 'invariant-release-clock', 'unknown')`;
  return { id: receipt!.id, subject: key, purpose: "invariant_test" };
}

test("a release written after job start recovers it even when its transaction began earlier", async () => {
  const receipt = await unknownReceipt();
  const subject = `receipt:${receipt.id}`;
  const payload = { articleId: `clock-${tag()}`, attemptTag: "manual", nested: { preserve: true } };
  const jobId = await enqueue(QUEUES.analyze, payload, { singletonKey: payload.articleId });
  assert.ok(jobId);
  await sql.begin(async (tx) => {
    const [clock] = await tx<{ began: Date }[]>`SELECT now() AS began`;
    // Database-side spacing avoids timestamp precision ambiguity; no worker/provider runs.
    await tx`SELECT pg_sleep(0.05)`;
    const [job] = await sql<{ began_after_tx: boolean }[]>`
      UPDATE pgboss.job SET state = 'failed', started_on = clock_timestamp(), completed_on = clock_timestamp(),
        output = ${sql.json({ receiptId: receipt.id })}
      WHERE id = ${jobId} AND name = ${QUEUES.analyze} RETURNING started_on > ${clock!.began} AS began_after_tx`;
    assert.equal(job!.began_after_tx, true, "job starts after the release transaction begins");
    await tx`SELECT pg_sleep(0.05)`;
    const released = await releaseUnknownReceipt(tx, receipt.id, "released after job start");
    assert.deepEqual(released, { subject: receipt.subject, purpose: receipt.purpose });
    await audit("test:release-clock", "receipt.release", subject, null, { status: "unknown" }, { status: "failed" }, { db: tx });
  });
  assert.equal(await retryReleasedReceiptJobs(), 1, "a later release must recover the failed job");
  const [event] = await sql<{ after_start: boolean }[]>`
    SELECT a.created_at > j.started_on AS after_start FROM audit_log a CROSS JOIN pgboss.job j
    WHERE a.subject = ${subject} AND a.action = 'receipt.release' AND j.id = ${jobId} AND j.name = ${QUEUES.analyze}`;
  assert.equal(event!.after_start, true, "audit records event time, not transaction start");
  const job = await (await getBoss()).getJobById<typeof payload>(QUEUES.analyze, jobId);
  assert.equal(job?.state, "retry");
  assert.deepEqual(job?.data, payload);
  assert.equal(await retryReleasedReceiptJobs(), 0, "a recovered job is not retried twice");
});

test("receipt release and its audit roll back together in the supplied transaction", async () => {
  const receipt = await unknownReceipt();
  const subject = `receipt:${receipt.id}`;
  const rollback = new Error("rollback release and audit");
  await assert.rejects(sql.begin(async (tx) => {
    assert.deepEqual(await releaseUnknownReceipt(tx, receipt.id, "will roll back"), { subject: receipt.subject, purpose: receipt.purpose });
    await audit("test:release-rollback", "receipt.release", subject, null, { status: "unknown" }, { status: "failed" }, { db: tx });
    const [inside] = await tx<{ status: string; attempts: string; audits: number }[]>`
      SELECT r.status, ra.status AS attempts,
        (SELECT count(*)::int FROM audit_log WHERE subject = ${subject}) AS audits
      FROM receipts r JOIN receipt_attempts ra ON ra.receipt_id = r.id WHERE r.id = ${receipt.id}`;
    assert.deepEqual(inside, { status: "failed", attempts: "failed", audits: 1 });
    throw rollback;
  }), (error) => error === rollback);
  const [outside] = await sql<{ status: string; attempts: string; audits: number }[]>`
    SELECT r.status, ra.status AS attempts,
      (SELECT count(*)::int FROM audit_log WHERE subject = ${subject}) AS audits
    FROM receipts r JOIN receipt_attempts ra ON ra.receipt_id = r.id WHERE r.id = ${receipt.id}`;
  assert.deepEqual(outside, { status: "unknown", attempts: "unknown", audits: 0 });
});
