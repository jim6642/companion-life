import crypto from 'node:crypto';

const dateNumber = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
const dateString = n => new Date(n * 86400000).toISOString().slice(0, 10);

// Calendar-day windows in the already-selected local date, no timers or model calls.
export function buildWeeklyLifeSummaries(days, today, previous = {}) {
  const summaries = { ...previous };
  const roles = new Map();
  for (const d of Object.values(days)) {
    if (!roles.has(d.role)) roles.set(d.role, []);
    roles.get(d.role).push(d);
  }
  for (const [role, rows] of roles) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const anchor = dateNumber(rows[0].date), until = dateNumber(today);
    for (let start = anchor; start + 7 <= until; start += 7) {
      const from = dateString(start), through = dateString(start + 6);
      const window = rows.filter(d => d.date >= from && d.date <= through);
      if (!window.length) continue;
      const events = window.flatMap(d => d.slots.filter(s => s.confidence === 'virtual_self_report'
        && s.source?.delivery === 'success' && ['active', 'completed'].includes(s.status))
        .map(s => ({ date: d.date, slotId: s.id, activity: s.activity, status: s.status, details: s.details })));
      const sourceHash = crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');
      const key = JSON.stringify([role, from]);
      if (previous[key]?.sourceHash === sourceHash) continue;
      const groups = new Map();
      for (const e of events) {
        const groupKey = JSON.stringify([e.activity, e.status, Object.entries(e.details).sort()]);
        if (!groups.has(groupKey)) groups.set(groupKey, { activity: e.activity, status: e.status, details: e.details, dates: [] });
        groups.get(groupKey).dates.push(e.date);
      }
      const entries = [...groups.values()];
      const lines = entries.map(e => `${e.dates.join('、')} ${e.activity}（${e.status === 'completed' ? '已完成' : '当时自述正在进行，未确认完成'}）：${JSON.stringify(e.details)}`);
      let used = 0;
      const kept = lines.filter(line => { if (used + line.length > 1500) return false; used += line.length; return true; });
      summaries[key] = {
        role, from, through, sourceHash, eventCount: events.length,
        confirmedDays: new Set(events.map(e => e.date)).size,
        entries, omittedGroups: lines.length - kept.length,
        text: `${from}至${through}：${events.length}项已确认虚拟生活记录，覆盖${new Set(events.map(e => e.date)).size}/7天；无记录的日期不补写。${kept.join('；') || '没有已确认经历。'}${kept.length < lines.length ? '；其余细节仍保留在原始记录。' : ''}`,
      };
    }
  }
  return summaries;
}
