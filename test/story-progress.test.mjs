import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createVirtualLife} from '../src/core/virtual-life.js';
test('delivered reading advances without proposal; reflection/plans/other people do not; reload preserves progress',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-progress-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let time='2026-10-26T12:00:00+08:00';
 const opts={file:path.join(dir,'life.json'),config:{enabled:true,stories:{enabled:true,scope:'character'}},clock:()=>new Date(time)};let life=createVirtualLife(opts);
 const first={action:'create',date:'2026-10-26',subject:'character',basis:'own_virtual_experience',title:'《小王子》',category:'reading',progress:'我读到狐狸相遇',nextStep:'明天继续看狐狸',evidence:'《小王子》，我读到狐狸相遇，明天继续看狐狸'};
 assert.equal(life.recordStories('soft',[first],[first.evidence],'private:a').ok,true);time='2026-10-29T12:00:00+08:00';
 for(const msg of ['我刚翻《小王子》又想到狐狸那段','我准备把《小王子》读到结尾','你说我把《小王子》读到结尾','我昨天把《小王子》读到结尾','我没有看《小王子》看到结尾'])assert.deepEqual(life.inferStories('soft',[msg],'private:a'),[]);
 const msg='我刚把《小王子》翻到狐狸和小王子告别那段';const changes=life.inferStories('soft',[msg],'private:a');assert.equal(changes.length,1);
 assert.equal(life.checkStories('soft',changes,[],'private:a').ok,false,'unsent text cannot persist');
 assert.equal(life.recordStories('soft',changes,[msg],'private:a').ok,true);life=createVirtualLife(opts);
 assert.match(life.prompt('soft','最近读书',[],{key:'private:a'}),/告别/);assert.equal(JSON.parse(fs.readFileSync(opts.file)).stories[changes[0].id].nextStep,null);
 assert.deepEqual(life.inferStories('other',[msg],'private:a'),[]);assert.match(life.prompt('soft','最近',[],{key:'private:a'}),/不要每天重复/);
});


