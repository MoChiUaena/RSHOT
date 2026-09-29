// Validate human decisions before any paid evaluation can start.
import { z } from "zod";
export const GoldRowSchema = z.object({
  caseId: z.string().min(1),
  material: z.object({ title: z.string().min(1), originalTitle: z.string().nullable().optional().default(null), publishedAt: z.string().nullable().optional().default(null),
    sourceName: z.string().min(1), bodyZh: z.string().nullable().optional().default(null), bodyOriginal: z.string().nullable().optional().default(null) }),
  sourceFacts: z.object({ sourceKind: z.string().min(1), sourceTier: z.string().optional(), firstParty: z.boolean().optional(), language: z.string().nullable().optional() }),
  samplingContext: z.object({ benchmarkSplit: z.string().optional(), samplingStratum: z.string().optional() }).optional(),
  gold: z.object({ decision: z.enum(["select", "reject", "either"]) }),
});
export type GoldRow = z.infer<typeof GoldRowSchema>;
export function parseGoldRows(text: string): GoldRow[] {
  const lines = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//"));
  const rows = lines.map((line, index) => {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error(`标注文件第${index + 1}条不是合法JSON`); }
    const parsed = GoldRowSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`标注文件第${index + 1}条未完成或格式不正确；先填写 gold.decision，再调用模型评测`);
    return parsed.data;
  });
  if (!rows.length) throw new Error("标注文件为空");
  if (new Set(rows.map((r) => r.caseId)).size !== rows.length) throw new Error("标注编号重复");
  return rows;
}
