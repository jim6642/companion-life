import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {createVirtualLife} from '../src/core/virtual-life.js';
import {temp,lifeConfig,event,fixture} from './helpers.mjs';
test('month browsing never creates days; milestones persist, isolate roles, audit and reject stale edits',t=>{
 const file=path.join(temp(t),'life.json'),config=lifeConfig(),clock=()=>new Date('2026-01-10T12:00:00+08:00');
 let life=createVirtualLife({file,config,clock});assert.equal(life.calendar('one','2026-02').days.length,28);assert.equal(fs.existsSync(file),false);
 assert.throws(()=>life.calendar('one','2026-13'));assert.throws(()=>life.calendar('one','2029-01'));
 const a=life.milestone('one',{date:'2026-01-10',title:'第一次一起写歌',note:'手动确认的纪念'});
 assert.equal(life.calendar('other').days[9].milestones.length,0);assert.equal(life.calendar('one').days[9].milestones[0].sourceLabel,'手动纪念');
 assert.throws(()=>life.milestone('one',{id:a.id,version:'stale',date:'2026-01-10',title:'错误修改'}),e=>e.status===409);
 life=createVirtualLife({file,config,clock});assert.equal(life.calendar('one').days[9].milestones[0].title,'第一次一起写歌');
 const b=life.milestone('one',{id:a.id,version:a.version,date:'2026-01-10',title:'第一次合写歌曲'});
 life.milestone('one',{id:a.id,version:b.version,date:'2026-01-10',title:'第一次合写歌曲',action:'retract'});
 assert.equal(life.calendar('one').days[9].milestones.length,0);assert.equal(JSON.parse(fs.readFileSync(file)).revisions.length,3);
});
test('ordinary, tentative and undelivered events are not milestones; delivered completed self-report can be',t=>{
 const life=createVirtualLife({file:path.join(temp(t),'life.json'),config:lifeConfig(),clock:()=>new Date('2026-01-10T12:00:00+08:00')});life.snapshot('one');
 assert.equal(life.record('one',[event()],['早饭吃了小笼包和豆浆'],'private:demo').ok,true);assert.equal(life.calendar('one').days[9].milestones.length,0);
 const e=event({slotId:'morning',details:{milestone:'第一次写完自己的曲子'},evidence:'第一次写完自己的曲子'});
 life.record('one',[{...e,certainty:'tentative'}],[e.evidence],'private:demo');assert.equal(life.calendar('one').days[9].milestones.length,0);
 assert.equal(life.record('one',[e],[e.evidence],'private:demo').ok,true);const m=life.calendar('one').days[9].milestones[0];assert.equal(m.sourceLabel,'聊天自述');assert.equal(m.editable,false);
});
test('calendar APIs require admin; reads do not write; manual edit remains isolated to its binding',async t=>{
 const f=await fixture(t),call=(route,token,body)=>fetch(f.baseUrl+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await call('/life/api/calendar',f.config.bindings[0].token)).status,403);
 const r=await call('/life/api/calendar',f.config.adminToken);assert.equal(r.status,200);assert.equal((await r.json()).calendar.days.length,31);
 const saved=await call('/life/api/milestones',f.config.adminToken,{date:'2026-01-10',title:'特别的一天'});assert.equal(saved.status,200);
 const own=await(await call('/life/api/calendar',f.config.adminToken)).json(),other=await(await call('/life/api/calendar?binding=other',f.config.adminToken)).json();
 assert.equal(own.calendar.days[9].milestones.length,1);assert.equal(other.calendar.days[9].milestones.length,0);
});
