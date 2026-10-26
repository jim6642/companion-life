import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVirtualLife } from '../src/core/virtual-life.js';
import { createLifeSceneCompanion } from '../src/core/virtual-life-proactive.js';
import { temp, lifeConfig, event } from './helpers.mjs';

test('A: local time and day boundaries; elapsed plan is not an experience', t => {
  let now = new Date('2026-01-10T09:30:00+08:00');
  const life = createVirtualLife({ file: path.join(temp(t), 'life.json'), config: lifeConfig(), clock: () => now });
  const state = life.snapshot('student');
  assert.equal(state.slots.find(s => s.status === 'active').activity, '上高数课');
  assert.equal(state.slots[0].status, 'planned');
  assert.equal(state.slots[0].pendingConfirmation, true);
  assert.match(life.prompt('student'), /09:30/);
  now = new Date('2026-01-11T01:00:00+08:00');
  assert.equal(life.snapshot('student').date, '2026-01-11');
  assert.equal(life.snapshot('student').slots.filter(s => s.status === 'active').length, 0);
});
test('B/C/D: delivered evidence, consistent breakfast, restart and conflict audit', t => {
  const file = path.join(temp(t), 'life.json');
  const opts = { file, config: lifeConfig(), clock: () => new Date('2026-01-10T09:30:00+08:00') };
  let life = createVirtualLife(opts);
  assert.equal(life.record('student', [event()], ['not delivered evidence'], 'demo').ok, false);
  assert.equal(life.record('student', [event()], [event().evidence], 'demo').ok, true);
  life = createVirtualLife(opts);
  assert.match(life.prompt('student', '早饭吃什么'), /小笼包/);
  const changed = event({ details: { food: '面包' }, evidence: '早饭吃了面包' });
  assert.equal(life.record('student', [changed], [changed.evidence], 'demo').code, 'fact_conflict');
  const stored = JSON.parse(fs.readFileSync(file));
  assert.equal(stored.revisions.at(-1).resolution, 'rejected');
  assert.equal(life.snapshot('student').slots[0].details.food, '小笼包');
  assert.doesNotMatch(life.prompt('other-role', '早饭'), /小笼包/);
});
test('E: activity change leaves only one active scene and audits change', t => {
  const life = createVirtualLife({ file: path.join(temp(t), 'life.json'), config: lifeConfig(), clock: () => new Date('2026-01-10T09:30:00+08:00') });
  const e = event({ slotId: 'morning', status: 'active', activity: '去图书馆', changeReason: '今天调整安排', details: { place: '图书馆' }, evidence: '现在去图书馆' });
  assert.equal(life.record('student', [e], [e.evidence], 'demo').ok, true);
  const active = life.snapshot('student').slots.filter(s => s.status === 'active');
  assert.equal(active.length, 1); assert.equal(active[0].activity, '去图书馆');
});
test('tentative, hypotheses, unrelated people and future completion are rejected as facts', t => {
  const life = createVirtualLife({ file: path.join(temp(t), 'life.json'), config: lifeConfig(), clock: () => new Date('2026-01-10T09:30:00+08:00') });
  for (const e of [event({ subject: 'user' }), event({ evidence: '如果吃小笼包和豆浆' }), event({ slotId: 'afternoon' })]) assert.equal(life.record('student', [e], [e.evidence], 'demo').ok, false);
  const tentative = event({ certainty: 'tentative' });
  assert.equal(life.record('student', [tentative], [tentative.evidence], 'demo').ok, true);
  assert.deepEqual(life.snapshot('student').slots[0].details, {});
  assert.doesNotMatch(life.prompt('student', '早餐'), /"food":"小笼包"/);
});
test('corrupt file preserved; disabled mode makes no data', t => {
  const dir = temp(t), file = path.join(dir, 'life.json'); fs.writeFileSync(file, '{broken');
  const life = createVirtualLife({ file, config: lifeConfig() });
  assert.throws(() => life.snapshot('student'));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  const disabled = createVirtualLife({ file: path.join(dir, 'off.json'), config: { enabled: false } });
  assert.equal(disabled.prompt('student'), ''); assert.equal(fs.existsSync(path.join(dir, 'off.json')), false);
});
test('weekly local summaries after seven complete days keep source details', t => {
  const file = path.join(temp(t), 'life.json'); let now = new Date('2026-01-10T09:30:00+08:00');
  const life = createVirtualLife({ file, config: lifeConfig(), clock: () => now });
  life.record('student', [event()], [event().evidence], 'demo');
  now = new Date('2026-01-16T09:30:00+08:00'); life.snapshot('student');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file)).weeklySummaries || {}).length, 0);
  now = new Date('2026-01-17T09:30:00+08:00'); life.snapshot('student');
  const data = JSON.parse(fs.readFileSync(file));
  assert.equal(Object.values(data.weeklySummaries)[0].eventCount, 1);
  assert.match(JSON.stringify(data.days), /小笼包/);
});
test('future commitments need delivered acceptance and owner request; gated and scoped', t => {
  const life = createVirtualLife({ file: path.join(temp(t), 'life.json'), config: lifeConfig(), clock: () => new Date('2026-01-10T09:30:00+08:00') });
  const change = { action: 'create', date: '2026-01-12', time: '01:00', title: '一起看电影', keywords: ['电影'], evidence: '好，后天一点陪你看电影', requestEvidence: '后天一点陪我' };
  assert.equal(life.recordPlans('student', [change], [change.evidence], [], 'demo').ok, false);
  const result = life.recordPlans('student', [change], [change.evidence], [change.requestEvidence], 'demo');
  assert.equal(result.ok, true);
  assert.doesNotMatch(life.prompt('student', '你好', [], { key: 'demo' }), /一起看电影/);
  assert.match(life.prompt('student', '电影约定', [], { key: 'demo' }), /一起看电影/);
  assert.doesNotMatch(life.prompt('student', '电影约定', [], { key: 'other' }), /一起看电影/);
  const cancel = { action: 'cancel', id: result.ids[0], changeReason: '用户取消', evidence: '好，取消约定', requestEvidence: '取消约定' };
  assert.equal(life.recordPlans('student', [cancel], [cancel.evidence], [cancel.requestEvidence], 'demo').ok, true);
  assert.match(life.prompt('student', '取消约定', [], { key: 'demo' }), /skipped/);
});
test('proactive: baseline, transition, durable dedup and no retry on unknown outcome', async t => {
  const dir = temp(t); let now = Date.parse('2026-01-10T13:59:00+08:00'), calls = 0;
  const config = { ...lifeConfig(), proactive: { enabled: true } };
  const life = createVirtualLife({ file: path.join(dir, 'life.json'), config, clock: () => new Date(now) });
  const opts = { file: path.join(dir, 'scenes.json'), config, life, clock: () => now, environment: () => ({ key: 'demo', role: 'student', ready: true, busy: false, blocked: false, lastInteractionAt: 0 }), dispatch: async () => { calls++; throw Error('unknown'); } };
  const controller = createLifeSceneCompanion(opts);
  assert.equal((await controller.tick()).skipped, 'baseline');
  now = Date.parse('2026-01-10T14:01:00+08:00');
  assert.equal((await controller.tick()).attempted, true);
  await controller.tick(); await createLifeSceneCompanion(opts).tick(); assert.equal(calls, 1);
});

test('shared core scope normalizes submitted paraphrases and retrieves a title without brackets', t => {
  const life = createVirtualLife({ file: path.join(temp(t), 'life.json'), config: { ...lifeConfig(), stories: { enabled: true, scope: 'character' } }, clock: () => new Date('2026-01-10T09:30:00+08:00') });
  const c = { action: 'create', date: '2026-01-10', subject: 'character', basis: 'own_virtual_experience', title: '《小王子》', category: 'reading', progress: '读到小王子和狐狸相遇', nextStep: '明天继续读书', facts: { book: '《小王子》' }, evidence: '《小王子》读到他和狐狸相遇那段了。明天准备接着看。' };
  const result = life.recordStories('student', [c], [c.evidence], 'private:test');
  assert.equal(result.ok, true); assert.equal(result.repairedFields, 2);
  const context = life.prompt('student', '小王子看到哪了', [], { key: 'group:test' });
  assert.match(context, /狐狸相遇那段了/); assert.match(context, /明天准备接着看/);
  assert.doesNotMatch(life.prompt('another', '小王子', [], { key: 'group:test' }), /连续生活线/);
});
