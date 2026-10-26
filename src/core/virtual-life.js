import { modeForDate, modeSchedule, modeInstruction, saveMode } from './virtual-life-modes.js';
import fs from 'node:fs';
import path from 'node:path';
import { buildWeeklyLifeSummaries } from './virtual-life-weekly.js';
import { selectLifeDetails } from './virtual-life-detail-gate.js';
import { checkFuturePlans, applyFuturePlans, futurePlanContext } from './future-life-plans.js';
import { checkCalendarChanges, projectLifeCalendar, calendarEventConflict } from './virtual-life-calendar.js';
import { buildLifeView, reviseLifeRecord } from './virtual-life-view.js';
import { checkLifeStories, applyLifeStories, storyContext, lifeStoryKey, prepareLifeStories } from './virtual-life-stories.js';

const DEFAULT_SCHEDULE = [
  { id: 'breakfast', start: '08:00', end: '08:30', activity: '吃早饭' },
  { id: 'morning', start: '08:30', end: '11:30', activity: '阅读、处理自己的安排' },
  { id: 'lunch', start: '11:30', end: '13:00', activity: '午饭、休息' },
  { id: 'afternoon', start: '14:00', end: '17:00', activity: '学习或自由活动' },
  { id: 'evening', start: '19:00', end: '22:00', activity: '娱乐、阅读' },
];
const STATES = new Set(['planned', 'active', 'completed', 'skipped']);
const minute = value => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('时间必须为 HH:mm');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
};
const bounded = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[\r\n]/.test(s);
const FIELD_ALIASES = { 食物: 'food', 早餐: 'food', 饮料: 'drink', 地点: 'place', 细节: 'note' };
const fieldName = k => Object.hasOwn(FIELD_ALIASES, k) ? FIELD_ALIASES[k] : k;
const topicWords = text => (String(text).match(/早餐|早饭|午餐|午饭|晚餐|晚饭|上课|高数|学习|阅读|娱乐|豆浆|小笼包/g) || [])
  .map(w => ({ 早饭: '早餐', 午饭: '午餐', 晚饭: '晚餐' }[w] || w));

/** One bridge process owns this file. No model/API calls and no timers. */
export function createVirtualLife({ file, config = {}, clock = () => new Date(), onError = () => {} }) {
  let data = { version: 1, days: {}, revisions: [] };
  let writable = true;
  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !data.days || !Array.isArray(data.revisions)) throw Error('生活状态文件格式不兼容');
    }
  } catch (e) { writable = false; onError(`生活状态暂停写入：${e.message}`); }
  const enabled = () => config.enabled === true;
  const now = () => {
    const d = clock();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, at: d.toISOString() };
  };
  function save() {
    if (!writable) throw Error('生活状态文件不可写，原文件已保留');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
  function day(role) {
    const t = now();
    const key = JSON.stringify([role || 'default', t.date]);
    if (!data.days[key]) {
      const lifeMode = modeForDate(data, config, role, t.date);
      const schedule = modeSchedule(config.roleSchedules?.[role] || config.schedule || DEFAULT_SCHEDULE, lifeMode, t.date);
      if (!Array.isArray(schedule) || schedule.length > 16) throw Error('日程模板格式错误');
      let lastEnd = -1;
      const ids = new Set();
      const slots = schedule.map(s => {
        if (!bounded(s.id, 40) || ids.has(s.id) || !bounded(s.activity, 60)
          || minute(s.start) < lastEnd || minute(s.end) <= minute(s.start)) throw Error('日程必须按时间排序且不能重叠');
        ids.add(s.id); lastEnd = minute(s.end);
        return { id: s.id, start: s.start, end: s.end, activity: s.activity, status: 'planned', details: {}, confidence: 'plan' };
      });
      data.days[key] = { date: t.date, role: role || 'default', slots, lifeMode, createdAt: t.at };
      save();
    }
    return data.days[key];
  }
  function snapshot(role, options = {}) {
    if (!enabled()) return null;
    const t = now(), d = day(role), m = minute(t.time);
    if (config.weeklySummary?.enabled === true && writable) {
      // Maintenance is auxiliary: a failed summary must never block a chat reply.
      const previous = data.weeklySummaries;
      try {
        const summaries = buildWeeklyLifeSummaries(data.days, t.date, previous);
        if (JSON.stringify(summaries) !== JSON.stringify(previous || {})) {
          data.weeklySummaries = summaries;
          save();
        }
      } catch (e) { data.weeklySummaries = previous; onError(`周总结暂未保存，聊天照常：${e.message}`); }
    }
    const slots = d.slots.map(s => ({ ...s,
      // Time advances a plan, never confirms that it actually happened.
      status: ['completed', 'skipped'].includes(s.status) ? s.status
        : m >= minute(s.start) && m < minute(s.end) ? 'active' : 'planned',
      pendingConfirmation: m >= minute(s.end) && !['completed', 'skipped'].includes(s.status),
    }));
    return { ...t, role: d.role, writable, slots: config.calendar?.enabled === true ? projectLifeCalendar({ data, role: d.role, date: t.date, time: t.time, slots, ownerKey: options.key }) : slots };
  }
  function check(role, events, sentText) {
    if (!enabled()) return { ok: true, disabled: true };
    if (events === undefined || Array.isArray(events) && !events.length) return { ok: true };
    if (!Array.isArray(events)) return { ok: false, error: 'lifeEvents 必须是数组' };
    if (!writable) return { ok: false, error: '生活文件不可写；请省略 lifeEvents，正常回复即可' };
    if (events.length > 3) return { ok: false, error: '每次最多记录3个生活事件' };
    const t = now(), d = day(role), seen = new Set();
    for (const e of events) {
      const slot = d.slots.find(s => s.id === e.slotId);
      if (!slot || e.date !== t.date || seen.has(e.slotId) || !STATES.has(e.status)) return { ok: false, error: '事件日期、时段或状态无效' };
      seen.add(e.slotId);
      if (e.subject !== 'character' || e.basis !== 'own_virtual_experience' || !['settled', 'tentative'].includes(e.certainty)) return { ok: false, error: '只能记录角色自己的虚拟生活，且须注明确认程度' };
      if (!bounded(e.evidence, 300) || !sentText.join('').includes(e.evidence)) return { ok: false, error: '证据必须是本次成功发送文本中的连续原文' };
      if (/如果|假如|要是|比如|开玩笑|假装|梦到|你说|你吃|他说|她说|你早饭|你早餐/.test(e.evidence)) return { ok: false, error: '假设、引用他人、玩笑不能确认成生活事实' };
      if (!e.details || typeof e.details !== 'object' || Array.isArray(e.details) || Object.keys(e.details).length > 6) return { ok: false, error: 'details 必须为最多6项的简短键值表' };
      for (const [k, v] of Object.entries(e.details)) {
        if (!bounded(k, 24) || ['__proto__', 'constructor', 'prototype'].includes(k) || !bounded(v, 80) || !e.evidence.includes(v)) return { ok: false, error: '生活细节必须直接见于证据原文' };
        const canonical = fieldName(k);
        if (slot.details[canonical] !== undefined && slot.details[canonical] !== v && e.certainty === 'settled') {
          const conflict = { date: t.date, role: d.role, slotId: slot.id, field: canonical, existing: slot.details[canonical], proposed: v, at: t.at, resolution: 'rejected' };
          const last = data.revisions.at(-1);
          if (!last || JSON.stringify({ ...last, at: '' }) !== JSON.stringify({ ...conflict, at: '' })) { data.revisions.push(conflict); save(); }
          return { ok: false, code: 'fact_conflict', error: `生活事实冲突：${canonical}已有“${slot.details[canonical]}”，不能改成“${v}”。请遵循已有事实，不要重发已成功的消息。` };
        }
      }
      if (e.certainty === 'settled') {
        if (config.calendar?.enabled === true && calendarEventConflict({ data, role: d.role, date: t.date, slot, status: e.status, now: t })) return { ok: false, error: '该时段被已接受约定占用，不能把原计划确认成正在进行或全部完成；约定兑现请用futurePlans.complete' };
        if (e.status === 'completed' && /想吃|准备|打算|还没|没吃|可能|也许/.test(e.evidence)) return { ok: false, error: '未发生或不确定的陈述不能标记 completed' };
        if (e.status === 'completed' && minute(t.time) < minute(slot.end)) return { ok: false, error: '时段尚未结束，不能确认完成；可标 active 或 tentative' };
        if (e.status === 'active' && (minute(t.time) < minute(slot.start) || minute(t.time) >= minute(e.end || slot.end))) return { ok: false, error: 'active 必须覆盖当前时间' };
        if (slot.status === 'completed' && e.status !== 'completed') return { ok: false, error: '已确认完成的事件不能回退，修订须由操作者核对' };
        if (slot.status === 'completed' && (e.activity && e.activity !== slot.activity || e.end && e.end !== slot.end)) {
          data.revisions.push({ date: t.date, role: d.role, slotId: slot.id, at: t.at, resolution: 'rejected', reason: 'attempted completed event rewrite', proposed: { activity: e.activity, end: e.end } });
          save();
          return { ok: false, code: 'fact_conflict', error: '已完成经历的活动和时间不能改写，请遵循原记录' };
        }
        if (e.activity && !bounded(e.activity, 60)) return { ok: false, error: '活动名称无效' };
        if (e.activity && e.activity !== slot.activity && !bounded(e.changeReason, 100)) return { ok: false, error: '更改计划需要 changeReason' };
        if (e.activity && e.activity !== slot.activity && !e.evidence.includes(e.activity)) return { ok: false, error: '新活动须见于证据原文' };
        if (e.end && (minute(e.end) <= minute(slot.start) || (e.status === 'active' && minute(e.end) <= minute(t.time)))) return { ok: false, error: '结束时间无效' };
      }
    }
    return { ok: true };
  }
  function prepare(events) {
    let skippedFields = 0;
    if (!Array.isArray(events)) return { events, skippedFields };
    const prepared = events.map(e => {
      if (!e?.details || typeof e.details !== 'object' || Array.isArray(e.details) || typeof e.evidence !== 'string') return e;
      const entries = Object.entries(e.details);
      const supported = entries.filter(([k, v]) => bounded(k, 24) && !['__proto__', 'constructor', 'prototype'].includes(k)
        && bounded(v, 80) && e.evidence.includes(v));
      // Preserve directly supported fields (e.g. a book title) even when an agent
      // paraphrases another field. Never turn a wholly unsupported event into a fact.
      if (!supported.length) return e;
      skippedFields += entries.length - supported.length;
      return { ...e, details: Object.fromEntries(supported) };
    });
    return { events: prepared, skippedFields };
  }
  function record(role, events, sentText, key) {
    const result = check(role, events, sentText);
    if (!result.ok || result.disabled || !events?.length) return result;
    const before = structuredClone(data);
    try {
    const d = day(role), t = now();
    for (const e of events) {
      const s = d.slots.find(s => s.id === e.slotId);
      if (e.certainty === 'tentative') {
        s.tentative = { details: e.details, status: e.status, at: t.at, source: 'agent_proposal' };
        continue;
      }
      const nextEnd = e.end || s.end;
      if (e.status === 'active') {
        for (const other of d.slots) {
          if (other === s || ['completed', 'skipped'].includes(other.status)) continue;
          if (minute(other.start) < minute(nextEnd) && minute(other.end) > minute(s.start)) {
            other.status = 'skipped';
            other.changeReason = `改为${e.activity || s.activity}`;
          }
        }
      }
      if (e.activity && e.activity !== s.activity || e.end && e.end !== s.end) {
        data.revisions.push({ date: t.date, role: d.role, slotId: s.id, at: t.at, previous: { activity: s.activity, end: s.end },
          proposed: { activity: e.activity || s.activity, end: nextEnd }, reason: e.changeReason, resolution: 'plan_changed' });
      }
      s.activity = e.activity || s.activity; s.end = nextEnd; s.status = e.status;
      s.details = { ...s.details, ...Object.fromEntries(Object.entries(e.details).map(([k, v]) => [fieldName(k), v])) }; s.confidence = 'virtual_self_report';
      s.source = { kind: 'agent_self_report', evidence: e.evidence, conversation: key, at: t.at, delivery: 'success' };
      delete s.tentative;
    }
    save();
    return { ok: true, recorded: events.length, confirmation: 'virtual_self_report' };
    } catch (e) { data = before; throw e; }
  }
  function checkPlans(role, changes, sentText, ownerText, key) {
    if (!enabled() || config.futurePlans?.enabled !== true) return { ok: true, disabled: true };
    if (!writable) return { ok: false, error: '生活文件不可写，约定未保存；不要重复发送回复' };
    const checked = checkFuturePlans({ plans: data.futurePlans, changes, role: role || 'default', key, sentText, ownerText, now: now() });
    if (!checked.ok || config.calendar?.enabled !== true) return checked;
    return checkCalendarChanges({ data, role: role || 'default', key, changes, now: now() });
  }
  function recordPlans(role, changes, sentText, ownerText, key, options = {}) {
    const checked = checkPlans(role, changes, sentText, ownerText, key);
    if (!checked.ok || checked.disabled || !changes?.length) return checked;
    const before = structuredClone(data);
    try {
      const result = applyFuturePlans({ data, changes, role: role || 'default', key, now: now(), origin: options.origin });
      if (config.calendar?.enabled === true) {
        data.calendarChanges ||= [];
        for (let index = 0; index < changes.length; index++) {
          const c = changes[index], id = result.ids[index], old = before.futurePlans?.[id], next = data.futurePlans[id];
          if (JSON.stringify(old) === JSON.stringify(next)) continue;
          const brief = p => p ? { date: p.date, time: p.time, durationMinutes: p.durationMinutes || 60, title: p.title, status: p.status } : null;
          data.calendarChanges.push({ at: now().at, role: role || 'default', key, id, action: c.action, previous: brief(old), next: brief(next), reason: c.changeReason || '用户请求且已送达同意回复' });
        }
        result.scheduleChanged = true;
      }
      save(); return result;
    } catch (e) { data = before; throw e; }
  }
  function prompt(role, topic = '', context = [], options = {}) {
    if (!enabled()) return '';
    try {
      const s = snapshot(role, options), current = s.slots.find(s => s.status === 'active');
      const calendarLine = config.calendar?.enabled === true ? '【聊天改变日程】已接受约定会占用对应时间，原计划只在剩余时段进行；取消或改期后自动释放原时段。时长未明确时暂按60分钟估计，可协商调整。约定不是已完成经历，不自动兑现或发送提醒。占用时段兑现请用futurePlans.complete；普通lifeEvents仍用原模板时段ID，不把被打断的原计划全部标完成。\n' : '';
      const storiesLine = config.stories?.enabled === true ? storyContext({ data, role: s.role, key: lifeStoryKey(config, options.key), topic, now: s }) : '';
      const plansLine = config.futurePlans?.enabled === true ? futurePlanContext({ plans: data.futurePlans, role: s.role, key: options.key, now: s, topic }) : '';
      const gated = config.detailGate?.enabled === true;
      const selection = gated ? selectLifeDetails({ days: data.days, role: s.role, date: s.date, slots: s.slots, topic, context, currentId: current?.id }) : null;
      const facts = selection ? selection.facts : s.slots.filter(s => s.confidence === 'virtual_self_report').slice(-8);
      const words = topicWords(topic);
      const weeks = config.weeklySummary?.enabled === true ? Object.values(data.weeklySummaries || {}).filter(w => w.role === s.role)
        .sort((a, b) => b.through.localeCompare(a.through)) : [];
      const summaryRequest = /总结|这周|一周|最近[七7]天/.test(topic);
      const relevantWeek = gated ? weeks.find(w => selection.weekly || selection.historical && w.entries.some(e => selection.matches(e)))
        : weeks.find(w => summaryRequest || words.some(word => topicWords(w.text).includes(word)));
      const weekText = relevantWeek && gated && !selection.weekly
        ? relevantWeek.entries.filter(e => selection.matches(e)).map(e => `${e.activity} ${JSON.stringify(e.details)}`).join('；') : relevantWeek?.text;
      const weekLine = weekText ? `七日生活总结（仅已确认的虚拟经历）：${weekText.slice(0, gated ? 600 : 1800)}\n` : '';
      const history = selection ? selection.history : words.length ? Object.values(data.days).filter(d => d.role === s.role && d.date !== s.date)
        .filter(d => /昨天|前天|\d{4}-\d{2}-\d{2}/.test(topic) || !weeks.some(w => d.date >= w.from && d.date <= w.through))
        .sort((a, b) => b.date.localeCompare(a.date)).flatMap(d => d.slots.filter(e => e.confidence === 'virtual_self_report'
          && topicWords(JSON.stringify(e)).some(w => words.includes(w))).map(e => ({ date: d.date, ...e }))).slice(0, 3) : [];
      const brief = e => `${e.date || s.date} ${e.id} ${e.start}-${e.end} ${e.activity} [${e.status}] ${JSON.stringify(e.details)}`;
      const within = (entries, budget) => {
        let used = 0;
        return entries.map(brief).filter(line => { used += line.length; return used <= budget; }).join('；');
      };
      const factsText = within(facts, gated && !selection.allDay ? 600 : 1200);
      const hiddenFacts = selection && (!factsText
        || facts.reduce((n, e) => n + brief(e).length, 0) > (selection.allDay ? 1200 : 600));
      const indexLine = hiddenFacts && selection.index ? `已存细节索引：${selection.index.slice(0, 240)}（未附≠未记；需时用life_context的query补读，勿重编）。\n` : '';
      const emptyFacts = selection?.index ? '本轮话题未选中，见细节索引' : '暂无，计划不等于发生';
      return modeInstruction(data.days[JSON.stringify([s.role,s.date])]?.lifeMode) + calendarLine + storiesLine + plansLine + weekLine + indexLine + `【虚拟生活实验】这是角色的虚拟生活设定，不是现实活动的证据；沿用角色卡，自然补充虚拟生活细节，不机械汇报行程。\n当前时间：${s.date} ${s.time} (${config.timeZone || 'Asia/Shanghai'})\n当前计划活动：${current ? `${current.id} ${current.activity}，预计${current.end}结束` : '自由安排/休息（未确认）'}\n今日粗略日程：${s.slots.map(e => `${e.id} ${e.start}-${e.end} ${e.activity}[${e.status}${e.pendingConfirmation ? '，已过时段但未确认发生' : ''}]`).join('；')}\n今日已确认的虚拟经历：${factsText || emptyFacts}\n相关历史：${within(history, 600) || '无'}\n规则：这是可自主补充的虚拟角色生活，不是现实履历。没有既有事实时，你可以自然决定正在做什么、为已过时段补充合理生活细节，并把本次选定的设定随回复保存；不需要用户或数据库先替你确认。不要回复没有确认记录所以不能说，更不要向用户念evening、slotId、实验或数据库术语；像平常聊天那样讲具体活动即可。用户追问虚拟日常时直接补足具体细节：问书名就选定书名，问发生什么就展开动作和感受，不用装忘记或泛泛打趣代替回答。默认沿用已经提到的活动，未定细节允许创作并建立为虚拟事实，不撤回成现实没做过；确实核实现实时才说明区别。真实书籍内容须准确，不编造原著引文。已经确定的细节必须一致；明确标作假设、玩笑和用户经历不登记。自然补充自己的确定细节时，在本轮用life_propose提交lifeEvents候选，宿主确认消息送达后保存（date,slotId,status,subject="character",basis="own_virtual_experience",certainty="settled"或"tentative",details简短键值（阅读建议book/note/feeling等稳定键名）,evidence本次回复连续原文；更改活动加activity/changeReason，可加end）。细节值必须逐字出现在evidence。只在确有新事实或计划变更时附；不确定用tentative，不冒充completed。记录与成功发送绑定，失败不重发消息。修改已确认事实须核对，不能静默覆盖。\n\n`;
    } catch (e) { onError(`生活上下文不可用：${e.message}`); return ''; }
  }
  function checkStories(role, changes, sentText, key) {
    if (!enabled() || config.stories?.enabled !== true) return { ok: true, disabled: true };
    if (!writable) return { ok: false, error: '生活记录暂停写入' };
    return checkLifeStories({ data, role: role || 'default', key: lifeStoryKey(config, key), changes: prepareLifeStories(changes, sentText).changes, sentText, now: now() });
  }
  function recordStories(role, changes, sentText, key) {
    const checked = checkStories(role, changes, sentText, key);
    if (!checked.ok || checked.disabled || !changes?.length) return checked;
    const before = structuredClone(data);
    try { const prepared = prepareLifeStories(changes, sentText); const result = applyLifeStories({ data, role: role || 'default', key: lifeStoryKey(config, key), changes: prepared.changes, now: now() }); save(); return { ...result, repairedFields: prepared.repairedFields }; }
    catch (e) { data = before; throw e; }
  }
  function view(role, options = {}) {
    return buildLifeView({ data, config, role, now: now(), key: options.key, date: options.date, writable, template: DEFAULT_SCHEDULE, name: options.name, admin: options.admin === true });
  }
  function setMode(role, body) {
    if (!writable) throw Object.assign(Error('生活记录暂停写入'), {status:503});
    const before=structuredClone(data);
    try {const result=saveMode(data,config,role,body,now());save();return result;}
    catch(e){data=before;throw e;}
  }
  function revise(role, body) {
    if (!writable) throw Object.assign(Error('记录文件不可写，原文件已保留'), { status: 503 });
    const before = structuredClone(data);
    try { const result = reviseLifeRecord({ data, role, body, now: now() }); save(); return result; }
    catch (e) { data = before; throw e; }
  }
  return { enabled, snapshot, prompt, prepare, check, record, checkPlans, recordPlans, checkStories, recordStories, view, revise, setMode };
}
