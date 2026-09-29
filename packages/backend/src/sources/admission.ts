// Optional collection policy. A shared transaction lock makes quotas hold across concurrent sources.
import { sql } from "../db.ts";
import { identityKeyFor, upsertMaterial } from "../content/materials.ts";
import { queueProcessing } from "../jobs/content.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { collapseWhitespace } from "../lib/text.ts";
import type { Candidate, SourceRow } from "./types.ts";
import { CollectionPolicySchema, type CollectionPolicy } from "./collection-policy.ts";
export async function collectionPolicy(): Promise<CollectionPolicy | null> {
  const [row] = await sql`SELECT value FROM settings WHERE key='collection.policy'`;
  if (!row) return null;
  const policy = CollectionPolicySchema.parse(row.value);
  return policy;
}
export function withinCollectionWindow(candidate: Candidate, policy: CollectionPolicy, now = Date.now()): boolean {
  const time = Math.max(candidate.publishedAt?.getTime() ?? 0, candidate.sourceUpdatedAt?.getTime() ?? 0);
  return time > 0 && time >= Math.max(Date.parse(policy.since), now - policy.maxAgeHours * 3600000) && time <= now + 3600000;
}
export interface AdmissionSummary { created: number; revised: number; baseline: number; unchanged: number; outsideWindow: number; limited: number }
export async function storeControlled(source: SourceRow, candidates: Candidate[], policy: CollectionPolicy): Promise<AdmissionSummary> {
  const result: AdmissionSummary = { created: 0, revised: 0, baseline: 0, unchanged: 0, outsideWindow: 0, limited: 0 };
  if (!policy.enabled || !policy.sourceIds.includes(source.id)) return { ...result, limited: candidates.length };
  let admitted = 0;
  for (const candidate of candidates) {
    const verdict = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('rshot.collection.admission'))`;
      const proposed = identityKeyFor({ ...candidate, sourceId: source.id, via: "fetch" });
      const [existing] = await tx`SELECT id,identity_key FROM articles WHERE identity_key=${proposed} OR url=${candidate.url} LIMIT 1`;
      const identity = existing?.identity_key ?? proposed;
      const fingerprint = sha256(stableJson({ title: collapseWhitespace(candidate.title), body: collapseWhitespace(candidate.bodyText ?? ""),
        excerpt: collapseWhitespace(candidate.excerpt ?? "") }));
      const [observation] = await tx`SELECT fingerprint FROM collection_observations WHERE source_id=${source.id} AND identity_key=${identity}`;
      const observe = () => tx`INSERT INTO collection_observations(source_id,identity_key,fingerprint) VALUES(${source.id},${identity},${fingerprint})
        ON CONFLICT(source_id,identity_key) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,observed_at=now()`;
      // Filling an imported article's missing body is a baseline, not a reason to buy its analysis again.
      if (existing && !observation) { await observe(); return "baseline" as const; }
      if (observation?.fingerprint === fingerprint) return "unchanged" as const;
      if (!withinCollectionWindow(candidate, policy)) return "outsideWindow" as const;
      const [counts] = await tx`SELECT count(*) FILTER(WHERE admitted_at>now()-interval '1 hour')::int AS hour,count(*)::int AS day,
        count(*) FILTER(WHERE source_id=${source.id})::int AS source_day FROM collection_admissions WHERE admitted_at>now()-interval '1 day'`;
      if (admitted >= policy.perRun || counts!.hour >= policy.perHour || counts!.day >= policy.perDay || counts!.source_day >= policy.perSourceDay) return "limited" as const;
      const body = candidate.bodyText ?? candidate.excerpt ?? "";
      const scope = source.config.summaryIsBody === true || source.config.detail?.summaryIsBody === true ? "abstract" : candidate.bodyText ? "feed-content" : "feed-summary";
      const material = await upsertMaterial({ ...candidate, identityKey: identity, sourceId: source.id, via: "fetch", backfill: null,
        raw: { ...(candidate.raw && typeof candidate.raw === "object" ? candidate.raw : {}), rshot: { mode: "controlled-collection", materialScope: scope, scopeBodyHash: sha256(collapseWhitespace(body)) } } }, tx);
      await observe();
      if (!material.created && !material.revised) return "unchanged" as const;
      const [article] = await tx`SELECT revision FROM articles WHERE id=${material.articleId}`;
      await tx`INSERT INTO collection_admissions(source_id,article_id,input_revision) VALUES(${source.id},${material.articleId},${article!.revision}) ON CONFLICT DO NOTHING`;
      await queueProcessing(material.articleId, { db: tx });
      return material.created ? "created" as const : "revised" as const;
    });
    result[verdict] += 1;
    if (verdict === "created" || verdict === "revised") admitted += 1;
  }
  return result;
}
