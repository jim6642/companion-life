import crypto from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const version=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0,24);
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
export function monthView(data,role,month,now){
 role=role||'default';month=month||now.date.slice(0,7);
 if(!/^\d{4}-\d{2}$/.test(month)||!validDate(month+'-01')||Math.abs(Date.parse(month+'-01')-Date.parse(now.date))>367*86400000)fail('请选择一年以内的月份');
 const count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
 const days=Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0'),day=data.days[JSON.stringify([role,date])];
 const milestones=Object.values(data.milestones||{}).filter(r=>r.role===role&&r.date===date&&r.status!=='retracted').map(r=>({...r,version:version(r),sourceLabel:'手动纪念',editable:true}));
 for(const s of day?.slots||[])if(s.confidence==='virtual_self_report'&&s.status==='completed'&&s.source?.delivery==='success'&&typeof s.details?.milestone==='string')milestones.push({id:'event:'+s.id,title:s.details.milestone,date,sourceLabel:'聊天自述',editable:false});
 return {date,recorded:!!day,confirmed:(day?.slots||[]).filter(s=>s.confidence==='virtual_self_report').length,milestones};});
 return {month,today:now.date,days};
}
export function saveMilestone(data,role,body,now){
 role=role||'default';if(!body||!validDate(body.date)||Math.abs(Date.parse(body.date)-Date.parse(now.date))>367*86400000)fail('纪念日期无效或超出一年范围');
 const all=data.milestones||{},old=body.id?all[body.id]:null;
 if(body.id&&(!old||old.role!==role))fail('纪念不存在',404);
 if(old&&body.version!==version(old))fail('记录已变化，请刷新后再修改',409);
 if(body.action&&!['save','retract'].includes(body.action))fail('无效操作');
 if(typeof body.title!=='string'||!body.title.trim()||body.title.length>40||typeof(body.note??'')!=='string'||(body.note||'').length>240)fail('标题限40字，说明限240字');
 if(!old&&Object.values(all).filter(r=>r.role===role&&r.date===body.date&&r.status!=='retracted').length>=8)fail('每天最多8件纪念');
 const next={id:old?.id||crypto.randomUUID(),role,date:body.date,title:body.title.trim(),note:body.note||'',source:'operator',status:body.action==='retract'?'retracted':'active',createdAt:old?.createdAt||now.at,updatedAt:now.at};
 data.milestones||={};data.milestones[next.id]=next;data.revisions||=[];data.revisions.push({type:'life_milestone',role,date:body.date,at:now.at,reason:body.action==='retract'?'撤回纪念':'保存纪念',previous:old||null,proposed:next});
 return {ok:true,id:next.id,version:version(next)};
}
