import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createVirtualLife} from '../src/core/virtual-life.js';
import {LIFE_MODES,modeSchedule,modeInstruction} from '../src/core/virtual-life-modes.js';
const setup=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-modes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'life.json');};
test('default inherits host schedule; previews do not create records or change role',t=>{
 const file=setup(t),config={enabled:true,schedule:[{id:'morning',start:'08:00',end:'11:00',activity:'宿主自己的活动'}]};
 const life=createVirtualLife({file,config,clock:()=>new Date('2026-10-26T09:00:00+08:00')});
 assert.equal(life.view('original').lifeMode.selected.id,'inherit');assert.equal(fs.existsSync(file),false);
 assert.equal(life.snapshot('original').slots[0].activity,'宿主自己的活动');assert.doesNotMatch(life.prompt('original'),/【生活方向/);
});
test('switch is persisted for next new day, preserves today, detects stale edits and isolates role',t=>{
 const file=setup(t),config={enabled:true};let now=new Date('2026-10-26T09:00:00+08:00');
 let life=createVirtualLife({file,config,clock:()=>now});const before=life.snapshot('original');const version=life.view('original').lifeMode.version;
 const saved=life.setMode('original',{id:'zoologist',notes:'观察校园里的鸟',expectedVersion:version});assert.equal(saved.effectiveDate,'2026-10-27');
 assert.deepEqual(life.snapshot('original').slots,before.slots);assert.equal(life.view('other').lifeMode.selected.id,'inherit');
 assert.throws(()=>life.setMode('original',{id:'worker',notes:'',expectedVersion:version}),e=>e.status===409);
 life=createVirtualLife({file,config,clock:()=>now});assert.equal(life.view('original').lifeMode.selected.id,'zoologist');
 assert.doesNotMatch(life.prompt('original'),/【生活方向/);now=new Date('2026-10-27T09:00:00+08:00');
 assert.match(life.snapshot('original').slots.find(s=>s.id==='morning').activity,/动物/);
 assert.match(life.prompt('original'),/不更改原有人设/);assert.match(life.prompt('original'),/观察校园里的鸟/);
 const fresh=life.view('original').lifeMode.version;assert.throws(()=>life.setMode('original',{id:'custom',notes:'',expectedVersion:fresh}));
});
test('every preset has sorted same-day slots without confirmed facts; custom is bounded material',t=>{
 const file=setup(t),life=createVirtualLife({file,config:{enabled:true},clock:()=>new Date('2026-10-26T07:00:00+08:00')});
 const base=life.snapshot('x').slots;
 for(const m of LIFE_MODES){const rows=modeSchedule(base,m,'2026-10-27');assert.equal(rows.length,base.length);assert.ok(rows.every((r,i)=>r.start===base[i].start&&r.end===base[i].end&&r.confidence==='plan'));}
 assert.match(modeInstruction({id:'home'}),/不自动设置恋爱关系/);assert.match(modeInstruction({id:'primary'}),/年龄/);
 assert.equal(modeInstruction({id:'inherit'}),'');
});
