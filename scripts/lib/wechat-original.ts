import { normalizeWechatFeed, type FreeSocialSource } from '../../packages/backend/src/sources/free-social.ts';
import type { Candidate } from '../../packages/backend/src/sources/types.ts';

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function escape(value: string): string { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }

// WeRead cover RSS dates are collection times. Only an independently fetched original proves publication.
export function normalizeWechatOriginal(candidate: Pick<Candidate, "url" | "title">, payload: unknown, feedId: string, source: FreeSocialSource, now = new Date(), requestStartedAt = now): Candidate | null {
  try {
    if (source.platform !== 'wechat' || !/^MP_WXS_[0-9]+$/.test(feedId) ||
      !/^https:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+$/.test(candidate.url) || !object(payload) || payload.code !== 0 || !object(payload.data)) throw new Error();
    const data=payload.data;
    if (data.mp_id !== feedId || !object(data.mp_info) || typeof data.mp_info.mp_name !== 'string' ||
      ![source.name,...source.aliases].includes(data.mp_info.mp_name) || typeof data.title !== 'string' || !data.title || data.title.length > 1000 ||
      typeof data.publish_time !== 'number' || !Number.isSafeInteger(data.publish_time) || data.publish_time <= 0 ||
      !Number.isFinite(now.getTime()) || !Number.isFinite(requestStartedAt.getTime()) || requestStartedAt.getTime() > now.getTime() ||
      data.publish_time*1000 >= requestStartedAt.getTime()-60000 || data.fetch_error !== '' ||
      typeof data.content !== 'string' || !data.content || Buffer.byteLength(data.content,'utf8') > 2*1024*1024) throw new Error();
    // The upstream original scraper can substitute its current time on date extraction errors.
    // Reject the query-time range; genuinely just-published articles wait for a later run.
    const publishedAt=new Date(data.publish_time*1000);
    // Validate title and body through the same source/content boundary even when the article is old.
    const xml=`<rss><channel><title>${escape(source.name)}</title><item><title>${escape(data.title)}</title><link>${escape(candidate.url)}</link><pubDate>${now.toUTCString()}</pubDate><description><![CDATA[${data.content.replaceAll(']]>',']]]]><![CDATA[>')}]]></description></item></channel></rss>`;
    const normalized=normalizeWechatFeed(xml,source,now)[0];
    if (!normalized || normalized.title !== candidate.title) throw new Error();
    if (publishedAt.getTime() < now.getTime()-48*3600000) return null;
    return {...normalized,publishedAt,raw:{...(normalized.raw as Record<string,unknown>),dateProvenance:'wechat-original'}};
  } catch { throw new Error('original-verification-failed'); }
}
