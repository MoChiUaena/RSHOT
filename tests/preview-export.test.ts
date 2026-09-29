// This export boundary is database-free and never needs credentials or external requests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { publicItem, publicLink, publicReport, PublicPreviewSchema } from "../scripts/lib/public-preview.ts";
import type { ItemSummary, ReportDetail } from "@aihot/contracts/site";
test("static preview excludes private fields, local links and unavailable report citations",()=>{
  for(const value of ['javascript:alert(1)','http://127.0.0.1:3000/items/a','https://user:password@example.org/a',
    'https://example.org/a?api_key=example','http://192.168.1.1/a','http://[::1]/a']) assert.equal(publicLink(value),null);
  assert.equal(publicLink('https://arxiv.org/abs/2609.12345'),'https://arxiv.org/abs/2609.12345');
  const raw={id:'public-1',title:'Research',originalTitle:null,summary:'Public abstract',reason:null,
    source:{name:'Original source',kind:'rss',firstParty:true,config:{apiKey:'test-private-config'}},
    links:{original:'https://example.org/paper',aihot:'http://localhost:3000/items/public-1'},
    publishedAt:null,timelineAt:new Date().toISOString(),category:'paper',tags:['SAR'],score:null,selected:true,
    adminNote:'test-private-note',raw:{body:'private full body'},body:{zh:'private full text'}};
  const item=publicItem(raw as unknown as ItemSummary);
  assert.ok(!JSON.stringify(item).includes('test-private'));
  assert.ok(!JSON.stringify(item).includes('private full'));
  assert.ok(!JSON.stringify(item).includes('localhost'));
  const citation={itemId:'a',title:'Available',summary:'Public summary',sourceName:'Source',sourceUrl:'https://example.org/a',available:true};
  const report=publicReport({kind:'daily',key:'2026-09-29',title:'Daily',generatedAt:new Date().toISOString(),lead:null,overview:null,
    sections:[{label:'Research',summary:null,items:[citation,{...citation,title:'Withdrawn',available:false}]}],adminNote:'private'} as unknown as ReportDetail);
  assert.equal(report.sections[0]!.items.length,1);
  const snapshot={schemaVersion:1,generatedAt:new Date().toISOString(),categories:[],sources:[],items:[item],reports:[report]};
  assert.doesNotThrow(()=>PublicPreviewSchema.parse(snapshot));
  assert.throws(()=>PublicPreviewSchema.parse({...snapshot,settings:{password:'private'}}));
  assert.throws(()=>PublicPreviewSchema.parse({...snapshot,items:[{...item,adminNote:'private'}]}));
  assert.throws(()=>PublicPreviewSchema.parse({...snapshot,topics:[{slug:'sar',name:'SAR',group:'field',definition:'Public',itemIds:[],adminNote:'private'}]}));
  assert.throws(()=>PublicPreviewSchema.parse({...snapshot,hot:{computedAt:null,windowHours:48,entries:[],credentials:'private'}}));
});
