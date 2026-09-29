const $=(id)=>document.getElementById(id);
const text=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const external=(url,label)=>url?`<a class="read-link" href="${text(url)}" target="_blank" rel="noopener noreferrer">${text(label)} ↗</a>`:'';
const date=(value)=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(new Date(value)):'';
let data,category='',query='',visible=24;
const label=(key)=>data.categories.find((item)=>item.key===key)?.label??'遥感动态';
function card(item){return `<article class="news-card"><div class="card-meta"><span class="category">${text(label(item.category))}</span><span>${text(item.source.name)}</span><time>${date(item.publishedAt??item.timelineAt)}</time></div><h2><a href="#item/${encodeURIComponent(item.id)}">${text(item.title)}</a></h2><p>${text(item.summary)}</p><div class="card-bottom"><div class="tags">${item.tags.slice(0,3).map((tag)=>`<span class="tag">${text(tag)}</span>`).join('')}${item.score===null?'<span class="tag">编辑整理</span>':''}</div>${external(item.originalUrl,'阅读原文')}</div></article>`;}
function route(){const parts=location.hash.slice(1).split('/');return{view:parts[0]||'selected',key:parts.slice(1).join('/')};}
function showFeed(view){
  const needle=query.trim().toLocaleLowerCase();
  const items=data.items.filter((item)=>(view==='all'||item.selected)&&(!category||item.category===category)&&(!needle||[item.title,item.originalTitle,item.summary,item.source.name,...item.tags].join(' ').toLocaleLowerCase().includes(needle)));
  $('result-count').textContent=`${items.length} 条`;
  $('feed').innerHTML=items.length?items.slice(0,visible).map(card).join(''):'<p class="empty">没有符合条件的内容。试试其他分类或关键词。</p>';
  $('load-more').hidden=items.length<=visible;
  $('categories').innerHTML=[{key:'',label:'全部'},...data.categories].map((item)=>`<button data-category="${text(item.key)}" aria-pressed="${item.key===category}">${text(item.label)}</button>`).join('');
}
function showReport(key){
  const [kind,issue]=key.split('/');
  const current=data.reports.find((report)=>report.kind===kind&&report.key===issue)??data.reports.find((report)=>report.kind==='daily')??data.reports[0];
  if(!current){$('feed').innerHTML='<p class="empty">尚无已发布简报。</p>';return;}
  const kinds={daily:'遥感日报',weekly:'遥感周报',monthly:'月度观察'};
  $('feed').innerHTML=`<div class="report-picker"><label><span class="visually-hidden">简报类型</span><select id="report-kind">${Object.entries(kinds).map(([value,name])=>`<option value="${value}" ${value===current.kind?'selected':''}>${name}</option>`).join('')}</select></label><label><span class="visually-hidden">简报日期</span><select id="report-issue">${data.reports.filter((report)=>report.kind===current.kind).map((report)=>`<option value="${text(report.key)}" ${report.key===current.key?'selected':''}>${text(report.key)}</option>`).join('')}</select></label></div><article class="report-sheet"><div class="report-label">RSHOT · ${kinds[current.kind]} · ${text(current.key)} · ${current.editorialMode==='manual'?'编辑整理':'自动生成'}</div><h2>${text(current.lead?.title??current.title)}</h2>${current.lead?.leadParagraph?`<p>${text(current.lead.leadParagraph)}</p>`:''}${current.overview?`<p>${text(current.overview)}</p>`:''}${current.sections.map((section)=>`<section class="report-section"><h3>${text(section.label)}</h3>${section.summary?`<p>${text(section.summary)}</p>`:''}${section.items.map((item)=>`<article><h4>${item.itemId&&data.items.some((entry)=>entry.id===item.itemId)?`<a href="#item/${encodeURIComponent(item.itemId)}">${text(item.title)}</a>`:text(item.title)}</h4><p>${text(item.summary)}</p><small>${text(item.sourceName)} · ${external(item.originalUrl,'原文')}</small></article>`).join('')}</section>`).join('')}</article>`;
  $('report-kind').addEventListener('change',(event)=>{const next=data.reports.find((report)=>report.kind===event.target.value);if(next)location.hash=`reports/${next.kind}/${next.key}`;});
  $('report-issue').addEventListener('change',(event)=>{location.hash=`reports/${current.kind}/${event.target.value}`;});
}
function render(){
  const {view,key}=route();
  const isFeed=view==='selected'||view==='all';
  $('filters').hidden=!isFeed;$('load-more').hidden=true;$('result-count').textContent='';
  const headings={selected:['每日精选','关注可靠出处、方法实质创新与工具新增能力。'],all:['全部动态','导出的全部精选与最近 7 天公开动态，支持分类和关键词搜索。'],reports:['日报与简报','保留已发布的日报、周报与月度观察。'],sources:['信源','机构、学术资料和重点开源工具的公开来源。'],item:['阅读摘要','保留材料范围、来源日期与原文入口。']};
  const heading=headings[view]??headings.selected;$('page-title').textContent=heading[0];$('page-description').textContent=heading[1];
  document.querySelectorAll('nav a').forEach((link)=>{if(link.hash===`#${view==='item'?'selected':view}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  if(isFeed)showFeed(view);
  else if(view==='reports')showReport(key);
  else if(view==='sources'){$('result-count').textContent=`${data.sources.length} 个`;$('feed').innerHTML=`<div class="source-grid">${data.sources.map((source)=>`<article class="source-card"><h2>${text(source.name)}</h2><p>${text(({rss:'公开订阅',web_list:'官网列表',json_list:'公开数据接口'})[source.kind]??'公开来源')} · 预览收录 ${data.items.filter((item)=>item.source.name===source.name).length} 条</p></article>`).join('')}</div>`;}
  else if(view==='item'){
    const item=data.items.find((entry)=>entry.id===key);
    $('feed').innerHTML=item?`<a class="back-link" href="#selected">← 返回精选</a><article class="news-card detail"><div class="card-meta">${text(label(item.category))} · ${text(item.source.name)} · 原文日期 ${text((item.publishedAt??item.timelineAt).slice(0,10))}</div><h2>${text(item.title)}</h2>${item.originalTitle?`<div class="original-title">${text(item.originalTitle)}</div>`:''}<p>${text(item.summary)}</p>${item.reason?`<p class="reason">${text(item.reason)}</p>`:''}<div class="card-bottom"><div class="tags">${item.tags.map((tag)=>`<span class="tag">${text(tag)}</span>`).join('')}</div>${external(item.originalUrl,'阅读原文')}</div></article>`:'<p class="empty">该条目未包含在本次导出中。</p>';
  }else{$('feed').innerHTML='<p class="empty">页面不存在，请从顶部导航继续浏览。</p>';}
}
async function start(){
  try{const response=await fetch('./snapshot.json');if(!response.ok)throw new Error('snapshot unavailable');data=await response.json();
    $('updated').textContent=`更新于 ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(data.generatedAt))}（北京时间）`;
    $('stats').innerHTML=[[data.items.filter((item)=>item.selected).length,'条精选'],[data.sources.length,'个信源'],[data.reports.filter((report)=>report.kind==='daily').length,'期日报']].map(([n,name])=>`<div><strong>${n}</strong><span>${name}</span></div>`).join('');
    const latest=data.reports.find((report)=>report.kind==='daily');
    $('latest-report').innerHTML=latest?`<p class="eyebrow">最新日报 · <span class="latest-date">${text(latest.key)}</span></p><h2 style="font-size:16px">${text(latest.lead?.title??latest.title)}</h2><a href="#reports/daily/${latest.key}">阅读本期日报 →</a>`:'<p>日报将在首次发布后显示。</p>';
    $('search').addEventListener('input',(event)=>{query=event.target.value;visible=24;render();});
    $('categories').addEventListener('click',(event)=>{const button=event.target.closest('button[data-category]');if(button){category=button.dataset.category;visible=24;render();}});
    $('load-more').addEventListener('click',()=>{visible+=24;render();});
    window.addEventListener('hashchange',()=>{visible=24;render();window.scrollTo({top:0,behavior:'auto'});});render();
  }catch{$('updated').textContent='导出数据未能载入';$('page-description').textContent='请刷新重试。基础内容仍可阅读，公开项目可在 GitHub 查看。';}
}
void start();
