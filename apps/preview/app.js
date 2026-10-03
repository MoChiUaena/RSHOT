const $=(id)=>document.getElementById(id);
const text=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const external=(url,label)=>url?`<a class="read-link" href="${text(url)}" target="_blank" rel="noopener noreferrer">${text(label)} ↗</a>`:'';
const icon=(name)=>`<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const storeRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const storeWrite=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
const starKey='rshot-preview-starred',themeKey='rshot-preview-theme';
function readStars(){
  let raw;
  try{
    raw=localStorage.getItem(starKey);
    const ids=raw===null?[]:JSON.parse(raw);
    if(!Array.isArray(ids)||ids.some((id)=>typeof id!=='string'))return{raw,ids:[],corrupt:true};
    return{raw,ids,corrupt:false};
  }catch{return{raw,ids:[],corrupt:true};}
}
let starred=new Set(readStars().ids);
let sessionStars=null,sessionBase,starNotice='';
async function editStar(id){
  const run=()=>{
    const fresh=readStars(),next=new Set(fresh.ids);
    const current=sessionStars&&sessionBase===fresh.raw?sessionStars:next;
    if(current.has(id))next.delete(id);else next.add(id);
    if(!fresh.corrupt&&storeWrite(starKey,[...next])){
      starred=next;sessionStars=null;starNotice='';return true;
    }
    // Session edits never become a replacement for a valid newer write from another tab.
    const fallback=sessionStars&&sessionBase===fresh.raw?new Set(sessionStars):new Set(fresh.ids);
    if(fallback.has(id))fallback.delete(id);else fallback.add(id);
    sessionStars=fallback;sessionBase=fresh.raw;starred=fallback;
    starNotice=fresh.corrupt&&fresh.raw!==undefined?'已有收藏数据无法读取，原始数据已保留。收藏仅在本次页面会话中保留。':'当前浏览器未允许持久保存，收藏仅在本次页面会话中保留。';
    return false;
  };
  const locks=window.navigator?.locks;
  if(!locks)return run();
  let entered=false;
  try{return await locks.request('rshot-preview:starred',()=>{entered=true;return run();});}
  catch(error){if(entered)throw error;return run();}
}
let themeChoice=storeRead('rshot-preview-theme','system');
let data,category='',query='',visible=24;
const label=(key)=>data.categories.find((item)=>item.key===key)?.label??'遥感动态';
const displayDate=(value)=>{
  if(typeof value!=='string'||!value)return null;
  const date=new Date(value),shifted=new Date(date.getTime()+8*3600000);
  return Number.isFinite(date.getTime())&&Number.isFinite(shifted.getTime())?date:null;
};
const dayOf=(value)=>{const date=displayDate(value);return date?new Date(date.getTime()+8*3600000).toISOString().split('T')[0]:null;};
const timeOf=(value)=>{const date=displayDate(value);return date?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):'时间未知';};
function route(){const parts=location.hash.slice(1).split('/');return{view:parts[0]||'selected',key:parts.slice(1).join('/')};}
function applyTheme(){
  if(!['light','dark','system'].includes(themeChoice))themeChoice='system';
  document.documentElement.dataset.theme=themeChoice==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):themeChoice;
  document.querySelectorAll('[data-theme-choice]').forEach((button)=>button.setAttribute('aria-checked',String(button.dataset.themeChoice===themeChoice)));
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(themeChoice==='system')applyTheme();});

function card(item,showTags=false){
  return `<article class="news-card"><div class="card-meta"><span>${text(item.source.name)}</span>${item.selected?'<span class="selected-badge">• 精选</span>':''}<span class="card-tools">${item.score!==null?`<span class="score-label" aria-label="AI 评分 ${item.score} 分">AI 评分 · <strong>${item.score}</strong></span>`:''}<button class="star-button" data-star="${text(item.id)}" aria-label="收藏" aria-pressed="${starred.has(item.id)}" title="${starred.has(item.id)?'取消收藏':'收藏到当前浏览器'}">${icon('bookmark')}</button></span></div><h2><a href="#item/${encodeURIComponent(item.id)}">${text(item.title)}</a></h2>${item.summary?`<p>${text(item.summary)}</p>`:''}${showTags?`<div class="card-bottom"><div class="tags"><span>${text(label(item.category))}</span>${item.tags.slice(0,3).map((tag)=>`<span class="tag">#${text(tag)}</span>`).join('')}</div></div>`:''}${item.reason?`<div class="card-reason">推荐理由：${text(item.reason)}</div>`:''}</article>`;
}
function timeline(items,showTags=false){
  const groups=new Map();
  items.forEach((item)=>{const day=dayOf(item.timelineAt);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(item);});
  return [...groups].sort(([a],[b])=>a===null?1:b===null?-1:0).map(([day,entries])=>{
    const date=day?displayDate(`${day}T12:00:00+08:00`):null;
    const month=date?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',timeZone:'Asia/Shanghai'}).format(date):'日期未知';
    const weekday=date?new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'Asia/Shanghai'}).format(date):'';
    return `<section class="day-group"><h2 class="day-header"><strong>${month}</strong><span>${weekday?`${weekday} · `:''}${entries.length} 条</span></h2>${entries.map((item)=>`<div class="timeline-row"><time class="timeline-time">${timeOf(item.timelineAt)}</time><span class="timeline-dot" aria-hidden="true"></span>${card(item,showTags)}</div>`).join('')}</section>`;
  }).join('');
}
function showFeed(view,topic=null){
  const needle=query.trim().toLocaleLowerCase();
  const items=data.items.filter((item)=>(view==='all'||view==='starred'||item.selected)&&(view!=='starred'||starred.has(item.id))&&(!topic||topic.itemIds.includes(item.id))&&
    (!category||(category==='firstParty'?item.source.firstParty:item.category===category))&&(!needle||[item.title,item.originalTitle,item.summary,item.source.name,...item.tags].join(' ').toLocaleLowerCase().includes(needle)));
  $('result-count').textContent=`${items.length} 条`;
  const empty=view==='starred'?'还没有收藏。点击文章右上角的书签图标，将内容保存在当前浏览器。':'没有符合条件的内容。试试其他分类或关键词。';
  $('feed').innerHTML=items.length?timeline(items.slice(0,visible),view!=='selected'):`<p class="empty">${empty}</p>`;
  $('load-more').hidden=items.length<=visible;
  $('categories').innerHTML=[{key:'',label:'全部'},{key:'firstParty',label:'一手'},...data.categories].map((item)=>`<button data-category="${text(item.key)}" aria-pressed="${item.key===category}">${text(item.label)}</button>`).join('');
}
function showReport(key){
  const [kind,issue]=key.split('/');
  const current=data.reports.find((report)=>report.kind===kind&&report.key===issue)??data.reports.find((report)=>report.kind==='daily')??data.reports[0];
  if(!current){$('feed').innerHTML='<p class="empty">尚无已发布简报。</p>';return;}
  const kinds={daily:'遥感日报',weekly:'遥感周报',monthly:'月度观察'};
  $('feed').innerHTML=`<div class="report-picker"><select id="report-kind" aria-label="简报类型">${Object.entries(kinds).map(([value,name])=>`<option value="${value}" ${value===current.kind?'selected':''}>${name}</option>`).join('')}</select><select id="report-issue" aria-label="简报日期">${data.reports.filter((report)=>report.kind===current.kind).map((report)=>`<option value="${text(report.key)}" ${report.key===current.key?'selected':''}>${text(report.key)}</option>`).join('')}</select></div><article class="report-sheet"><div class="report-label">RSHOT · ${kinds[current.kind]} · ${text(current.key)} · ${current.editorialMode==='manual'?'编辑整理':'自动生成'}</div><h2>${text(current.lead?.title??current.title)}</h2>${current.lead?.leadParagraph?`<p>${text(current.lead.leadParagraph)}</p>`:''}${current.overview?`<p>${text(current.overview)}</p>`:''}${current.sections.map((section)=>`<section class="report-section"><h3>${text(section.label)}</h3>${section.summary?`<p>${text(section.summary)}</p>`:''}${section.items.map((item)=>`<article><h4>${item.itemId&&data.items.some((entry)=>entry.id===item.itemId)?`<a href="#item/${encodeURIComponent(item.itemId)}">${text(item.title)}</a>`:text(item.title)}</h4><p>${text(item.summary)}</p><small>${text(item.sourceName)} · ${external(item.originalUrl,'原文')}</small></article>`).join('')}</section>`).join('')}</article>`;
  $('report-kind').addEventListener('change',(event)=>{const next=data.reports.find((report)=>report.kind===event.target.value);if(next)location.hash=`reports/${next.kind}/${next.key}`;});
  $('report-issue').addEventListener('change',(event)=>{location.hash=`reports/${current.kind}/${event.target.value}`;});
}
function showTopics(){
  const groups={company:'机构与平台',field:'技术方向',genre:'内容形态'};
  $('feed').innerHTML=Object.entries(groups).map(([group,name])=>`<section class="topic-group"><h2>${name}</h2><div class="topic-grid">${data.topics.filter((topic)=>topic.group===group).map((topic)=>`<article class="topic-card"><h3>${text(topic.name)}</h3><p>${text(topic.definition)}</p><a href="#topic/${encodeURIComponent(topic.slug)}">${topic.itemIds.length?`查看 ${topic.itemIds.length} 条精选`:'待收录 · 查看方向介绍'} →</a></article>`).join('')}</div></section>`).join('');
}
function showHot(){
  if(!data.hot.entries.length){$('feed').innerHTML='<div class="info-panel"><h2>当前暂无多来源热点</h2><p>热点榜衡量最近 48 小时的多来源讨论，单一来源的重要成果仍可进入精选。下面是最近精选，供继续阅读。</p></div>'+timeline(data.items.filter((item)=>item.selected).slice(0,6));return;}
  $('feed').innerHTML=data.hot.entries.map((entry)=>`<article class="hot-entry"><span class="rank">${String(entry.rank).padStart(2,'0')}</span><div><h2>${entry.itemId&&data.items.some((item)=>item.id===entry.itemId)?`<a href="#item/${encodeURIComponent(entry.itemId)}">${text(entry.title)}</a>`:text(entry.title)}</h2><p>${text(entry.summary)}</p><small>热度 ${entry.heat} · ${entry.sourceCount} 个来源 · ${text(entry.sourceNames.join('、'))}</small></div></article>`).join('');
}
function sources(){return `<div class="source-grid">${data.sources.map((source)=>`<article class="source-card"><h2>${text(source.name)}</h2><p>${text(({rss:'公开订阅',web_list:'官网列表',json_list:'公开数据接口'})[source.kind]??'公开来源')} · 预览收录 ${data.items.filter((item)=>item.source.name===source.name).length} 条</p></article>`).join('')}</div>`;}
async function showChangelog(){
  try{const response=await fetch('./changelog.json');if(!response.ok)throw new Error();const log=await response.json();if(route().view!=='changelog')return;
    $('feed').innerHTML=log.releases.map((release)=>`<article class="info-panel"><span class="muted">${text(release.date)} · ${text(release.kind)}</span><h2>${text(release.title)}</h2>${release.body.map((line)=>`<p>${text(line)}</p>`).join('')}</article>`).join('');
  }catch{if(route().view==='changelog')$('feed').innerHTML='<p class="empty">更新日志暂未加载，请刷新重试。</p>';}
}
function render(){
  const {view,key}=route();
  const topic=view==='topic'?data.topics.find((entry)=>entry.slug===key):null;
  const isFeed=['selected','all','starred','topic'].includes(view);
  $('filters').hidden=!isFeed;$('load-more').hidden=true;$('result-count').textContent='';$('reader-status').textContent=starNotice;
  const headings={selected:['精选',''],all:['全部遥感动态','全部公开精选与最近 7 天动态，可按分类、信源和关键词筛选。'],reports:['遥感日报','日报、周报与月度观察，保留来源与编辑模式。'],hot:['热点榜',`最近 ${data.hot.windowHours} 小时的多来源讨论，数据以导出时刻为准。`],topics:['主题','按机构与平台、技术方向、内容形态浏览相关精选。'],starred:['收藏','仅保存在当前浏览器，不上传服务器。'],sources:['信源','机构、学术资料和重点开源工具的公开来源。'],item:['阅读摘要',''],agent:['Agent 接入','免费预览提供公开静态快照，完整 API、RSS 和 MCP 由后端提供。'],about:['关于 RSHOT',''],changelog:['更新日志',''],feedback:['反馈',''],more:['更多','']};
  const heading=topic?[topic.name,topic.definition]:(headings[view]??['页面不存在','']);
  $('page-title').textContent=heading[0];$('page-description').textContent=heading[1];$('page-description').hidden=!heading[1];
  const active=view==='item'?'selected':view==='topic'?'topics':view==='sources'?'about':view;
  document.querySelectorAll('[data-nav]').forEach((link)=>{
    const matches=link.dataset.nav===active||(link.closest('.mobile-tabbar')&&link.dataset.nav==='more'&&!['selected','all','reports'].includes(active));
    if(matches)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
  if(view==='topic'&&!topic){$('filters').hidden=true;$('feed').innerHTML='<p class="empty">该主题未包含在本次导出中。</p>';}
  else if(isFeed)showFeed(view,topic);
  else if(view==='reports')showReport(key);
  else if(view==='topics')showTopics();
  else if(view==='hot')showHot();
  else if(view==='sources'){$('result-count').textContent=`${data.sources.length} 个`;$('feed').innerHTML=sources();}
  else if(view==='item'){
    const item=data.items.find((entry)=>entry.id===key);
    const originalDate=item?.publishedAt??item?.timelineAt;
    $('feed').innerHTML=item?`<a class="back-link" href="#selected">← 返回精选</a><article class="news-card detail"><div class="card-meta">${text(label(item.category))} · ${text(item.source.name)} · 原文日期 ${text(displayDate(originalDate)?originalDate.split('T')[0]:'日期未知')}</div><h2>${text(item.title)}</h2>${item.originalTitle?`<div class="original-title">${text(item.originalTitle)}</div>`:''}<p>${text(item.summary)}</p>${item.reason?`<div class="card-reason">推荐理由：${text(item.reason)}</div>`:''}<div class="card-bottom"><div class="tags">${item.tags.map((tag)=>`<span class="tag">${text(tag)}</span>`).join('')}</div>${external(item.originalUrl,'阅读原文')}</div></article>`:'<p class="empty">该条目未包含在本次导出中。</p>';
  }
  else if(view==='about'){
    $('feed').innerHTML=`<section class="info-panel"><h2>遥感研究与工程在前进，让有用的信息更容易找到。</h2><p>RSHOT 面向遥感研究者与工程师，整理论文、数据、卫星传感器和开源工具的中文摘要与原文索引。</p><div class="stats">${[[data.items.filter((item)=>item.selected).length,'条精选'],[data.sources.length,'个信源'],[data.reports.filter((report)=>report.kind==='daily').length,'期日报']].map(([n,name])=>`<div><strong>${n}</strong><span>${name}</span></div>`).join('')}</div><p>精选优先考虑可追溯的可靠出处、方法实质创新和工具新增能力。arXiv 与 GitHub 的收录本身不代表同行评审或权威背书。</p><p>${external('https://github.com/MoChiUaena/RSHOT/blob/main/docs/editorial-policy.md','查看精选依据')} · <a href="#sources">查看信源</a></p><p class="muted">当前为只读测试预览，内容由本机站点导出；原文版权归各来源所有。</p></section>${sources()}`;
  }
  else if(view==='agent'){
    const snapshotUrl=new URL('./snapshot.json',location.href).href;
    $('feed').innerHTML=`<section class="info-panel"><h2>读取公开内容快照</h2><p>快照包含公开精选、摘要、分类、来源链接与已发布简报，更新时刻在 generatedAt 字段中。</p><pre class="code-box">GET ${text(snapshotUrl)}</pre><p><a href="./snapshot.json" target="_blank" rel="noopener noreferrer">打开公开 JSON 快照 ↗</a></p><p>此地址提供静态导出。实时 API、RSS、MCP 和管理员功能需要完整后端。</p><p>${external('https://github.com/MoChiUaena/RSHOT/blob/main/docs/pages-preview.md','查看免费预览说明')}</p></section>`;
  }
  else if(view==='changelog'){ $('feed').innerHTML='<p class="muted">正在读取更新日志…</p>';void showChangelog(); }
  else if(view==='feedback'){
    $('feed').innerHTML='<section class="info-panel"><h2>反馈阅读体验或内容问题</h2><p>免费预览的反馈通过 GitHub Issues 接收。可以说明页面地址、问题和预期结果；内容更正请附原文依据。</p><p>'+external('https://github.com/MoChiUaena/RSHOT/issues','打开 GitHub 问题列表')+'</p><p class="muted">不要在公开反馈中填写 API 密钥、密码、私人标注或数据库备份。</p></section>';
  }
  else if(view==='more'){
    $('feed').innerHTML=`<div class="more-links">${[...document.querySelectorAll('.site-nav a')].filter((link)=>!['selected','all','reports'].includes(link.dataset.nav)).map((link)=>link.outerHTML).join('')}<a href="#sources">${icon('grid')}<span>信源</span></a></div>${document.querySelector('.theme-switch').outerHTML}`;applyTheme();
  }
  else{$('feed').innerHTML='<p class="empty">页面不存在，请从左侧导航继续浏览。</p>';}
}
async function start(){
  try{
    const response=await fetch('./snapshot.json');if(!response.ok)throw new Error('snapshot unavailable');data=await response.json();
    data.topics??=[];data.hot??={windowHours:48,entries:[]};
    const updated=displayDate(data.generatedAt);
    $('updated').textContent=updated?`更新于 ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(updated)}（北京时间）`:'更新时间未知';
    $('search').addEventListener('input',(event)=>{query=event.target.value;visible=24;render();});
    $('categories').addEventListener('click',(event)=>{const button=event.target.closest('button[data-category]');if(button){category=button.dataset.category;visible=24;render();}});
    $('load-more').addEventListener('click',()=>{visible+=24;render();});
    document.addEventListener('click',async(event)=>{
      const star=event.target.closest('button[data-star]');
      if(star){await editStar(star.dataset.star);render();}
      const theme=event.target.closest('button[data-theme-choice]');
      if(theme){themeChoice=theme.dataset.themeChoice;storeWrite('rshot-preview-theme',themeChoice);applyTheme();}
    });
    window.addEventListener('storage',(event)=>{
      if(event.key===null||event.key===starKey){
        const fresh=readStars();
        if(event.key===null||!sessionStars||sessionBase!==fresh.raw){starred=new Set(fresh.ids);sessionStars=null;starNotice='';}
        render();
      }
      if(event.key===null||event.key===themeKey){themeChoice=storeRead(themeKey,'system');applyTheme();}
    });
    document.addEventListener('keydown',(event)=>{if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)&&!event.target.isContentEditable&&!$('filters').hidden){event.preventDefault();$('search').focus();}});
    window.addEventListener('hashchange',()=>{visible=24;category='';query='';$('search').value='';render();window.scrollTo({top:0,behavior:'auto'});});
    render();
  }catch{$('updated').textContent='导出数据未能载入';$('reader-status').textContent='请刷新重试。基础摘要仍可阅读，公开代码可在 GitHub 查看。';}
}
void start();
