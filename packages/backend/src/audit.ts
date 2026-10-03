// Manual changes: who, when, what, why. Shared by admin and recovery code.
import { sql, type Db } from "./db.ts";

export class Conflict extends Error {
  code = "conflict";
}

/** With `db`, the audit row commits with the caller's transaction. */
export async function audit(
  actor: string, action: string, subject: string | null, reason: string | null, before: unknown, after: unknown,
  opts: string | { requestId?: string; db?: Db } = {},
): Promise<void> {
  const options = typeof opts === "string" ? { requestId: opts } : opts;
  const db = options.db ?? sql;
  await db`INSERT INTO audit_log (actor, action, subject, reason, before, after, request_id)
           VALUES (${actor}, ${action}, ${subject}, ${reason}, ${before === null || before === undefined ? null : db.json(before as never)},
                   ${after === null || after === undefined ? null : db.json(after as never)}, ${options.requestId ?? null})`;
}
