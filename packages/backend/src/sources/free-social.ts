// Local read-only adapters normalize public material before controlled admission. No DB on import.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import catalog from "../../../../industry/social-sources.json" with { type: "json" };
import { sanitizeBody } from "../content/sanitize.ts";
import { collapseWhitespace, stripTags } from "../lib/text.ts";
import type { Candidate, SourceRow } from "./types.ts";
import type { AdmissionSummary } from "./admission.ts";
import { DEFAULT_COLLECTION_LIMITS } from "./collection-policy.ts";

export interface FreeSocialSource {
  id: string; name: string; platform: "x" | "wechat";
  handle?: string; aliases: string[]; tier: "T1_5" | "T2";
  ownerEntityId: string | null;
}

// Bounds are rejection limits: useful method/tool text is retained whole, never silently cut.
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 100;
const MAX_BODY = 100000;
const MAX_HTML = MAX_INPUT_BYTES;
const MAX_AGE = 48 * 3600000;
const FUTURE_TOLERANCE = 3600000;
const SECRET_PARAM = /(?:token|auth|ticket|cookie|session|password|passwd|secret|credential|signature|api[_-]?key|^key$|^ct0$|^code$)/i;
const SECRET_TEXT = /\b(?:authorization\s*:\s*bearer|cookie\s*:|auth_token\s*=|access_token\s*=|ct0\s*=)/i;
const LANGUAGE = /^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/;

export function approvedSocialSources(): FreeSocialSource[] {
  return catalog.sources.map(s => ({ ...s, aliases: [...s.aliases] })) as FreeSocialSource[];
}

function approved(source: FreeSocialSource, platform: FreeSocialSource["platform"]): FreeSocialSource {
  const match = approvedSocialSources().find(s => s.id === source.id);
  if (!match || match.platform !== platform || source.platform !== platform || source.handle !== match.handle ||
      source.name !== match.name || JSON.stringify(source.aliases) !== JSON.stringify(match.aliases)) throw new Error("unapproved social source");
  return match;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function xmlText(value: unknown): string {
  if (typeof value === "string") return value;
  const r = record(value);
  return r ? string(r["#text"]) : "";
}
function array(value: unknown): unknown[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function boundedJson(input: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(input); } catch { throw new Error("invalid social input"); }
  if (json === undefined) throw new Error("invalid social input");
  if (Buffer.byteLength(json, "utf8") > MAX_INPUT_BYTES) throw new Error("social input limit");
}
function date(value: unknown, now: Date): Date | null {
  if (typeof value !== "string" || !value.trim() || value.length > 100) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && Number.isFinite(now.getTime()) && time >= now.getTime() - MAX_AGE && time <= now.getTime() + FUTURE_TOLERANCE ? new Date(time) : null;
}
function useful(body: string, min: number): boolean {
  return body.length >= min && body.length <= MAX_BODY && !/(?:…|\.\.\.)\s*$/.test(body) && !SECRET_TEXT.test(body);
}
function safeUrl(value: string): URL | null {
  if (!value || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        [...url.searchParams.keys()].some(k => SECRET_PARAM.test(k))) return null;
    return url;
  } catch { return null; }
}
function safeText(value: string): boolean {
  if (SECRET_TEXT.test(value)) return false;
  for (const match of value.matchAll(/(?:https?:\/\/|\/\/)[^\s<>"']+/gi)) {
    // XML/HTML escaping does not hide query names from credential checks.
    const url = match[0].replaceAll("&amp;", "&").replace(/[),.;]+$/, "");
    // Plain //code comments are not links; protocol-relative web links still need validation.
    if (url.startsWith("//") && !/[.@?]/.test(url)) continue;
    if (!safeUrl(url.startsWith("//") ? `https:${url}` : url)) return false;
  }
  return true;
}
function safeLinks(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) return value.length <= MAX_ITEMS && value.every(safeLinks);
  const r = record(value);
  return !!r && Object.values(r).every(v => typeof v !== "string" || safeText(v));
}
function xUrl(id: string, source: FreeSocialSource): string | null {
  return /^[1-9]\d{0,24}$/.test(id) && /^[A-Za-z0-9_]{1,15}$/.test(source.handle ?? "") ? `https://x.com/${source.handle}/status/${id}` : null;
}
function wechatUrl(value: string): string | null {
  const url = safeUrl(value);
  if (!url || url.protocol !== "https:" || url.port || url.hash) return null;
  if (url.hostname === "weread.qq.com" && /^\/reviewdetail\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname) && !url.search) return url.toString();
  if (url.hostname !== "mp.weixin.qq.com") return null;
  // Public article identity keys only; auth/ticket query data is never retained or discarded silently.
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(k => !["__biz", "mid", "idx", "sn", "scene", "from", "isappinstalled", "chksm"].includes(k))) return null;
  if (/^\/s\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) return `https://mp.weixin.qq.com${url.pathname}`;
  if (url.pathname !== "/s" || !/^[A-Za-z0-9_=-]{1,256}$/.test(url.searchParams.get("__biz") ?? "") || !/^\d{1,24}$/.test(url.searchParams.get("mid") ?? "") ||
      !/^\d+$/.test(url.searchParams.get("idx") ?? "") || !/^[A-Za-z0-9]+$/.test(url.searchParams.get("sn") ?? "")) return null;
  const params = ["__biz", "mid", "idx", "sn"].map(k => `${k}=${url.searchParams.get(k)!}`).join("&");
  return `https://mp.weixin.qq.com/s?${params}`;
}

export function normalizeXPosts(input: unknown, source: FreeSocialSource, now = new Date()): Candidate[] {
  const verified = approved(source, "x");
  if (!Array.isArray(input)) throw new Error("invalid social input");
  if (input.length > MAX_ITEMS) throw new Error("social input limit");
  boundedJson(input);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const value of input) {
    const p = record(value), author = record(p?.author);
    if (!p || !author || string(author.screenName).toLowerCase() !== verified.handle!.toLowerCase() ||
        p.isRetweet !== false || p.retweetedBy != null || p.quotedTweet != null) continue;
    const id = string(p.id), url = xUrl(id, verified), publishedAt = date(p.createdAtISO, now);
    const text = string(p.text).trim(), articleText = string(p.articleText).trim(), articleTitle = string(p.articleTitle).trim();
    if (!url || !publishedAt || seen.has(url) || !(articleText ? text.length > 0 && text.length <= MAX_BODY && useful(articleText, 40) : useful(text, 40)) || !safeText(text) ||
        !safeLinks(p.urls) || !safeLinks(p.media) || (articleTitle && !useful(articleText, 40))) continue;
    const bodyText = articleText ? `${text}\n\n${articleTitle ? `${articleTitle}\n\n` : ""}${articleText}` : text;
    const title = articleTitle || collapseWhitespace(text).slice(0, 240);
    if (!useful(bodyText, 40) || !safeText(bodyText) || title.length > 1000 || !safeText(title) ||
        !string(author.name).trim() || string(author.name).length > 200 || !safeText(string(author.name))) continue;
    seen.add(url);
    const language = LANGUAGE.test(string(p.lang)) ? string(p.lang) : null;
    out.push({ url, title, author: string(author.name).trim(), language,
      publishedAt, bodyText, bodyStatus: "ok", excerpt: collapseWhitespace(text).slice(0, 2000),
      xPost: { tweetId: id, authorName: string(author.name).trim(), handle: verified.handle!, text: bodyText, lang: language },
      raw: { platform: "x", postId: id, ownerEntityId: verified.ownerEntityId } });
  }
  return out;
}

function wechatItems(xml: string, verified: FreeSocialSource): unknown[] {
  if (typeof xml !== "string") throw new Error("invalid social feed");
  if (Buffer.byteLength(xml, "utf8") > MAX_INPUT_BYTES) throw new Error("social input limit");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("invalid social feed");
  let doc: Record<string, unknown>;
  try { doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false }).parse(xml) as Record<string, unknown>; }
  catch { throw new Error("invalid social feed"); }
  const channel = record(record(doc.rss)?.channel);
  if (!channel) throw new Error("invalid social feed");
  if (![verified.name, ...verified.aliases].includes(xmlText(channel.title).trim())) return [];
  const items = array(channel.item);
  if (items.length > MAX_ITEMS) throw new Error("social input limit");
  return items;
}

// References carry no content or publication proof; callers must fetch and validate the original.
export function wechatFeedReferences(xml: string, source: FreeSocialSource): Array<Pick<Candidate, "url" | "title">> {
  const verified=approved(source,"wechat"),seen=new Set<string>(),out:Array<Pick<Candidate,"url" | "title">>=[];
  for(const value of wechatItems(xml,verified)) {
    const p=record(value); if(!p)continue;
    const url=wechatUrl(xmlText(p.link)),title=collapseWhitespace(stripTags(xmlText(p.title)));
    const creator=xmlText(p["dc:creator"]) || xmlText(p.author);
    if(!url || !/^https:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]{1,128}$/.test(url) || !title || title.length>1000 || !safeText(title) || seen.has(url) ||
      creator && ![verified.name,...verified.aliases].includes(creator.trim()))continue;
    seen.add(url);out.push({url,title});
  }
  return out;
}

export function normalizeWechatFeed(xml: string, source: FreeSocialSource, now = new Date()): Candidate[] {
  const verified = approved(source, "wechat");
  const items=wechatItems(xml,verified);
  const seen = new Set<string>(), out: Candidate[] = [];
  for (const value of items) {
    const p = record(value);
    if (!p) continue;
    const url = wechatUrl(xmlText(p.link));
    const title = collapseWhitespace(stripTags(xmlText(p.title)));
    const publishedAt = date(xmlText(p.pubDate) || xmlText(p["dc:date"]), now);
    const original = xmlText(p["content:encoded"]) || xmlText(p.description);
    if (!url || !title || title.length > 1000 || !safeText(title) || !publishedAt || seen.has(url) || Buffer.byteLength(original, "utf8") > MAX_HTML || !safeText(original)) continue;
    const creator = xmlText(p["dc:creator"]) || xmlText(p.author);
    if (creator && ![verified.name, ...verified.aliases].includes(creator.trim())) continue;
    const bodyHtml = sanitizeBody(original, url), bodyText = stripTags(bodyHtml);
    if (!useful(bodyText, 100) || Buffer.byteLength(bodyHtml, "utf8") > MAX_HTML || !safeText(bodyHtml)) continue;
    seen.add(url);
    out.push({ url, title, author: verified.name, language: "zh", publishedAt, bodyHtml, bodyText, bodyStatus: "ok",
      excerpt: bodyText.slice(0, 2000), raw: { platform: "wechat", ownerEntityId: verified.ownerEntityId } });
  }
  return out;
}

// Validate the entire batch before even initializing DB; callers cannot supply identity overrides.
export async function ingestFreeSocial(sourceId: string, candidates: Candidate[]): Promise<AdmissionSummary> {
  const source = approvedSocialSources().find(s => s.id === sourceId);
  if (!source) throw new Error("unapproved social source");
  if (!Array.isArray(candidates) || candidates.length > MAX_ITEMS) throw new Error("social input limit");
  boundedJson(candidates);
  const safe: Candidate[] = [];
  for (const c of candidates) {
    const r = record(c), publishedAt = c?.publishedAt instanceof Date && Number.isFinite(c.publishedAt.getTime()) ? date(c.publishedAt.toISOString(), new Date()) : null;
    const url = source.platform === "wechat" ? wechatUrl(c?.url) : (() => {
      const match = /^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/([1-9]\d{0,24})$/.exec(c?.url ?? "");
      return match && match[1]!.toLowerCase() === source.handle!.toLowerCase() ? xUrl(match[2]!,source) : null;
    })();
    if (!r || !url || !publishedAt || typeof c.title !== "string" || !c.title.trim() || c.title.length > 1000 ||
        typeof c.bodyText !== "string" || !useful(c.bodyText, source.platform === "x" ? 40 : 100) || c.bodyStatus !== "ok" ||
        [c.title,c.bodyText,c.bodyHtml ?? "",c.excerpt ?? "",c.author ?? ""].some(v => typeof v !== "string" || !safeText(v)) ||
        Buffer.byteLength(c.bodyHtml ?? "", "utf8") > MAX_HTML || (c.excerpt?.length ?? 0) > 2000 || (c.author?.length ?? 0) > 200 ||
        (c.language != null && (typeof c.language !== "string" || !LANGUAGE.test(c.language))) ||
        ["identityKey","id","backfill","sourceUpdatedAt","discoveredAt"].some(k => r[k] !== undefined)) throw new Error("invalid social candidate");
    if (source.platform === "wechat" && ![source.name,...source.aliases].includes(c.author ?? "")) throw new Error("invalid social candidate");
    if (c.xPost && (source.platform !== "x" || c.xPost.handle !== source.handle || xUrl(c.xPost.tweetId, source) !== url || c.xPost.quoted)) throw new Error("invalid social candidate");
    const bodyHtml = c.bodyHtml ? sanitizeBody(c.bodyHtml, url) : undefined;
    if (bodyHtml && (Buffer.byteLength(bodyHtml, "utf8") > MAX_HTML || !safeText(bodyHtml) || stripTags(bodyHtml) !== collapseWhitespace(c.bodyText))) throw new Error("invalid social candidate");
    safe.push({ url, title: c.title, author: source.platform === "wechat" ? source.name : c.author, language: c.language,
      publishedAt, bodyText: c.bodyText, bodyHtml, bodyStatus: "ok", excerpt: c.excerpt,
      ...(source.platform === "x" ? { xPost: { tweetId: url.split("/").at(-1)!, handle: source.handle!, authorName: c.author ?? source.name, text: c.bodyText, lang: c.language ?? null } } : {}),
      raw: { platform: source.platform, ownerEntityId: source.ownerEntityId } });
  }
  let registered: SourceRow | undefined;
  let admission: typeof import("./admission.ts");
  try {
    const { sql } = await import("../db.ts");
    admission = await import("./admission.ts");
    [registered] = await sql<SourceRow[]>`SELECT * FROM sources WHERE id=${sourceId}`;
  }
  catch { throw new Error("social database unavailable"); }
  const { collectionPolicy, storeControlled } = admission;
  if (!registered || !registered.enabled || registered.kind !== "external" || registered.participation_mode !== "editorial") throw new Error("social source unavailable");
  let policy;
  try { policy = await collectionPolicy(); } catch { throw new Error("social collection unavailable"); }
  if (!policy?.enabled || !policy.sourceIds.includes(sourceId)) throw new Error("social collection unavailable");
  const controlled = { ...policy };
  for (const key of ["maxAgeHours", "perRun", "perHour", "perDay", "perSourceDay"] as const) controlled[key] = Math.min(policy[key], DEFAULT_COLLECTION_LIMITS[key]);
  try { return await storeControlled(registered, safe, controlled); }
  catch { throw new Error("social ingestion unavailable"); }
}
