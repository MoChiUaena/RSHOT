// Human labels are stored separately from publication and never trigger a provider request.
import { z } from "zod";
import type { CalibrationBatch, CalibrationBatchSummary, CalibrationCase, CalibrationDecision, CalibrationFocus } from "@aihot/contracts/calibration";
import { GoldRowSchema } from "../editorial/gold.ts";
import { sql } from "../db.ts";
import { sha256, stableJson } from "../lib/ids.ts";

export const PendingCalibrationSchema = GoldRowSchema.extend({
  gold: z.object({ decision: z.null() }),
  review: z.object({
    sourceUrl: z.string().url().refine((s) => new URL(s).protocol === "https:"),
    materialScope: z.enum(["abstract", "article-text", "feed-content", "feed-summary", "listing-title"]),
    focus: z.enum(["research", "engineering"]).optional(),
    titleZh: z.string().max(500).nullable().optional(),
    guideZh: z.string().max(5000).nullable().optional(),
  }),
});
export type PendingCalibration = z.infer<typeof PendingCalibrationSchema>;

export function focusOf(row: PendingCalibration): CalibrationFocus {
  const host = new URL(row.review.sourceUrl).hostname;
  return host === "arxiv.org" || host === "essd.copernicus.org"
    || (host === "aircas.cas.cn" && /研究团队|估算方法|发表|数据集/.test(row.material.title)) ? "research" : "engineering";
}

/** A fixed development batch: balance research and engineering, rotate sources, leave holdout alone. */
export function chooseDevelopmentCases(rows: PendingCalibration[], count = 20): PendingCalibration[] {
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error("样本数量必须为1–200");
  if (new Set(rows.map((r) => r.caseId)).size !== rows.length) throw new Error("样本编号重复");
  const pool = rows.filter((r) => r.samplingContext?.benchmarkSplit === "development" && (r.material.bodyOriginal?.trim() || r.material.bodyZh?.trim()));
  const rotate = (focus: CalibrationFocus) => {
    const groups = new Map<string, PendingCalibration[]>();
    const sorted = pool.filter((r) => focusOf(r) === focus).sort((a, b) =>
      (b.material.publishedAt ?? "").localeCompare(a.material.publishedAt ?? "") || a.caseId.localeCompare(b.caseId));
    for (const row of sorted) {
      const name = row.material.sourceName;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(row);
    }
    const result: PendingCalibration[] = [];
    const names = [...groups.keys()].sort();
    while (names.some((name) => groups.get(name)!.length)) {
      for (const name of names) { const row = groups.get(name)!.shift(); if (row) result.push(row); }
    }
    return result;
  };
  const research = rotate("research"), engineering = rotate("engineering");
  const a = research.splice(0, Math.ceil(count / 2)), b = engineering.splice(0, Math.floor(count / 2));
  const chosen = [...a, ...b, ...research, ...engineering].slice(0, count);
  // Interleave the two kinds while retaining deterministic source order.
  const ordered: PendingCalibration[] = [];
  const r = chosen.filter((row) => focusOf(row) === "research"), e = chosen.filter((row) => focusOf(row) === "engineering");
  while (r.length || e.length) { if (r.length) ordered.push(r.shift()!); if (e.length) ordered.push(e.shift()!); }
  return ordered.map((row) => ({ ...row, review: { ...row.review, focus: focusOf(row) } }));
}

const BatchSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), label: z.string().min(1).max(200), cases: z.array(PendingCalibrationSchema).min(1).max(200) });
export async function importCalibrationBatch(input: unknown): Promise<{ id: string; total: number }> {
  const parsed = BatchSchema.safeParse(input);
  if (!parsed.success) throw Object.assign(new Error("待标注批次格式无效"), { statusCode: 400 });
  const batch = { ...parsed.data, cases: parsed.data.cases.map((row) => ({ ...row, review: { ...row.review, focus: row.review.focus ?? focusOf(row) } })) };
  if (new Set(batch.cases.map((r) => r.caseId)).size !== batch.cases.length) throw new Error("样本编号重复");
  const fingerprint = sha256(stableJson(batch.cases));
  await sql.begin(async (tx) => {
    await tx`INSERT INTO calibration_batches (id,label,input_hash) VALUES (${batch.id},${batch.label},${fingerprint}) ON CONFLICT DO NOTHING`;
    const [before] = await tx`SELECT input_hash FROM calibration_batches WHERE id=${batch.id} FOR UPDATE`;
    if (before!.input_hash !== fingerprint) throw Object.assign(new Error("批次材料已变化，请使用新批次编号，保留原有人工标注"), { code: "conflict" });
    for (const [position, row] of batch.cases.entries()) {
      await tx`INSERT INTO calibration_cases (batch_id,case_id,position,input) VALUES (${batch.id},${row.caseId},${position},${tx.json(row as never)}) ON CONFLICT DO NOTHING`;
    }
  });
  return { id: batch.id, total: batch.cases.length };
}

export async function listCalibrationBatches(): Promise<CalibrationBatchSummary[]> {
  return sql<CalibrationBatchSummary[]>`SELECT b.id,b.label,count(c.case_id)::int AS total,count(c.decision)::int AS completed,
    count(*) FILTER (WHERE c.input->'review'->>'focus'='research')::int AS research,
    count(*) FILTER (WHERE c.input->'review'->>'focus'='engineering')::int AS engineering,b.created_at::text AS "createdAt"
    FROM calibration_batches b JOIN calibration_cases c ON c.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC,b.id`;
}
interface StoredCase { case_id: string; position: number; input: PendingCalibration; decision: CalibrationDecision | null; notes: string; version: number; labelled_at: Date | null }
function displayCase(row: StoredCase): CalibrationCase {
  const { material: m, review } = row.input;
  return { caseId: row.case_id, position: row.position, focus: review.focus ?? focusOf(row.input), title: m.title, titleZh: review.titleZh ?? null,
    guideZh: review.guideZh ?? null, sourceName: m.sourceName, sourceUrl: review.sourceUrl, publishedAt: m.publishedAt,
    materialScope: review.materialScope, bodyOriginal: m.bodyOriginal, bodyZh: m.bodyZh, decision: row.decision, notes: row.notes, version: row.version, labelledAt: row.labelled_at?.toISOString() ?? null };
}
export async function calibrationBatch(id: string): Promise<CalibrationBatch | null> {
  const summary = (await listCalibrationBatches()).find((b) => b.id === id);
  if (!summary) return null;
  const rows = await sql<StoredCase[]>`SELECT case_id,position,input,decision,notes,version,labelled_at FROM calibration_cases WHERE batch_id=${id} ORDER BY position`;
  return { summary, cases: rows.map(displayCase) };
}
export async function saveCalibrationLabel(batchId: string, caseId: string, input: unknown, actor: string): Promise<CalibrationCase | null> {
  const parsed = z.object({ decision: z.enum(["select", "reject", "either"]).nullable(), notes: z.string().max(2000), version: z.number().int().min(0) }).strict().safeParse(input);
  if (!parsed.success) throw Object.assign(new Error("请选择有效判断，备注最多2000字"), { statusCode: 400 });
  const next = parsed.data;
  return sql.begin(async (tx) => {
    const [before] = await tx<StoredCase[]>`SELECT case_id,position,input,decision,notes,version,labelled_at FROM calibration_cases WHERE batch_id=${batchId} AND case_id=${caseId} FOR UPDATE`;
    if (!before) return null;
    if (before.decision === next.decision && before.notes === next.notes) return displayCase(before);
    if (before.version !== next.version) throw Object.assign(new Error("这条标注已在其他页面更新，请刷新后重试"), { code: "conflict" });
    const [after] = await tx<StoredCase[]>`UPDATE calibration_cases SET decision=${next.decision},notes=${next.notes},version=version+1,
      labelled_at=${next.decision === null ? null : new Date()},labelled_by=${actor} WHERE batch_id=${batchId} AND case_id=${caseId}
      RETURNING case_id,position,input,decision,notes,version,labelled_at`;
    await tx`INSERT INTO audit_log (actor,action,subject,reason,before,after) VALUES (${actor},'calibration.label',${`calibration:${batchId}:${caseId}`},'人工核验精选偏好',
      ${tx.json({ decision: before.decision, notes: before.notes, version: before.version })},${tx.json({ decision: next.decision, notes: next.notes, version: after!.version })})`;
    return displayCase(after!);
  }) as Promise<CalibrationCase | null>;
}
export async function exportCalibrationLabels(id: string): Promise<{ count: number; text: string } | null> {
  const batch = await calibrationBatch(id);
  if (!batch) return null;
  const rows = await sql<StoredCase[]>`SELECT input,decision,notes,labelled_at FROM calibration_cases WHERE batch_id=${id} AND decision IS NOT NULL ORDER BY position`;
  return { count: rows.length, text: rows.map((row) => JSON.stringify({ ...row.input, gold: { decision: row.decision }, annotation: { notes: row.notes, labelledAt: row.labelled_at?.toISOString() } })).join("\n") + (rows.length ? "\n" : "") };
}
