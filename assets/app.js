async function loadCorpus(){
  const b64=(await Promise.all(Array.from({length:31},(_,i)=>fetch('data/corpus.part'+String(i).padStart(2,'0')).then(r=>r.text())))).join('');
  const bin=Uint8Array.from(atob(b64.trim()),c=>c.charCodeAt(0));
  const stream=new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
(async()=>{
const DB=await loadCorpus(); let state={year:null,topic:null,dim:null,q:'',translate:true,view:'list'};
const SOURCE_URLS={
 'afd_1.pdf':'https://www.abgeordnetenwatch.de/sites/default/files/election-program-files/afd_1.pdf',
 'AfD-Europaprogramm_Langfassung.pdf':'https://www.abgeordnetenwatch.de/sites/default/files/election-program-files/afd-europawahl-2014.pdf',
 '2016-06-27_afd-grundsatzprogramm_web-version.pdf':'https://www.afd.de/wp-content/uploads/2023/05/Programm_AfD_Online_.pdf',
 '2017-06-01_AfD-Bundestagswahlprogramm_Onlinefassung.pdf':'https://www.afd.de/wp-content/uploads/2017/06/2017-06-01_AfD-Bundestagswahlprogramm_Onlinefassung.pdf',
 '20210611_AfD_Programm_2021.pdf':'https://www.afd.de/wp-content/uploads/2021/06/20210611_AfD_Programm_2021.pdf',
 'AfD_Bundestagswahlprogramm2025_web.pdf':'https://www.afd.de/wp-content/uploads/2025/02/AfD_Bundestagswahlprogramm2025_web.pdf'
};
const translationCache=new Map(); let translatorInstance=null; let translatorPromise=null; let translationObserver=null;
const years=[2013,2014,2016,2017,2021,2025], topics=['人民与民主','主权与国家','欧洲与欧盟','移民与庇护','文化与身份','精英与代表'];
function esc(s){return String(s||'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]))}
function tokens(q){q=q.trim().toLowerCase(); if(!q)return[]; let out=q.split(/\s+/).filter(Boolean); Object.entries(DB.query_expansion).forEach(([k,v])=>{if(q.includes(k.toLowerCase())) out.push(...v.map(x=>x.toLowerCase()))}); return [...new Set(out)].filter(x=>x.length>1)}
function score(e,tks){if(!tks.length)return 1; const hay=(e.text+' '+e.heading+' '+e.topics.join(' ')+' '+e.dimensions.join(' ')).toLowerCase(); let s=0; tks.forEach(t=>{let i=hay.indexOf(t); if(i>=0)s+=t.length>5?4:2; if(e.heading.toLowerCase().includes(t))s+=3}); return s}
function scoredFiltered(ignoreYear=false){
  const tks=tokens(state.q);
  return DB.entries.map(e=>({e,s:score(e,tks)}))
    .filter(x=>x.s>0)
    .filter(x=>ignoreYear||!state.year||x.e.year===state.year)
    .filter(x=>!state.topic||x.e.topics.includes(state.topic))
    .filter(x=>!state.dim||x.e.dimensions.includes(state.dim))
    .sort((a,b)=>b.s-a.s||b.e.year-a.e.year||a.e.pdf_page-b.e.pdf_page)
}
function filtered(){return scoredFiltered(false).map(x=>x.e)}
function pageLabel(e){return e.page?`S.${e.page}`:`PDF p.${e.pdf_page}`}
function reEsc(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function highlightText(text,tks){let tx=esc(text); if(tks.length){tks.slice(0,12).sort((a,b)=>b.length-a.length).forEach(t=>{try{tx=tx.replace(new RegExp('('+reEsc(t)+')','ig'),'<span class="hl">$1</span>')}catch(_){}})} return tx}
async function ensureTranslator(){
  if(translatorInstance)return translatorInstance;
  if(translatorPromise)return translatorPromise;
  if(!('Translator' in self)) throw new Error('unsupported');
  translatorPromise=(async()=>{
    const opts={sourceLanguage:'de',targetLanguage:'zh'};
    const availability=await Translator.availability(opts);
    if(availability==='unavailable') throw new Error('unavailable');
    const tr=await Translator.create({
      ...opts,
      monitor(m){m.addEventListener('downloadprogress',e=>{
        const note=document.getElementById('translationNote');
        if(note&&typeof e.loaded==='number') note.textContent=`正在准备德中本地翻译模型… ${Math.round(e.loaded*100)}%`;
      })}
    });
    translatorInstance=tr;
    const note=document.getElementById('translationNote');
    if(note)note.textContent='中文译文仅供辅助阅读；正式引用以德文原文为准。';
    return tr;
  })();
  try{return await translatorPromise}finally{translatorPromise=null}
}
async function translateEntry(id){
  if(!state.translate)return;
  const els=[...document.querySelectorAll(`[data-translation-id="${id}"]`)]; if(!els.length)return;
  const paint=(cls,html)=>els.forEach(el=>{if(document.body.contains(el)){el.className=cls;el.innerHTML=html}});
  if(translationCache.has(id)){paint('translation',`<span class="tlabel">中文译文</span>${esc(translationCache.get(id))}`);return}
  const e=DB.entries.find(x=>x.id===id); if(!e)return;
  paint('translation pending','<span class="tlabel">中文译文</span>正在生成…');
  try{
    const tr=await ensureTranslator();
    const zh=await tr.translate(e.text);
    translationCache.set(id,zh);
    paint('translation',`<span class="tlabel">中文译文</span>${esc(zh)}`);
  }catch(err){
    const msg=(err&&String(err.message).includes('unsupported'))?'当前浏览器不支持本地翻译，请使用桌面版 Chrome。':'首次使用可能需要下载德中语言包；点击“中文翻译：开”后再试。';
    paint('translation error',`<span class="tlabel">中文译文</span>${msg}`);
  }
}
function observeTranslations(){
  if(translationObserver)translationObserver.disconnect();
  if(!state.translate)return;
  translationObserver=new IntersectionObserver(entries=>{entries.forEach(item=>{if(item.isIntersecting){const id=+item.target.dataset.translationId;translationObserver.unobserve(item.target);translateEntry(id)}})},{rootMargin:'240px 0px'});
  document.querySelectorAll('[data-translation-id]').forEach(el=>translationObserver.observe(el));
}
function contextNeighbors(id){
  const i=DB.entries.findIndex(x=>x.id===id); if(i<0)return [];
  const e=DB.entries[i], out=[];
  for(let j=i-1;j>=0;j--){if(DB.entries[j].source===e.source){out.push({label:'前文',e:DB.entries[j]});break}}
  for(let j=i+1;j<DB.entries.length;j++){if(DB.entries[j].source===e.source){out.push({label:'后文',e:DB.entries[j]});break}}
  return out;
}
function contextHtml(id){
  const ns=contextNeighbors(id), tks=tokens(state.q);
  if(!ns.length)return '<div class="context-empty">该文本单元没有可显示的相邻上下文。</div>';
  return ns.map(({label,e})=>{
    const cached=translationCache.get(e.id);
    const trBlock=state.translate?`<div class="translation ${cached?'':'pending'}" data-translation-id="${e.id}"><span class="tlabel">中文译文</span>${cached?esc(cached):'等待本地翻译…'}</div>`:'';
    return `<div class="context-item"><div class="context-head"><b>${label}</b><span>${pageLabel(e)}${e.heading?' · '+esc(e.heading):''}</span></div><p class="context-text">${highlightText(e.text,tks)}</p>${trBlock}</div>`;
  }).join('');
}
function toggleContext(id,btn){
  const panel=document.getElementById(`context-${id}`); if(!panel)return;
  const opening=panel.hasAttribute('hidden');
  if(opening){if(!panel.dataset.loaded){panel.innerHTML=contextHtml(id);panel.dataset.loaded='1'}panel.removeAttribute('hidden');btn.textContent='收起上下文';observeTranslations()}
  else{panel.setAttribute('hidden','');btn.textContent='展开上下文'}
}
function renderList(){
  const all=filtered(), list=all.slice(0,120);
  document.getElementById('status').textContent=`${all.length} 个匹配文本单元${all.length>120?' · 当前显示前120条':''}`;
  const box=document.getElementById('results'); const cbox=document.getElementById('compareResults');
  box.style.display='grid'; cbox.style.display='none';
  if(!list.length){box.innerHTML='<div class="empty">没有匹配结果。可尝试更宽的概念词或清除筛选。</div>';return}
  const tks=tokens(state.q);
  box.innerHTML=list.map(e=>{const tx=highlightText(e.text,tks); const src=(SOURCE_URLS[e.source]||'#')+'#page='+e.pdf_page; const cached=translationCache.get(e.id); const trBlock=state.translate?`<div class="translation ${cached?'':'pending'}" data-translation-id="${e.id}"><span class="tlabel">中文译文</span>${cached?esc(cached):'等待本地翻译…'}</div>`:''; return `<article class="result"><div class="meta"><b>${e.year}</b><span>${esc(e.document)}</span><span>· ${pageLabel(e)}</span>${e.topics.map(t=>`<span class="pill">${t}</span>`).join('')}${e.dimensions.map(t=>`<span class="dim-pill">${esc(t.split('｜')[0])}</span>`).join('')}</div>${e.heading?`<h4>${esc(e.heading)}</h4>`:''}<p>${tx}</p>${trBlock}<div class="context-panel" id="context-${e.id}" hidden></div><footer><span class="trace">原始证据 · ${esc(e.source)}</span><span class="actions"><button class="context-btn" onclick="toggleContext(${e.id},this)">展开上下文</button><a href="${src}" target="_blank">打开原始PDF ↗</a><button class="cite-btn" onclick="openCitation(${e.id})">生成引用</button></span></footer></article>`}).join('');
  observeTranslations();
}
function renderCompare(){
  const box=document.getElementById('results'); const cbox=document.getElementById('compareResults');
  box.style.display='none'; cbox.style.display='grid';
  if(!state.q.trim() && !state.topic && !state.dim){
    document.getElementById('status').textContent='跨年份对比 · 请先输入一个概念，或选择主题/分析维度';
    cbox.innerHTML='<div class="empty" style="grid-column:1/-1">跨年份模式用于比较同一概念在六份党纲中的表达。请输入“人民主权”“移民 主权”“Leitkultur”等，或先选择一个分析维度。</div>'; return;
  }
  const tks=tokens(state.q); const scored=scoredFiltered(true);
  const byYear=new Map(years.map(y=>[y,[]])); scored.forEach(x=>byYear.get(x.e.year)?.push(x));
  const total=scored.length;
  document.getElementById('status').textContent=`跨年份对比 · ${total} 个匹配文本单元 · 每年显示最相关的2条证据`;
  cbox.innerHTML=years.map(y=>{
    const arr=byYear.get(y)||[]; const doc=DB.documents.find(d=>d.year===y); const top=arr.slice(0,2);
    const body=top.length?top.map(({e})=>{const src=(SOURCE_URLS[e.source]||'#')+'#page='+e.pdf_page; const cached=translationCache.get(e.id); const trBlock=state.translate?`<div class="translation ${cached?'':'pending'}" data-translation-id="${e.id}"><span class="tlabel">中文译文</span>${cached?esc(cached):'等待本地翻译…'}</div>`:''; return `<div class="compare-hit">${e.heading?`<h4>${esc(e.heading)}</h4>`:''}<p class="de">${highlightText(e.text,tks)}</p>${trBlock}<div class="mini-meta"><span>${pageLabel(e)} · ${arr.length}条命中</span><span style="display:flex;gap:8px;align-items:center"><button class="context-btn" onclick="toggleContext(${e.id},this)">展开上下文</button><a href="${src}" target="_blank">原文 ↗</a><button class="cite-btn" onclick="openCitation(${e.id})">生成引用</button></span></div><div class="context-panel" id="context-${e.id}" hidden></div></div>`}).join(''):`<div class="compare-empty">当前条件下没有匹配文本。</div>`;
    return `<section class="compare-year"><div class="compare-year-head"><b>${y}</b><span>${esc(doc?.short||'')}</span></div>${body}</section>`
  }).join('');
  observeTranslations();
}
function renderResults(){state.view==='compare'?renderCompare():renderList()}
function renderFilters(){let h=years.map(y=>`<button class="chip ${state.year===y?'active':''}" data-year="${y}">${y}</button>`).join(''); h+=topics.map(t=>`<button class="chip ${state.topic===t?'active':''}" data-topic="${t}">${t}</button>`).join(''); document.getElementById('filters').innerHTML=h; document.querySelectorAll('[data-year]').forEach(b=>b.onclick=()=>{state.year=state.year===+b.dataset.year?null:+b.dataset.year;renderFilters();renderResults()}); document.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>{state.topic=state.topic===b.dataset.topic?null:b.dataset.topic;renderFilters();renderResults()})}
let activeCitation=null;
function citationData(e){
  const pg=pageLabel(e);
  return {
    first:{plain:`Alternative für Deutschland, ${e.title}, ${e.year}, ${pg}.`,html:`Alternative für Deutschland, <i>${esc(e.title)}</i>, ${e.year}, ${pg}.`},
    short:{plain:`AfD, ${e.document}, ${pg}.`,html:`AfD, <i>${esc(e.document)}</i>, ${pg}.`},
    ibid:{plain:`Ibid., ${pg}.`,html:`<i>Ibid.</i>, ${pg}.`},
    locator:{plain:`${e.year} · ${e.document} · ${pg}${e.heading?' · '+e.heading:''}`,html:`${e.year} · ${esc(e.document)} · ${pg}${e.heading?' · '+esc(e.heading):''}`}
  }
}
function openCitation(id){
  const e=DB.entries.find(x=>x.id===id); if(!e)return;
  activeCitation={entry:e,data:citationData(e)};
  const c=activeCitation.data;
  document.getElementById('citeSource').innerHTML=`<b>${e.year} · ${esc(e.document)} · ${pageLabel(e)}</b>${e.heading?`<br>${esc(e.heading)}`:''}`;
  const option=(key,label,note,html,secondary=false)=>`<div class="cite-option"><div class="cite-option-head"><b>${label}</b><span>${note}</span></div><div class="cite-text">${html}</div><button class="cite-copy ${secondary?'secondary':''}" onclick="copyCitationChoice('${key}')">复制${secondary?'文本':'到 Word'}</button></div>`;
  document.getElementById('citeOptions').innerHTML=
    option('first','首次引用','完整书目信息',c.first.html)+
    option('short','后续引用','非连续重复引用',c.short.html)+
    option('ibid','连续引用','仅在上一注为同一文献时使用',c.ibid.html,true)+
    option('locator','证据定位','研究笔记 / 数据导出辅助',c.locator.html,true);
  const m=document.getElementById('citeModal');m.hidden=false;m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
}
function closeCitation(){const m=document.getElementById('citeModal');if(!m)return;m.hidden=true;m.setAttribute('aria-hidden','true');document.body.style.overflow='';activeCitation=null}
async function copyCitationChoice(key){if(!activeCitation||!activeCitation.data[key])return;const c=activeCitation.data[key];await copyCitation(c.plain,c.html)}
async function copyCitation(plain,html){
  try{
    if(navigator.clipboard&&window.ClipboardItem){
      const item=new ClipboardItem({'text/plain':new Blob([plain],{type:'text/plain'}),'text/html':new Blob([html],{type:'text/html'})});
      await navigator.clipboard.write([item]);
    }else if(navigator.clipboard){await navigator.clipboard.writeText(plain)}
    else{throw new Error('clipboard unavailable')}
    showToast('已复制引用 · 粘贴到 Word 可保留题名斜体');
  }catch(_){
    const ta=document.createElement('textarea');ta.value=plain;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast('已复制引用');
  }
}
function showToast(msg){const t=document.getElementById('copyToast');t.textContent=msg;t.classList.add('show');clearTimeout(showToast._t);showToast._t=setTimeout(()=>t.classList.remove('show'),1800)}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCitation()});
function exportCsv(){const rows=filtered(); const cols=['year','document','page','pdf_page','heading','topics','dimensions','text']; let csv=[cols.join(',')].concat(rows.map(e=>cols.map(c=>'"'+String(Array.isArray(e[c])?e[c].join('; '):(e[c]??'')).replace(/"/g,'""')+'"').join(','))).join('\n'); const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a.download='afd_search_results.csv';a.click()}
document.getElementById('searchBtn').onclick=()=>{state.q=document.getElementById('q').value;renderResults();document.getElementById('explore').scrollIntoView({behavior:'smooth'})}; document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('searchBtn').click()}); document.getElementById('resetBtn').onclick=()=>{const keepTranslate=state.translate;state={year:null,topic:null,dim:null,q:'',translate:keepTranslate,view:'list'};document.getElementById('q').value='';renderFilters();renderResults()}; document.getElementById('exportBtn').onclick=exportCsv; document.getElementById('translateToggle').onclick=()=>{state.translate=!state.translate;document.getElementById('translateToggle').textContent=`中文翻译：${state.translate?'开':'关'}`;renderResults()}; document.getElementById('viewToggle').onclick=()=>{state.view=state.view==='list'?'compare':'list'; if(state.view==='compare'){state.year=null;renderFilters()} document.getElementById('viewToggle').textContent=state.view==='compare'?'返回列表':'跨年份对比'; document.getElementById('viewToggle').classList.toggle('view-active',state.view==='compare'); renderResults()};
document.querySelectorAll('.dim').forEach(x=>x.onclick=()=>{state.dim=x.dataset.dim;renderResults();document.getElementById('explore').scrollIntoView({behavior:'smooth'})});
document.querySelectorAll('[data-query]').forEach(b=>b.onclick=()=>{state.q=b.dataset.query;document.getElementById('q').value=state.q;renderResults();document.getElementById('explore').scrollIntoView({behavior:'smooth'})});
document.getElementById('corpusSummary').textContent=`${DB.documents.length}份正式党纲 · ${DB.documents.reduce((a,d)=>a+d.pages,0)}页 · ${DB.entries.length.toLocaleString()}个文本单元`;
document.getElementById('docs').innerHTML=DB.documents.map(d=>`<tr><td><b>${d.year}</b></td><td>${esc(d.short)}</td><td>${esc(d.type)}</td><td>${d.pages}</td><td>${d.entries}</td></tr>`).join('');
renderFilters();renderResults();

})();