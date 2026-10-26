import { modeForDate, modeSchedule, modeView } from './virtual-life-modes.js';
import crypto from 'node:crypto';
import { projectLifeCalendar } from './virtual-life-calendar.js';
import { listLifeStories, lifeStoryKey } from './virtual-life-stories.js';
const minute = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const clean = (s, n) => typeof s === 'string' && s.trim() && s.length <= n && !/[\r\n]/.test(s);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, statusCode: status }); };
export const recordVersion = record => crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 24);
export const shiftLifeDate = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export function validateLifeDate(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) fail('请选择有效日期');
  if (Math.abs(Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) > 366 * 86400000) fail('一次可查看前后一年内的日期');
  return date;
}
function sourceView(source) {
  if (!source) return { label: '日程计划', kind: 'plan', evidence: '', at: null };
  const label = source.restoration ? '管理员恢复' : source.correction ? '管理员纠正' : source.kind === 'operator_retraction' ? '管理员撤回'
    : source.kind?.includes('simulated') ? '管理端授权代发' : source.kind === 'owner_request_and_delivered_acceptance' ? '私聊约定'
    : source.conversation?.startsWith('group:') ? '群聊自述' : source.conversation?.startsWith('private:') ? '私聊自述' : '角色自述';
  return { label, kind: source.kind || 'record', evidence: source.evidence || '', at: source.restoration?.at || source.correction?.at || source.at || null,
    reason: source.restoration?.reason || source.correction?.reason || source.reason || '',
    correction: source.correction ? { reason: source.correction.reason, at: source.correction.at } : null };
}
const fieldLabels = { food:'食物',drink:'饮料',book:'书名',note:'细节',feeling:'感受',place:'地点',course:'课程',topic:'话题' };
function historySnapshot(value) {
  if (!value) return null;
  if (typeof value === 'string') return { 内容: value };
  const result = {};
  if (value.activity || value.title) result.活动 = value.activity || value.title;
  if(value.note)result.说明=value.note;
  if (value.date) result.日期 = value.date;
  if (value.start || value.time) result.时间 = value.start ? `${value.start}–${value.end}` : value.time;
  if (value.durationMinutes) result.时长 = value.durationMinutes + '分钟';
  if (value.status) result.状态 = ({planned:'计划',active:'自述进行中',completed:'已确认完成',skipped:'已取消 / 跳过'})[value.status] || value.status;
  if (value.details) result.细节 = Object.fromEntries(Object.entries(value.details).map(([k,v])=>[fieldLabels[k] || k,v]));
  return Object.keys(result).length ? result : null;
}

/** Bounded, read-only projection. Browsing tomorrow must not create tomorrow's day. */
export function buildLifeView({ data, config, role, now, key, date = now.date, writable = true, template = [], name = role || '伙伴', admin = false }) {
  validateLifeDate(date, now.date);
  role ||= 'default';
  const stored = data.days[JSON.stringify([role, date])];
  const preview = !stored && date >= now.date;
  const original = stored?.slots || (preview ? modeSchedule(config.roleSchedules?.[role] || config.schedule || template, modeForDate(data,config,role,date),date).map(s => ({ id:s.id, start:s.start, end:s.end, activity:s.activity, status:'planned', details:{}, confidence:'plan' })) : []);
  const currentMinute = minute(now.time), isToday = date === now.date;
  let slots = original.map(s => ({ ...structuredClone(s), details: { ...s.details }, confidence: s.confidence || 'plan',
    status: ['completed', 'skipped'].includes(s.status) ? s.status : isToday && currentMinute >= minute(s.start) && currentMinute < minute(s.end) ? 'active' : 'planned',
    pendingConfirmation: date < now.date || isToday && currentMinute >= minute(s.end) }));
  if (config.calendar?.enabled) slots = projectLifeCalendar({ data, role, date, time: isToday ? now.time : date < now.date ? '24:00' : '00:00', slots, ownerKey: key });
  const timeline = slots.map((s, index) => {
    const base = stored?.slots.find(row => row.id === (s.baseSlotId || s.id));
    const confirmed = s.confidence === 'virtual_self_report';
    const state = s.status === 'skipped' ? 'skipped' : confirmed && s.status === 'completed' ? 'completed'
      : isToday && s.status === 'active' ? confirmed ? 'active_reported' : 'active_plan'
      : s.pendingConfirmation && !confirmed ? 'unconfirmed' : confirmed ? 'reported' : 'planned';
    const labels = { skipped: '已调整 / 跳过', completed: '已确认', active_reported: '自述进行中', active_plan: '当前计划', unconfirmed: '已过时段·未确认', reported: '已有自述', planned: '计划' };
    const appointment = s.appointment ? Object.values(data.futurePlans || {}).find(p => p.id === s.appointmentId || s.id.startsWith(`appointment:${p.id}`)) : null;
    return { id: `${date}:${s.id}:${index}`, slotId: base?.id || null, date, start: s.start, end: s.end,
      activity: s.activity, state, label: labels[state], appointment: !!s.appointment, estimated: !!s.appointment && s.durationEstimated,
      details: s.details || {}, source: (()=>{const source=s.appointment && appointment?.key === key ? appointment.source : s.source;const result=sourceView(source);if(!admin&&source?.conversation&&source.conversation!==key)result.evidence='';return result;})(),
      canEdit: !!base && !s.appointment && !!base.source && base.confidence === 'virtual_self_report' && writable,
      canRestore: !!base && !s.appointment && base.source?.kind === 'operator_retraction' && writable,
      version: base ? recordVersion(base) : null, preview };
  });
  const stories = config.stories?.enabled ? listLifeStories(data, role, lifeStoryKey(config, key)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12)
    .map(s => ({ id: s.id, title: s.title, category: s.category, status: s.status, revision: s.revision, progress: s.progress,
      nextStep: s.nextStep, facts: s.facts, updatedDate: s.updatedDate, history: s.history.slice(-5).map(h => ({ date: h.date, progress: h.progress, action: h.action })) })) : [];
  const plans = Object.values(data.futurePlans || {}).filter(p => p.role === role && p.key === key)
    .map(p => ({ id: p.id, date: p.date, time: p.time, title: p.title, durationMinutes: p.durationMinutes || 60, estimated: p.durationEstimated !== false,
      overdue: p.status === 'planned' && `${p.date} ${p.time}` < `${now.date} ${now.time}`, status: p.status, source: sourceView(p.source) }))
    .sort((a,b) => (a.status === 'planned' ? a.overdue ? 1 : 0 : 2) - (b.status === 'planned' ? b.overdue ? 1 : 0 : 2) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0,40);
  const revisions = (data.revisions || []).filter(r => (r.role === role || r.type === 'life_story' && data.stories?.[r.id]?.role === role && data.stories[r.id].key === lifeStoryKey(config,key)) && (!r.date || r.date === date) && r.type !== 'future_plan').slice(-24)
    .map(r => ({ type: r.type || 'life_event', at: r.at,
      title: (r.type === 'life_mode_change' ? '生活方向调整' : r.type === 'life_milestone' ? '特别纪念 · '+(r.proposed?.title||r.previous?.title||'') : null) || r.previous?.activity || stored?.slots.find(s=>s.id===r.slotId)?.activity || data.stories?.[r.id]?.title || '生活记录',
      reason: r.reason || ({rejected:'冲突候选已拒绝',plan_changed:'计划已调整'})[r.resolution] || '记录修订',
      previous: historySnapshot(r.previous || r.previousProgress), next: historySnapshot(r.proposed) }));
  const calendarChanges = (data.calendarChanges || []).filter(r => r.role === role && r.key === key && (r.next?.date === date || r.previous?.date === date)).slice(-16)
    .map(r => ({ type: 'calendar', at: r.at, title: r.next?.title || r.previous?.title, reason: r.reason, previous: historySnapshot(r.previous), next: historySnapshot(r.next) }));
  const history = [...revisions, ...calendarChanges].reverse().sort((a,b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
  const roleDays = Object.values(data.days).filter(d => d.role === role);
  return structuredClone({ date, today: now.date, time: now.time, serverAt: now.at, timeZone: config.timeZone || 'Asia/Shanghai', enabled: config.enabled === true,
    lifeMode: { ...modeView(data,config,role,now.date), active: data.days[JSON.stringify([role,now.date])] ? (data.days[JSON.stringify([role,now.date])].lifeMode || {id:'inherit',notes:''}) : modeForDate(data,config,role,now.date) },
    profile: { name, role, subtitle: '记录当下 · 陪伴日常 · 一起成为更好的故事' },
    preview, planningState: stored?.planning?.status || (preview ? 'preview' : stored ? 'template' : 'empty'),
    current: isToday ? timeline.find(s => ['active_plan', 'active_reported'].includes(s.state)) || null : null,
    timeline, stories, plans, history, availableDates: roleDays.map(d => d.date).sort(), writable,
    stats: { confirmed: timeline.filter(s => ['completed','active_reported','reported'].includes(s.state)).length,
      activeStories: stories.filter(s => s.status === 'ongoing').length, appointments: plans.filter(p => p.status === 'planned' && !p.overdue).length, recordedDays: roleDays.length },
    settings: { dailyPlanning: !!config.dailyPlanning?.enabled, stories: !!config.stories?.enabled, calendar: !!config.calendar?.enabled,
      weeklySummary: !!config.weeklySummary?.enabled, proactive: !!config.proactive?.enabled, sharedStories: config.stories?.scope === 'character' },
  });
}

export function reviseLifeRecord({ data, role, body, now }) {
  validateLifeDate(body.date, now.date);
  if (!['correct', 'retract', 'restore'].includes(body.action) || !clean(body.reason, 180)) fail('请填写操作和修订原因');
  const slot = data.days[JSON.stringify([role || 'default', body.date])]?.slots.find(s => s.id === body.slotId);
  if (!slot || !slot.source || (body.action === 'restore' ? slot.source.kind !== 'operator_retraction' : slot.confidence !== 'virtual_self_report')) fail('这条记录没有可修订或恢复的细节', 409);
  if (body.expectedVersion !== recordVersion(slot)) fail('记录刚刚发生变化，请刷新后再操作', 409);
  const previous = structuredClone(slot);
  if (body.action === 'correct') {
    const details = body.details;
    if (!details || typeof details !== 'object' || Array.isArray(details) || Object.keys(details).length > 12 || !Object.keys(details).length) fail('请保留至少一项具体细节');
    for (const [k,v] of Object.entries(details)) if (!clean(k,24) || ['__proto__','constructor','prototype'].includes(k) || !clean(v,80)) fail('细节名称或内容过长或无效');
    slot.details = { ...details };
    slot.source = { ...slot.source, correction: { at: now.at, reason: body.reason, kind: 'operator_verified', id: crypto.randomUUID() } };
    delete slot.source.restoration;
  } else if (body.action === 'retract') {
    slot.details = {}; slot.confidence = 'plan'; slot.status = 'planned';
    slot.source = { kind: 'operator_retraction', at: now.at, reason: body.reason, id: crypto.randomUUID() };
  } else {
    const entry = [...data.revisions].reverse().find(r=>r.type === 'operator_retraction' && r.role === (role || 'default') && r.date === body.date && r.slotId === slot.id && r.at === slot.source.at);
    if (!entry?.previous) fail('找不到可恢复的原记录，请核对修订历史',409);
    for (const key of Object.keys(slot)) delete slot[key];
    Object.assign(slot, structuredClone(entry.previous));
    slot.source = { ...slot.source, restoration: { at: now.at, reason: body.reason, id: crypto.randomUUID() } };
  }
  data.revisions.push({ type: ({correct:'operator_correction',retract:'operator_retraction',restore:'operator_restore'})[body.action], role: role || 'default', date: body.date,
    slotId: slot.id, at: now.at, reason: body.reason, previous, proposed: structuredClone(slot) });
  return { ok: true, action: body.action, version: recordVersion(slot), noMessageSent: true };
}

export function parseLifeCommand(text, today) {
  const match = /^\/(生活|约定)(?:\s+(.*))?$/.exec(String(text).trim());
  if (!match) return null;
  if (match[1] === '约定') return match[2] ? { help: true } : { type: 'plans', date: today };
  const input = match[2] || '今天';
  const date = input === '今天' ? today : input === '明天' ? shiftLifeDate(today, 1) : input === '昨天' ? shiftLifeDate(today,-1) : input;
  try { validateLifeDate(date, today); return { type: 'day', date }; } catch { return { help: true }; }
}
export function formatLifeReply(view, type = 'day') {
  if (type === 'plans') {
    const plans = view.plans.filter(p => p.status === 'planned').slice(0,6);
    return `我们的约定\n${plans.map((p,i) => `${i+1}. ${p.date} ${p.time} · ${p.title}（${p.durationMinutes}分钟${p.estimated ? '，暂估' : ''}）${p.overdue ? ' · 时间已过，兑现未确认' : ''}`).join('\n') || '目前没有待办约定。'}\n\n想改期或取消，直接告诉我具体是哪一项就好。`;
  }
  const icons = { completed:'✓', active_reported:'●', active_plan:'◉', planned:'○', unconfirmed:'◷', skipped:'－', reported:'◇' };
  const lines = view.timeline.slice(0,14).map(s => `${icons[s.state]} ${s.start}–${s.end} ${s.activity}〔${s.label}〕`);
  const stories = view.stories.filter(s=>s.status==='ongoing').slice(0,2);
  return `${view.profile.name}的生活手记 · ${view.date}\n${view.preview ? '这天尚未构思日程，先显示模板预览；已有约定已列入。\n' : ''}${lines.join('\n') || '这天还没有生活记录。'}${stories.length ? '\n\n持续中的事：\n'+stories.map(s=>`· ${s.title}：${s.progress}`).join('\n') : ''}\n\n◉是当前计划，不代表已经确认发生。`.slice(0,1800);
}
