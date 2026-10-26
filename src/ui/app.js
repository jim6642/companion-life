const $ = id => document.getElementById(id);
const icons = {
  home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h2m4 0h2m-8 3h2"/>',
  archive:'<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3h8v6H8zm0 10h8m-8 4h5"/>',
  settings:'<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-2z"/><circle cx="12" cy="11" r="3"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  leaf:'<path d="M12 21V10M12 15C4 15 3 9 3 4c6 0 9 3 9 9m0 4c0-7 4-10 9-10 0 6-2 10-9 10"/>',
  star:'<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
  file:'<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8m-8 4h6"/>',
  message:'<path d="M3 3h18v14H9l-6 4zM7 8h10m-10 4h7"/>',
  edit:'<path d="m15 3 6 6-11 11H4v-6zM12 6l6 6"/>',
  refresh:'<path d="M20 8A9 9 0 1 0 21 15M20 3v6h-6"/>',
  logout:'<path d="M9 3H3v18h6m4-5 5-4-5-4m-6 4h12"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
const node = (tag,cls,text) => { const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; };
const state = { token:sessionStorage.getItem('companion-life-token') || '', binding:'', date:'', followToday:true, nav:'today', view:null, selected:null, action:'correct', loading:false };
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('token')){state.token=fragment.get('token');sessionStorage.setItem('companion-life-token',state.token);history.replaceState(null,'',location.pathname+location.search);}
const labels={food:'食物',drink:'饮料',book:'书名',note:'细节',feeling:'感受',place:'地点',course:'课程',topic:'话题',activity:'活动'};
const statusNames={planned:'待赴约',completed:'已完成',skipped:'已取消'};
const dateText = d => new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'}).format(new Date(d+'T12:00:00Z'));
const timeText = at => at ? new Intl.DateTimeFormat('zh-CN',{timeZone:state.view?.timeZone||'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at)) : '尚未确认';
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,3300);}
async function api(route,body){
  const url=new URL('/life/api/'+route,location.origin);if(state.binding)url.searchParams.set('binding',state.binding);
  const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+state.token,'x-console-token':state.token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();
  if(!response.ok||!result.ok){if(response.status===401||response.status===403){sessionStorage.removeItem('companion-life-token');if(!$('login-dialog').open)$('login-dialog').showModal();}throw Error(result.error||'暂时无法读取手记');}
  return result;
}
function empty(container,text,symbol='✧'){const box=node('div','empty-state');box.append(node('div','empty-icon',symbol),node('p','',text));container.append(box);}
function fillInfo(container,title,text){const box=node('div','inspector-block');box.append(node('h4','',title),node('p','',text));container.append(box);return box;}
async function connect(){
  const result=await api('bindings');$('binding').replaceChildren();
  for(const b of result.bindings){const option=node('option','',b.name+' · '+b.role);option.value=b.id;$('binding').append(option);}
  state.binding=result.bindings.some(b=>b.id===state.binding)?state.binding:result.bindings[0]?.id;
  if(!state.binding)throw Error('当前没有可用的生活实例');$('binding').value=state.binding;$('binding').hidden=result.bindings.length<2;
  await load();if($('login-dialog').open)$('login-dialog').close();
}
async function load(date){
  if(state.loading)return;state.loading=true;$('main-content').setAttribute('aria-busy','true');$('refresh').disabled=true;
  for(const id of ['prev-day','next-day','back-today','date-input'])$(id).disabled=true;
  try{
    const query=date||(!state.followToday&&state.date)||'';
    const result=await api('view'+(query?'?date='+encodeURIComponent(query):''));
    state.view=result.view;state.date=result.view.date;
    if(state.selected){const updated=result.view.timeline.find(r=>r.id===state.selected.id);if(!updated)closeInspector();else state.selected=updated;}
    await loadCalendar(state.nav==='calendar'&&state.calendar?.month?state.calendar.month:state.date.slice(0,7));
    render();if(state.selected)selectRecord(state.selected,false);$('connection-text').textContent='本地手记已连接';
  }catch(e){$('connection-text').textContent='连接暂时中断';toast(e.message);throw e;}
  finally{state.loading=false;$('main-content').setAttribute('aria-busy','false');$('refresh').disabled=false;for(const id of ['prev-day','next-day','back-today','date-input'])$(id).disabled=!state.view;}
}
function render(){
  const v=state.view;
  document.title='生活手记 · Companion Life';$('brand-name').textContent='生活手记';
  $('date-display').textContent=dateText(v.date);$('date-input').value=v.date;
  $('weekday').textContent=new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'UTC'}).format(new Date(v.date+'T12:00:00Z'));
  $('synced').textContent='同步于 '+new Intl.DateTimeFormat('zh-CN',{timeZone:v.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v.serverAt));
  $('activity-kicker').textContent=v.date===v.today?'当前活动':'这一天的手记';
  $('current-activity').textContent=v.current?.activity||(v.date!==v.today?'翻看 '+v.date:(v.timeline.length?'自由安排 / 休息':'还没有生活记录'));
  $('current-detail').textContent=v.current?`${v.current.start}–${v.current.end} · ${v.current.label}`:v.date===v.today?'没有安排的时段，也可以留白。':'计划和已经确认的经历，都会分别标记。';
  $('view-current').disabled=!v.current;
  const notices=[];
  if(!v.enabled)notices.push('生活状态已暂停；这里仍可查看已有记录。');
  if(v.preview)notices.push('这一天尚未构思日程，当前显示模板预览；已经接受的约定已列入，浏览不会生成或保存新日程。');
  if(!v.writable)notices.push('记录文件暂不可写，已保留原文件。可以查看，纠错与撤回暂不可用。');
  $('notice').textContent=notices.join(' ');$('notice').hidden=!notices.length;
  renderTimeline();renderStories();renderPlans();renderHistory();renderSettings();
  $('stats').replaceChildren();
  for(const [n,text] of [[v.stats.confirmed,'本日已有自述'],[v.stats.activeStories,'持续中的事'],[v.stats.appointments,'待赴的约定'],[v.stats.recordedDays,'已记录的日子']]){const box=node('div','stat');box.append(node('strong','',n),node('span','',text));$('stats').append(box);}
  switchNav(state.nav,false);
}
function renderTimeline(){
  const box=$('timeline');box.replaceChildren();const filter=$('timeline-filter').value;
  const rows=state.view.timeline.filter(r=>filter==='all'||filter==='confirmed'&&['completed','active_reported','reported'].includes(r.state)||filter==='planned'&&['planned','active_plan','unconfirmed'].includes(r.state));
  if(!rows.length){empty(box,filter==='all'?'这一天还没有记录，留白也没关系。':'这个筛选下还没有记录。');return;}
  const marks={completed:'✓',active_reported:'✓',active_plan:'○',planned:'·',unconfirmed:'◷',skipped:'×',reported:'◇'};
  for(const r of rows){
    const row=node('div','timeline-row state-'+r.state);row.append(node('time','timeline-time',r.start),node('span','timeline-dot',marks[r.state]));
    const entry=node('button','timeline-entry');entry.type='button';entry.setAttribute('aria-pressed',String(state.selected?.id===r.id));entry.setAttribute('aria-label',r.start+' '+r.activity+' '+r.label);
    const top=node('div','timeline-entry-top');top.append(node('h4','',r.activity),node('span','state-label',r.label));entry.append(top);
    const details=Object.values(r.details).join(' · ');entry.append(node('p','',details||`${r.start}–${r.end}${r.appointment?' · 已接受约定':r.preview?' · 模板预览':''}`));
    if(r.estimated)entry.append(node('small','','时长暂估，可再调整'));
    entry.addEventListener('click',()=>selectRecord(r));row.append(entry);box.append(row);
  }
}
function renderStories(){
  const box=$('stories');box.replaceChildren();const ongoing=state.view.stories.filter(s=>s.status==='ongoing');$('story-count').textContent=ongoing.length;
  if(!ongoing.length){empty(box,'还没有持续中的小故事。聊到一件喜欢的小事时，再慢慢开始。','♧');return;}
  for(const s of ongoing){const item=node('article','story-item'),symbol=node('div','item-icon');symbol.innerHTML=icon(s.category==='reading'?'book':'leaf');
    const main=node('div','item-main');main.append(node('h4','',(s.category==='reading'?'正在读：':'正在继续：')+s.title),node('p','',s.progress));
    const meta=node('div','item-meta'),dots=node('span','progress-dots');for(let i=0;i<5;i++)dots.append(node('i',i<Math.min(5,s.history.length)?'filled':''));
    meta.append(dots,node('span','',`${s.history.length}次已记录进展 · ${s.updatedDate}`));main.append(meta);
    if(s.nextStep)main.append(node('p','next-step','下一步打算：'+s.nextStep));item.append(symbol,main);box.append(item);
  }
}
function renderPlans(){
  const box=$('plans');box.replaceChildren();const ended=$('show-ended').checked;
  const list=state.view.plans.filter(p=>ended||p.status==='planned').slice(0,12);
  if(!list.length){empty(box,ended?'还没有保存过约定。':'还没有待赴的约定。想一起做什么，去 QQ 里约个时间吧。','☆');return;}
  for(const p of list){const item=node('article','plan-item'),symbol=node('div','item-icon');symbol.innerHTML=icon('calendar');
    const main=node('div','item-main');main.append(node('span','plan-time',`${p.date} · ${p.time}`),node('h4','',p.title));
    main.append(node('p','',`${p.durationMinutes}分钟${p.estimated?' · 暂估，可调整':''}`));
    const badge=node('span','soft-badge '+(p.status==='planned'&&!p.overdue?'rose':p.status==='completed'?'green':'amber'),p.overdue?'时间已过 · 兑现未确认':statusNames[p.status]||p.status);main.append(badge);item.append(symbol,main);box.append(item);
  }
}
function renderHistory(){
  const box=$('history');box.replaceChildren();$('history-count').textContent=state.view.history.length;
  if(!state.view.history.length){empty(box,'这一天还没有修订记录。');return;}
  for(const h of state.view.history){const item=node('article','history-item');item.append(node('time','',timeText(h.at)));const content=node('div');content.append(node('h4','',h.title),node('p','',h.reason));
    if(h.previous||h.next){const details=node('details');details.append(node('summary','','查看修订前后'));const pretty=node('pre');const readable=value=>value?Object.entries(value).map(([k,v])=>`${k}：${typeof v==='object'?Object.entries(v).map(([a,b])=>a+'：'+b).join('；'):v}`).join('\n'):'无';pretty.textContent='修改前\n'+readable(h.previous)+'\n\n修改后\n'+readable(h.next);details.append(pretty);content.append(details);}item.append(content);box.append(item);
  }
}
function renderSettings(){
  const v=state.view,box=$('settings');box.replaceChildren();const grid=node('div','settings-grid');
  const mode=v.lifeMode, modeName=id=>mode?.options.find(m=>m.id===id)?.name||'沿用原有人设';
  const items=[['原有人设',v.profile.role],['今天的生活方向',modeName(mode?.active.id)],['生活时区',v.timeZone],['每日构思',v.settings.dailyPlanning?'已开启':'使用模板'],['连续小故事',v.settings.stories?'已开启':'未开启'],['聊天改变日程',v.settings.calendar?'已开启':'未开启'],['七日摘要',v.settings.weeklySummary?'已开启':'未开启'],['记录写入',v.writable?'正常':'暂停，原文件保留']];
  for(const [label,text] of items){const item=node('div','setting-item');item.append(node('span','',label),node('strong','',text));grid.append(item);}box.append(grid);
  if(!mode)return;
  box.append(node('p','settings-note','原有人设决定身份、年龄、性格、关系与说话方式。生活方向只提供日常活动素材，冲突时以原有人设为准。'));
  const form=node('form','life-mode-form'),label=node('label','','生活方向'),select=node('select');select.setAttribute('aria-label','生活方向');
  for(const m of mode.options){const o=node('option','',m.name);o.value=m.id;select.append(o);}select.value=mode.selected.id;label.append(select);
  const description=node('p','settings-note'),notesLabel=node('label','','补充生活素材（可选，最多400字）'),notes=node('textarea');notes.setAttribute('aria-label','补充生活素材');notes.maxLength=400;notes.rows=3;notes.value=mode.selected.notes||'';notes.placeholder='例如：偏爱自然观察，下午留半小时画观察手账';notesLabel.append(notes);
  const explain=()=>{description.textContent=mode.options.find(m=>m.id===select.value).description;notes.disabled=select.value==='inherit';notes.required=select.value==='custom';};explain();
  select.addEventListener('change',()=>{state.modeEditing=true;explain();});notes.addEventListener('input',()=>{state.modeEditing=true;});
  const notice=node('p','settings-note',mode.selected.date&&mode.selected.date>v.today?'已安排从 '+mode.selected.date+' 的新日程使用「'+modeName(mode.selected.id)+'」。':'保存后从下一份新日程生效；今天已有记录和已接受约定保留。');
  const submit=node('button','primary-button','保存生活方向');submit.type='submit';submit.disabled=!v.writable;
  const result=node('p','settings-note');result.setAttribute('role','status');
  form.append(label,description,notesLabel,notice,submit,result);box.append(form);
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{const saved=await api('mode',{id:select.value,notes:notes.value,expectedVersion:mode.version});state.modeEditing=false;await load();toast('生活方向已保存，从 '+saved.effectiveDate+' 的新日程生效。');}catch(error){result.textContent=error.message;submit.disabled=false;}});
}
function switchNav(name,scroll=true){
 state.nav=name;const detail=name==='today';
 if(detail&&state.calendar?.month!==state.date.slice(0,7))loadCalendar(state.date.slice(0,7)).catch(e=>toast(e.message));
 $('stats').hidden=!detail;
 $('page-heading').textContent=({calendar:'日子有迹，特别的事有名字',today:state.date+' · 当天记录',settings:'选择日常，保留原来的她'})[name];
 $('main-content').classList.toggle('view-single',name==='settings');
 $('calendar-panel').hidden=name!=='calendar';$('day-milestones').hidden=!detail;
 document.querySelector('.summary-grid').hidden=!detail;document.querySelector('.dashboard-grid').hidden=name==='calendar';
 $('inspector').hidden=!detail||!state.selected;
 for(const button of document.querySelectorAll('[data-nav]')){button.classList.toggle('selected',button.dataset.nav===name);button.setAttribute('aria-current',button.dataset.nav===name?'page':'false');}
 for(const section of document.querySelectorAll('[data-section]')){section.hidden=detail?section.dataset.section==='settings':section.dataset.section!==name;section.classList.toggle('section-visible',section.dataset.section===name);}
 if(scroll)window.scrollTo({top:document.querySelector('.hero').offsetHeight+12,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
}
async function loadCalendar(month){
 const result=await api('calendar'+(month?'?month='+encodeURIComponent(month):''));state.calendar=result.calendar;renderCalendar();
}
function renderCalendar(){
 const c=state.calendar;if(!c)return;$('month-input').value=c.month;$('month-heading').textContent=c.month.replace('-',' 年 ')+' 月';
 const grid=$('calendar-grid');grid.replaceChildren();
 const offset=(new Date(c.month+'-01T12:00:00Z').getUTCDay()+6)%7;
 for(let i=0;i<offset;i++)grid.append(node('div','calendar-blank'));
 for(const d of c.days){const b=node('button','calendar-day'+(d.date===c.today?' is-today':'')+(d.date===state.date?' is-selected':''));b.type='button';b.setAttribute('aria-label',d.date+(d.milestones.length?' '+d.milestones.map(m=>m.title).join('，'):''));
 const top=node('div','day-top');top.append(node('strong','',Number(d.date.slice(-2))));if(d.date===c.today)top.append(node('small','','今天'));b.append(top);
 for(const m of d.milestones.slice(0,2))b.append(node('span','calendar-milestone','✦ '+m.title));
 if(d.milestones.length>2)b.append(node('small','','另有 '+(d.milestones.length-2)+' 件纪念'));
 if(d.recorded)b.append(node('small','day-count',d.confirmed?'● '+d.confirmed+' 条自述':'● 已有日程'));
 b.addEventListener('click',async()=>{state.followToday=false;try{await load(d.date);switchNav('today');}catch{}});grid.append(b);}
 const box=$('milestones');box.replaceChildren();const day=c.days.find(d=>d.date===state.date);
 if(!day?.milestones.length)box.append(node('p','muted','这一天还没有特别纪念，平常的一天也很好。'));
 for(const m of day?.milestones||[]){const row=node('article','milestone-item'),content=node('div');content.append(node('h4','',m.title),node('small','muted',m.sourceLabel));if(m.note)content.append(node('p','',m.note));row.append(content);if(m.editable){const edit=node('button','small-button','编辑');edit.onclick=()=>openMilestone(m);row.append(edit);}box.append(row);}
 $('add-milestone').disabled=!state.view?.writable;
}
function openMilestone(m){state.milestone=m||null;$('milestone-date').value=m?.date||state.date;$('milestone-title').value=m?.title||'';$('milestone-note').value=m?.note||'';$('milestone-error').textContent='';$('delete-milestone').hidden=!m;$('milestone-dialog').showModal();}
async function submitMilestone(action='save'){
 const m=state.milestone;$('save-milestone').disabled=true;$('delete-milestone').disabled=true;
 try{await api('milestones',{...(m?{id:m.id,version:m.version}:{}),date:$('milestone-date').value,title:$('milestone-title').value,note:$('milestone-note').value,action});$('milestone-dialog').close();await load();toast(action==='retract'?'纪念已撤回，原记录已留档。':'特别的日子，记下了。');}
 catch(e){$('milestone-error').textContent=e.message;}finally{$('save-milestone').disabled=false;$('delete-milestone').disabled=false;}
}
function selectRecord(r,focus=true){
  state.selected=r;renderTimeline();$('inspector').hidden=false;$('inspector-heading').textContent=`${r.date} ${r.start}–${r.end} · ${r.activity}`;
  const box=node('div','inspector-grid');const source=fillInfo(box,'记录来源',r.source.label);source.append(node('p','',r.source.evidence||'这是一项计划，尚无已送达的生活自述。'));
  const facts=node('div','inspector-block');facts.append(node('h4','','已保存的具体细节'));if(Object.keys(r.details).length){const dl=node('dl');for(const [key,value]of Object.entries(r.details)){const pair=node('div','detail-pair');pair.append(node('dt','',labels[key]||key),node('dd','',value));dl.append(pair);}facts.append(dl);}else facts.append(node('p','','尚未确认具体细节。'));box.append(facts);
  const audit=fillInfo(box,'确认 / 修订时间',timeText(r.source.at));audit.append(node('p','',r.source.reason?'修订原因：'+r.source.reason:r.label));
  $('inspector-body').replaceChildren(box);$('edit-record').disabled=!r.canEdit||!Object.keys(r.details).length;$('retract-record').disabled=!r.canEdit;
  $('restore-record').hidden=!r.canRestore;
  if(focus){$('inspector').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'nearest'});$('inspector').focus({preventScroll:true});}
}
function closeInspector(){state.selected=null;$('inspector').hidden=true;if(state.view)renderTimeline();}
function openEdit(action){
  const r=state.selected;if(action==='restore'?!r?.canRestore:!r?.canEdit)return;state.action=action;$('edit-fields').replaceChildren();$('edit-reason').value='';$('edit-error').textContent='';
  $('edit-title').textContent=({correct:'纠正这条记录的细节',retract:'撤回这条已确认记录',restore:'恢复撤回的记录'})[action];$('edit-description').textContent=action==='correct'?'只修改选中的记录，原内容会保留在修订历史里。持续生活线中的事实不会跟着改写。':action==='restore'?'恢复到上次撤回之前的记录。撤回与恢复的原因都会保留。':'撤回后，这个时段回到未确认的计划；原内容和撤回原因仍保留在修订历史里。';
  if(action==='correct')for(const [key,value]of Object.entries(r.details)){const label=node('label','field-label');label.append(node('span','',labels[key]||key));const input=node('input');input.dataset.field=key;input.value=value;input.maxLength=80;input.required=true;label.append(input);$('edit-fields').append(label);}
  $('save-edit').textContent=({correct:'保存修订',retract:'确认撤回',restore:'确认恢复'})[action];$('edit-dialog').showModal();
}
for(const button of document.querySelectorAll('[data-nav]'))button.addEventListener('click',()=>switchNav(button.dataset.nav));
$('add-milestone').onclick=()=>openMilestone();
$('milestone-form').onsubmit=e=>{e.preventDefault();submitMilestone();};$('delete-milestone').onclick=()=>submitMilestone('retract');
for(const [id,n]of [['prev-month',-1],['next-month',1]])$(id).onclick=()=>{const d=new Date(state.calendar.month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);loadCalendar(d.toISOString().slice(0,7)).catch(e=>toast(e.message));};
$('month-input').onchange=()=>loadCalendar($('month-input').value).catch(e=>toast(e.message));$('this-month').onclick=()=>loadCalendar(state.view.today.slice(0,7)).catch(e=>toast(e.message));
$('timeline-filter').addEventListener('change',renderTimeline);$('show-ended').addEventListener('change',renderPlans);
$('refresh').addEventListener('click',()=>load().catch(()=>{}));$('binding').addEventListener('change',()=>{state.binding=$('binding').value;closeInspector();load().catch(()=>{});});
for(const [id,n]of [['prev-day',-1],['next-day',1]])$(id).addEventListener('click',()=>{state.followToday=false;const d=new Date(state.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);load(d.toISOString().slice(0,10)).catch(()=>{});});
$('date-input').addEventListener('change',()=>{state.followToday=false;load($('date-input').value).catch(()=>{});});$('back-today').addEventListener('click',()=>{state.followToday=true;load().catch(()=>{});});
$('view-current').addEventListener('click',()=>state.view.current&&selectRecord(state.view.current));$('close-inspector').addEventListener('click',closeInspector);
$('edit-record').addEventListener('click',()=>openEdit('correct'));$('retract-record').addEventListener('click',()=>openEdit('retract'));$('qq-help').addEventListener('click',()=>$('help-dialog').showModal());
$('restore-record').addEventListener('click',()=>openEdit('restore'));
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>$(button.dataset.close).close());
for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);$('copy-status').textContent='已复制 '+button.dataset.copy;}catch{$('copy-status').textContent='请在 QQ 输入：'+button.dataset.copy;}});
$('edit-form').addEventListener('submit',async event=>{event.preventDefault();const r=state.selected;$('save-edit').disabled=true;$('edit-error').textContent='';try{
  const details=Object.fromEntries([...$('edit-fields').querySelectorAll('input[data-field]')].map(input=>[input.dataset.field,input.value.trim()]));
  await api('records/revise',{date:r.date,slotId:r.slotId,expectedVersion:r.version,action:state.action,reason:$('edit-reason').value.trim(),...(state.action==='correct'?{details}:{})});
  $('edit-dialog').close();closeInspector();await load();toast(({correct:'细节已修订，原记录已留档。',retract:'记录已撤回，修订历史已保存。',restore:'记录已恢复，恢复原因已留档。'})[state.action]);
}catch(e){$('edit-error').textContent=e.message;}finally{$('save-edit').disabled=false;}});
$('login-form').addEventListener('submit',async event=>{event.preventDefault();state.token=$('token-input').value.trim();$('login-error').textContent='';const submit=$('login-form').querySelector('[type=submit]');submit.disabled=true;try{await connect();sessionStorage.setItem('companion-life-token',state.token);$('token-input').value='';}catch(e){$('login-error').textContent=e.message;}finally{submit.disabled=false;}});
$('login-dialog').addEventListener('cancel',event=>event.preventDefault());$('logout').addEventListener('click',()=>{sessionStorage.removeItem('companion-life-token');state.token='';$('login-dialog').showModal();});
if(state.token)connect().catch(e=>{$('login-error').textContent=e.message;if(!$('login-dialog').open)$('login-dialog').showModal();});else $('login-dialog').showModal();
setInterval(()=>{if(state.token&&state.view&&document.visibilityState==='visible'&&!state.modeEditing&&!document.querySelector('dialog[open]'))load().catch(()=>{});},60000);
