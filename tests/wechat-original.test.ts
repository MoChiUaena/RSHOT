import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedSocialSources, normalizeWechatFeed } from '../packages/backend/src/sources/free-social.ts';
import { normalizeWechatOriginal } from '../scripts/lib/wechat-original.ts';
const now=new Date('2026-10-02T12:00:00Z');
const source=approvedSocialSources().find(s=>s.id==='free-mp-gis-frontier')!;
const url='https://mp.weixin.qq.com/s/publicArticle_1';
const title='GeoAI 方法与工具';
const text='A reproducible remote sensing workflow exports georeferenced segmentation masks and compares inference accuracy across sensors. '.repeat(3);
const candidate=()=>normalizeWechatFeed(`<rss><channel><title>GIS前沿</title><item><title>${title}</title><link>${url}</link><pubDate>${now.toUTCString()}</pubDate><description>Cached cover text ${text}</description></item></channel></rss>`,source,now)[0]!;
const payload=()=>({code:0,data:{mp_id:'MP_WXS_123',mp_info:{mp_name:'GIS前沿'},title,publish_time:Math.floor(now.getTime()/1000)-3600,content:`<p>${text}</p><script>unsafe()</script>`,fetch_error:''}});
test('original publication date and readable original body replace cached cover fields',()=>{
  const c=candidate(),result=normalizeWechatOriginal(c,payload(),'MP_WXS_123',source,now)!;
  assert.equal(result.publishedAt?.toISOString(),'2026-10-02T11:00:00.000Z');
  assert.equal(result.bodyText,text.trim()); assert.ok(!result.bodyHtml?.includes('script'));
  assert.equal(result.url,url); assert.equal(result.author,'GIS前沿');
  assert.equal((result.raw as any).dateProvenance,'wechat-original');
  assert.equal(c.publishedAt?.toISOString(),now.toISOString());
});
test('original date controls the precise 48-hour boundary regardless of RSS collection time',()=>{
  const p=payload(); p.data.publish_time=Math.floor(now.getTime()/1000)-48*3600;
  assert.ok(normalizeWechatOriginal(candidate(),p,'MP_WXS_123',source,now));
  p.data.publish_time--; assert.equal(normalizeWechatOriginal(candidate(),p,'MP_WXS_123',source,now),null);
});
test('wrong identity or missing, invalid, future and collection-style dates fail closed',()=>{
  const variants:any[]=[null,{code:0},{...payload(),code:50001},
    ...[undefined,null,'1790942400',0,-1,1.2,now.getTime(),Math.floor(now.getTime()/1000)+61].map(publish_time=>({...payload(),data:{...payload().data,publish_time}})),
    {...payload(),data:{...payload().data,mp_id:'MP_WXS_124'}},
    {...payload(),data:{...payload().data,mp_info:{mp_name:'Other publisher'}}},
    {...payload(),data:{...payload().data,title:'Other article'}},
    {...payload(),data:{...payload().data,fetch_error:'upstream-private-diagnostic'}},
    {...payload(),data:{...payload().data,fetch_error:undefined}},
    {...payload(),data:{...payload().data,content:'Please verify the browser'}},
    {...payload(),data:{...payload().data,content:'x'.repeat(2097153)}},
  ];
  for(const p of variants)assert.throws(()=>normalizeWechatOriginal(candidate(),p,'MP_WXS_123',source,now),e=>e instanceof Error&&e.message==='original-verification-failed');
  for(const bad of ['https://evil.example/s/a','https://mp.weixin.qq.com/s/a?token=secret','https://weread.qq.com/web/reader/a'])assert.throws(()=>normalizeWechatOriginal({...candidate(),url:bad},payload(),'MP_WXS_123',source,now));
});
test('original body rejects secrets and truncation rather than retaining cached valid content',()=>{
  for(const content of [text+' auth_token=private-secret',text+' ...']){
    const p=payload();p.data.content=content;
    assert.throws(()=>normalizeWechatOriginal(candidate(),p,'MP_WXS_123',source,now));
  }
});

test('upstream extraction fallback to request time never proves original publication',()=>{
  const started=new Date(now.getTime()-45000);
  for(const seconds of [Math.floor(started.getTime()/1000)-30,Math.floor(started.getTime()/1000),Math.floor(now.getTime()/1000)]){
    const p=payload();p.data.publish_time=seconds;
    assert.throws(()=>normalizeWechatOriginal(candidate(),p,'MP_WXS_123',source,now,started));
  }
  const p=payload();p.data.publish_time=Math.floor(started.getTime()/1000)-120;
  assert.ok(normalizeWechatOriginal(candidate(),p,'MP_WXS_123',source,now,started));
});
