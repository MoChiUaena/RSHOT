import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PublicPreviewSchema } from "./lib/public-preview.ts";
import { SIDEBAR_DATA, TABBAR_DATA, type NavData } from "../apps/web/app/components/shell/nav-data.ts";
const root=path.resolve(import.meta.dirname,"..");
const data=PublicPreviewSchema.parse(JSON.parse(readFileSync(path.join(root,"industry/preview/snapshot.json"),"utf8")));
const out=path.join(root,"dist/preview");mkdirSync(out,{recursive:true});
for(const file of ["app.js","style.css"]) copyFileSync(path.join(root,"apps/preview",file),path.join(out,file));
const siteCss=readFileSync(path.join(root,"apps/web/app/app.css"),"utf8");
const themes=[siteCss.match(/^:root \{[\s\S]*?^\}/m)?.[0],siteCss.match(/^\[data-theme="dark"\] \{[\s\S]*?^\}/m)?.[0]];
if(themes.some((theme)=>!theme)) throw new Error("原站配色未找到，预览构建已停止");
writeFileSync(path.join(out,"theme.css"),themes.join("\n"));
copyFileSync(path.join(root,"industry/changelog.json"),path.join(out,"changelog.json"));
copyFileSync(path.join(root,"industry/brand/icon.png"),path.join(out,"icon.png"));
writeFileSync(path.join(out,"snapshot.json"),JSON.stringify(data));
const escape=(value:string)=>value.replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const initial=data.items.filter((item)=>item.selected).slice(0,24).map((item)=>`<article class="news-card"><div class="card-meta">${escape(item.source.name)} · ${escape((item.publishedAt??item.timelineAt).slice(0,10))}</div><h2><a href="#item/${encodeURIComponent(item.id)}">${escape(item.title)}</a></h2><p>${escape(item.summary??"")}</p></article>`).join("\n");
const routes:Record<string,string>={"/":"selected","/all":"all","/hot":"hot","/daily":"reports","/topics":"topics","/starred":"starred",
  "/agent":"agent","/about":"about","/changelog":"changelog","/feedback":"feedback","/more":"more"};
const link=(item:NavData)=>`<a href="#${routes[item.to]??item.to.slice(1)}" data-nav="${routes[item.to]??item.to.slice(1)}"><svg class="icon" aria-hidden="true"><use href="#icon-${item.icon}"></use></svg><span>${escape(item.label)}</span></a>`;
const nav=SIDEBAR_DATA.map((section)=>`<section><p class="nav-section-title">${escape(section.title)}</p>${section.items.map(link).join("\n")}</section>`).join("\n");
const html=readFileSync(path.join(root,"apps/preview/index.html"),"utf8").replace("<!--INITIAL_FEED-->",initial)
  .replace("<!--SIDEBAR_NAV-->",nav).replace("<!--MOBILE_NAV-->",TABBAR_DATA.map(link).join("\n"));
writeFileSync(path.join(out,"index.html"),html);writeFileSync(path.join(out,".nojekyll"),"");
console.log(JSON.stringify({status:"built",path:"dist/preview",items:data.items.length,generatedAt:data.generatedAt}));
