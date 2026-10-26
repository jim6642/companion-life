import crypto from 'node:crypto';

// Life directions, not replacement system personas. No speech, relationship or identity rules.
export const LIFE_MODES = [
  { id:'inherit', name:'沿用原有人设', description:'不附加职业或身份，沿用宿主人设和现有日程。', activities:[] },
  { id:'researcher', name:'研究日常', description:'文献阅读、研究笔记、讨论与休息。', activities:['阅读研究资料，整理待研究的问题','整理研究笔记，推敲一个小问题','读点轻松的书，留些时间休息'] },
  { id:'worker', name:'上班日常', description:'工作安排、午休、下班后的个人生活。', activities:['整理工作事项，专心处理手头任务','继续工作，整理明天要做的事','下班放松，做喜欢的小事'] },
  { id:'university', name:'大学生活', description:'课程、自习、校园活动，兼顾周末休息。', activities:['上课，整理课堂笔记','去图书馆自习，留时间参加校园活动','看看书，和熟悉的人聊聊天'] },
  { id:'primary', name:'小学生活', description:'适龄课程、课间游戏、作业与早睡；不改变原有年龄身份。', activities:['安排适龄基础课程与课间游戏','完成练习，画画或参加体育活动','读适龄故事，收拾书包，早点休息'] },
  { id:'home', name:'居家陪伴', description:'料理、家务、爱好与轻松陪伴；不自动设置恋爱关系。', activities:['慢慢准备早餐，收拾房间','料理家务，做点喜欢的手工或看看书','准备晚饭后放松，留时间聊天'] },
  { id:'zoologist', name:'动物观察', description:'学习动物知识、观察记录、整理自然笔记。', activities:['阅读动物资料，拟定观察问题','观察常见动物，整理自然笔记','画一页观察手账，读点自然故事'] },
  { id:'philosopher', name:'哲学漫游', description:'阅读、思考、散步，记下值得继续讨论的问题。', activities:['读一小段哲学作品，记下疑问','散步思考，写几条自己的想法','翻看随笔，留一点安静的时间'] },
  { id:'custom', name:'自定义生活方向', description:'填写已有角色平时倾向做的事，不改写其性格。', activities:[] },
];
const valid = id => LIFE_MODES.some(m=>m.id===id);
const fail = (message,status=400)=>{throw Object.assign(Error(message),{status,statusCode:status});};
export function modeForDate(data, config, role, date) {
  const entries=data.lifeModes?.[JSON.stringify(role||'default')] || [];
  const selected=entries.filter(e=>e.date<=date).at(-1) || config.mode || {id:'inherit',notes:''};
  return {id:valid(selected.id)?selected.id:'inherit',notes:typeof selected.notes==='string'?selected.notes.slice(0,400):''};
}
export function modeVersion(data,role){return crypto.createHash('sha256').update(JSON.stringify(data.lifeModes?.[JSON.stringify(role||'default')]||[])).digest('hex').slice(0,24);}
export function modeView(data,config,role,date){
  const entries=data.lifeModes?.[JSON.stringify(role||'default')]||[];
  return {active:modeForDate(data,config,role,date),selected:entries.at(-1)||modeForDate(data,config,role,date),version:modeVersion(data,role),options:LIFE_MODES.map(({id,name,description})=>({id,name,description}))};
}
export function saveMode(data,config,role,body,now){
  if(!body||!valid(body.id)||typeof body.notes!=='string'||body.notes.length>400)fail('请选择有效生活模式，补充说明不超过400字');
  if(body.expectedVersion!==modeVersion(data,role))fail('生活模式已更新，请刷新后重试',409);
  if(body.id==='custom'&&!body.notes.trim())fail('请填写自定义生活方向');
  const exists=!!data.days[JSON.stringify([role||'default',now.date])];
  const date=exists?new Date(Date.parse(now.date+'T00:00:00Z')+86400000).toISOString().slice(0,10):now.date;
  const entry={id:body.id,notes:body.id==='inherit'?'':body.notes.trim(),date,at:now.at};
  data.lifeModes||={};const key=JSON.stringify(role||'default');const previous=structuredClone(data.lifeModes[key]||[]);
  data.lifeModes[key]=[...previous.filter(e=>e.date!==date),entry];
  data.revisions.push({type:'life_mode_change',role:role||'default',date:now.date,at:now.at,reason:'修改生活方向；已有日程与事实保留',previous:{title:LIFE_MODES.find(m=>m.id===(previous.at(-1)?.id||'inherit')).name},proposed:{title:LIFE_MODES.find(m=>m.id===body.id).name,date}});
  return {ok:true,effectiveDate:date,mode:modeView(data,config,role,now.date)};
}
export function modeInstruction(mode){
  if(!mode||mode.id==='inherit')return '';
  const m=LIFE_MODES.find(m=>m.id===mode.id);if(!m)return '';
  return `【生活方向：${m.name}】仅为活动安排提供素材，不更改原有人设的身份、年龄、性格、称呼、关系、说话风格与边界；发生冲突以宿主人设为准，跳过不兼容活动，不凭职业模板自称拥有职业或资质。${m.description}${mode.notes?' 用户补充的生活素材：'+mode.notes:''}。已有事实与约定优先，计划不等于已发生。\n`;
}
export function modeSchedule(base,mode,date){
  const m=LIFE_MODES.find(m=>m.id===mode?.id);if(!m?.activities.length)return base;
  const weekend=[0,6].includes(new Date(date+'T00:00:00Z').getUTCDay());
  return base.map(s=>({...s,activity:s.id==='morning'?(weekend&&['worker','university','primary'].includes(m.id)?'周末休息，做点符合原有人设的兴趣活动':m.activities[0]):s.id==='afternoon'?m.activities[1]:s.id==='evening'?m.activities[2]:s.activity}));
}
