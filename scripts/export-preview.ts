// Anonymous public HTTP only: no database connection, cookies, model profile or admin API.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CATEGORIES } from "@aihot/industry/taxonomy";
import type { ItemSummary, ReportDetail, ReportIndexEntry, SiteStats } from "@aihot/contracts/site";
import { PublicPreviewSchema, publicItem, publicReport } from "./lib/public-preview.ts";
import { inspectSecrets } from "./lib/secret-guard.ts";
import { localSecretValues } from "./lib/local-secrets.ts";
const root=path.resolve(import.meta.dirname,"..");
const {values}=parseArgs({options:{base:{type:"string",default:"http://127.0.0.1:3000"},apply:{type:"boolean",default:false}}});
if (!values.apply) {console.log(JSON.stringify({status:"preview",publicEndpointsOnly:true,modelRequests:0}));process.exit(0);}
const base=new URL(values.base!);
if (!["http:","https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("指定无凭据和查询参数的站点基础地址");
async function read<T>(route:string):Promise<T> {
  const response=await fetch(new URL(route,base),{credentials:"omit",redirect:"error",signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`公开接口读取失败：${route.split('?')[0]}，HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
const ids=new Set<string>();
let page:string|null=null;
do {
  const snapshot:{items:Array<{id:string}>;hasMore:boolean;nextPage:string|null}=await read(`/api/v1/selected/snapshot?limit=500${page?`&page=${encodeURIComponent(page)}`:""}`);
  snapshot.items.forEach((item)=>ids.add(item.id));
  if (snapshot.hasMore && !snapshot.nextPage) throw new Error("精选分页缺少继续标记");
  page=snapshot.hasMore?snapshot.nextPage:null;
  if (ids.size>5000) throw new Error("预览条目超过 5000，请先缩小导出范围");
} while(page);
let cursor:string|null=null;
do {
  const recent:{items:Array<{id:string}>;page:{hasMore:boolean;nextCursor:string|null}}=await read(`/api/v1/items?mode=all&window=7d&limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);
  recent.items.forEach((item)=>ids.add(item.id));
  if(recent.page.hasMore&&!recent.page.nextCursor) throw new Error("动态分页缺少继续标记");
  cursor=recent.page.hasMore?recent.page.nextCursor:null;
  if(ids.size>5000) throw new Error("预览条目超过 5000，请先缩小导出范围");
} while(cursor);
const items=[];
for(const id of ids) items.push(publicItem(await read<ItemSummary>(`/api/site/items/${encodeURIComponent(id)}`)));
const reports=[];
for(const kind of ["daily","weekly","monthly"] as const) {
  const index=await read<{items:ReportIndexEntry[]}>(`/api/site/reports/${kind}`);
  for(const entry of index.items) reports.push(publicReport(await read<ReportDetail>(`/api/site/reports/${kind}/${encodeURIComponent(entry.key)}`)));
}
const stats=await read<SiteStats>("/api/site/stats");
const snapshot=PublicPreviewSchema.parse({schemaVersion:1,generatedAt:new Date().toISOString(),
  categories:CATEGORIES.map(({key,label})=>({key,label})),sources:stats.sampleSources.map(({name,kind})=>({name,kind})),
  items:items.sort((a,b)=>b.timelineAt.localeCompare(a.timelineAt)),reports});
const output="industry/preview/snapshot.json";
const content=JSON.stringify(snapshot,null,2)+"\n";
const findings=inspectSecrets(output,content,localSecretValues(root));
if(findings.length){for(const finding of findings)console.error(JSON.stringify(finding));throw new Error("公开预览未写入，敏感信息检查失败");}
mkdirSync(path.join(root,"industry/preview"),{recursive:true});writeFileSync(path.join(root,output),content);
console.log(JSON.stringify({status:"exported",items:snapshot.items.length,selected:snapshot.items.filter(i=>i.selected).length,
  reports:snapshot.reports.length,sources:snapshot.sources.length,output,modelRequests:0}));
