// Only these reader-facing fields can cross from the anonymous HTTP API into a public static artifact.
import { z } from "zod";
import type { ItemSummary, ReportDetail } from "@aihot/contracts/site";

const Link = z.string().refine((value) => publicLink(value) === value, "Expected a public source URL");
const Item = z.object({ id:z.string(),title:z.string(),originalTitle:z.string().nullable(),summary:z.string().nullable(),
  reason:z.string().nullable(),source:z.object({name:z.string(),kind:z.string(),firstParty:z.boolean()}).strict(),
  originalUrl:Link.nullable(),publishedAt:z.string().nullable(),timelineAt:z.string(),category:z.string().nullable(),
  tags:z.array(z.string()),score:z.number().nullable(),selected:z.boolean() }).strict();
const Citation = z.object({itemId:z.string().nullable(),title:z.string(),summary:z.string().nullable(),sourceName:z.string(),
  originalUrl:Link.nullable()}).strict();
const Report = z.object({ kind:z.enum(["daily","weekly","monthly"]),key:z.string(),title:z.string(),generatedAt:z.string(),
  editorialMode:z.enum(["manual","model","imported"]).nullable(),lead:z.object({title:z.string(),leadParagraph:z.string()}).strict().nullable(),
  overview:z.string().nullable(),sections:z.array(z.object({label:z.string(),summary:z.string().nullable(),items:z.array(Citation)}).strict()) }).strict();
export const PublicPreviewSchema = z.object({ schemaVersion:z.literal(1),generatedAt:z.string().datetime(),
  categories:z.array(z.object({key:z.string(),label:z.string()}).strict()),
  sources:z.array(z.object({name:z.string(),kind:z.string()}).strict()),items:z.array(Item),reports:z.array(Report) }).strict();
export type PublicPreview = z.infer<typeof PublicPreviewSchema>;

export function publicLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:","http:"].includes(url.protocol) || url.username || url.password ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(url.hostname) ||
      /\.(local|internal)$/i.test(url.hostname) || [...url.searchParams.keys()].some((key)=>/token|key|secret|password|signature|credential|^sig$/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

export function publicItem(item: ItemSummary): PublicPreview["items"][number] {
  return { id:item.id,title:item.title,originalTitle:item.originalTitle,summary:item.summary,reason:item.reason,
    source:{name:item.source.name,kind:item.source.kind,firstParty:item.source.firstParty},originalUrl:publicLink(item.links.original),
    publishedAt:item.publishedAt,timelineAt:item.timelineAt,category:item.category,tags:item.tags,score:item.score,selected:item.selected };
}
export function publicReport(report: ReportDetail): PublicPreview["reports"][number] {
  return { kind:report.kind,key:report.key,title:report.title,generatedAt:report.generatedAt,editorialMode:report.editorialMode ?? null,
    lead:report.lead ? {title:report.lead.title,leadParagraph:report.lead.leadParagraph} : null,overview:report.overview,
    sections:report.sections.map((section)=>({label:section.label,summary:section.summary,
      items:section.items.filter((item)=>item.available).map((item)=>({itemId:item.itemId,title:item.title,summary:item.summary,
        sourceName:item.sourceName,originalUrl:publicLink(item.sourceUrl)}))})) };
}
