import crypto from 'node:crypto';

const clean = (s, n) => typeof s === 'string' && s.trim().length > 0 && s.length <= n && !/[\r\n]/.test(s);
const dateValid = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const timeValid = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
const shifted = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function checkFuturePlans({ plans = {}, changes, role, key, sentText, ownerText, now }) {
  if (changes === undefined || Array.isArray(changes) && !changes.length) return { ok: true };
  if (!Array.isArray(changes) || changes.length > 3) return { ok: false, error: 'futurePlans 必须为最多3项的数组' };
  const ids = new Set();
  for (const c of changes) {
    if (!c || !['create', 'update', 'cancel', 'complete'].includes(c.action)) return { ok: false, error: '约定 action 无效' };
    if (!clean(c.evidence, 300) || !sentText.join('').includes(c.evidence)) return { ok: false, error: '约定确认须见于本次成功发出的回复' };
    if (!clean(c.requestEvidence, 300) || !ownerText.some(t => t.includes(c.requestEvidence))) return { ok: false, error: '约定须有近期管理员私聊请求作为依据，不能单方面编造约定' };
    if (/如果|假如|开玩笑|没答应|不(?:能|会|想).{0,6}(?:陪|参加|一起)/.test(c.evidence)) return { ok: false, error: '假设或拒绝不能登记为同意约定' };
    const old = c.id ? plans[c.id] : null;
    if (c.action !== 'create' && (!old || old.role !== role || old.key !== key)) return { ok: false, error: '约定ID不存在或不属于当前私聊与角色' };
    if (c.action !== 'create' && old.status !== 'planned') return { ok: false, error: '已完成或取消的约定不能直接改写；需要另建约定' };
    if (c.action !== 'create' && !clean(c.changeReason, 120)) return { ok: false, error: '修改、取消或完成约定须说明 changeReason' };
    if (['create', 'update'].includes(c.action)) {
      if (!dateValid(c.date) || !timeValid(c.time) || !clean(c.title, 80)) return { ok: false, error: '约定需提供有效的绝对日期date、HH:mm时间及title' };
      if (`${c.date} ${c.time}` < `${now.date} ${now.time}`) return { ok: false, error: '约定时间已过去；夜里说凌晨一点通常应记为下一个日期的一点' };
      if (c.keywords !== undefined && (!Array.isArray(c.keywords) || c.keywords.length > 6 || c.keywords.some(w => !clean(w, 24)))) return { ok: false, error: '约定关键词最多6项，每项24字以内' };
      if (c.durationMinutes !== undefined && (!Number.isInteger(c.durationMinutes) || c.durationMinutes < 15 || c.durationMinutes > 360)) return { ok: false, error: '约定时长须为15至360分钟；不明确时省略并使用估计时长' };
    }
    if (c.action === 'complete' && `${old.date} ${old.time}` > `${now.date} ${now.time}`) return { ok: false, error: '未来约定不能提前标完成' };
    const id = c.action === 'create' ? planId(role, key, c) : c.id;
    if (ids.has(id)) return { ok: false, error: '一次请求不能重复修改同一约定' };
    ids.add(id);
    if (c.action === 'create' && plans[id] && plans[id].status !== 'planned') return { ok: false, error: '同一约定已结束，不能以重复创建覆盖' };
  }
  return { ok: true };
}

const planId = (role, key, c) => crypto.createHash('sha256').update(JSON.stringify([role, key, c.date, c.time, c.title])).digest('hex').slice(0, 20);

export function applyFuturePlans({ data, changes, role, key, now, origin }) {
  data.futurePlans ||= {};
  const ids = [];
  for (const c of changes) {
    const id = c.action === 'create' ? planId(role, key, c) : c.id;
    const old = data.futurePlans[id];
    const source = { kind: origin === 'admin_simulation' ? 'admin_simulated_request_and_delivered_acceptance' : 'owner_request_and_delivered_acceptance', requestEvidence: c.requestEvidence, evidence: c.evidence, at: now.at, delivery: 'success' };
    if (c.action === 'create' && old) { ids.push(id); continue; }
    if (old) data.revisions.push({ type: 'future_plan', id, at: now.at, action: c.action, reason: c.changeReason,
      changedAtLocal: { date: now.date, time: now.time },
      previous: { date: old.date, time: old.time, title: old.title, status: old.status, durationMinutes: old.durationMinutes, durationEstimated: old.durationEstimated } });
    data.futurePlans[id] = ['create', 'update'].includes(c.action)
      ? { id, role, key, date: c.date, time: c.time, title: c.title, keywords: c.keywords || old?.keywords || [], status: 'planned',
        durationMinutes: c.durationMinutes ?? old?.durationMinutes ?? 60,
        durationEstimated: c.durationMinutes === undefined ? old?.durationEstimated ?? true : false, source }
      : { ...old, status: c.action === 'cancel' ? 'skipped' : 'completed', ...(c.action === 'complete' ? { completedAtLocal: { date: now.date, time: now.time } } : {}), source };
    ids.push(id);
  }
  return { ok: true, ids, recorded: ids.length, noResend: true };
}

export function futurePlanContext({ plans = {}, role, key, now, topic = '' }) {
  if (!key) return '';
  const general = /约定|约好|答应|陪我|一起看|几点|什么时候|未来安排|之后.*安排|改到|改成|取消|不看了|凌晨|半夜/.test(topic);
  const dates = [...String(topic).matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m => m[0]);
  if (/明天|明早|明晚/.test(topic)) dates.push(shifted(now.date, 1));
  if (/后天/.test(topic)) dates.push(shifted(now.date, 2));
  const selected = Object.values(plans).filter(p => p.role === role && p.key === key).filter(p => {
    const related = p.keywords.some(w => topic.includes(w)) || topic.includes(p.title)
      || ['比赛', '电影', '看书', '散步', '吃饭', '游戏'].some(w => p.title.includes(w) && topic.includes(w));
    if (p.status !== 'planned') return (general || related || dates.includes(p.date)) && /取消|改|之前|完成|看完|约定/.test(topic);
    return p.date === now.date || dates.includes(p.date) || general || related;
  }).sort((a, b) => Number(a.date < now.date) - Number(b.date < now.date) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 3);
  if (!selected.length) return '';
  return `【已保存的约定】\n${selected.map(p => `${p.id} ${p.date} ${p.time} ${p.title}，${p.durationMinutes || 60}分钟${p.durationEstimated !== false ? '（估计，可改）' : ''} [${p.status}${p.status === 'planned' && `${p.date} ${p.time}` < `${now.date} ${now.time}` ? '，时间已过但兑现情况未确认' : ''}]`).join('\n')}\n约定是待办，不代表已经发生；到日不自动算完成，也不代表已设定时提醒。若与普通未确认计划冲突，优先协商约定；修改或取消用原ID，不同时保留旧新安排。\n`;
}
