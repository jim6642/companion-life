import { applyFuturePlans } from './future-life-plans.js';
const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const serial = (date, time) => Date.parse(`${date}T00:00:00Z`) / 60000 + minute(time);
const label = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const overlap = (a, b) => a.start < b.end && b.start < a.end;
function windowOf(plan) {
  const start = serial(plan.date, plan.time), duration = plan.durationMinutes || 60;
  let end = start + duration;
  if (plan.status === 'completed' && plan.completedAtLocal) end = Math.min(end, serial(plan.completedAtLocal.date, plan.completedAtLocal.time));
  return { start, end };
}
function reservations(data, role) {
  const rows = Object.values(data.futurePlans || {}).filter(p => p.role === role && ['planned', 'completed'].includes(p.status))
    .map(p => ({ ...windowOf(p), plan: p, historical: false }));
  for (const revision of data.revisions || []) {
    if (revision.type !== 'future_plan' || !['update', 'cancel'].includes(revision.action) || !revision.changedAtLocal) continue;
    const current = data.futurePlans?.[revision.id];
    if (!current || current.role !== role || revision.previous?.status !== 'planned') continue;
    const previous = { ...current, ...revision.previous }, span = windowOf(previous);
    span.end = Math.min(span.end, serial(revision.changedAtLocal.date, revision.changedAtLocal.time));
    if (span.end > span.start) rows.push({ ...span, plan: previous, historical: true, action: revision.action, stamp: revision.at });
  }
  return rows.filter(r => Number.isFinite(r.start) && r.end > r.start);
}

export function checkCalendarChanges({ data, role, key, changes, now }) {
  if (!changes?.length) return { ok: true };
  const clone = structuredClone(data);
  const changed = applyFuturePlans({ data: clone, role, key, changes, now }).ids;
  const rows = reservations(clone, role).filter(r => !r.historical);
  for (const id of changed) {
    const row = rows.find(r => r.plan.id === id);
    if (!row) continue;
    if (rows.some(other => other.plan.id !== id && overlap(row, other))) return { ok: false, code: 'schedule_conflict', error: '这个时间已经有另一项约定，请协商改时间或先取消原约定；本次尚未发送。' };
    const sameDay = rows.filter(other => other.plan.date === row.plan.date).length;
    if (sameDay > 8) return { ok: false, code: 'schedule_conflict', error: '当天安排过多，先整理已有约定。' };
    for (const day of Object.values(data.days)) {
      if (day.role !== role) continue;
      for (const s of day.slots) if (s.status === 'completed' && overlap(row, { start: serial(day.date, s.start), end: serial(day.date, s.end) })) {
        return { ok: false, code: 'schedule_conflict', error: '约定与已确认完成的经历冲突，不能覆盖已有经历。' };
      }
    }
  }
  return { ok: true };
}

/** Derived view: persisted commitments reserve time, base plans are never destroyed. */
export function projectLifeCalendar({ data, role, date, time, slots, ownerKey }) {
  const dayStart = serial(date, '00:00'), current = minute(time);
  const rows = reservations(data, role).filter(r => r.start < dayStart + 1440 && r.end > dayStart)
    .map(r => ({ ...r, start: Math.max(0, r.start - dayStart), end: Math.min(1440, r.end - dayStart) }))
    .sort((a, b) => a.start - b.start || Number(a.historical) - Number(b.historical));
  if (!rows.length) return slots;
  const occupied = rows.map(r => ({ start: r.start, end: r.end }));
  const result = [];
  for (const slot of slots) {
    let pieces = [{ start: minute(slot.start), end: minute(slot.end) }];
    for (const reservation of occupied) pieces = pieces.flatMap(piece => !overlap(piece, reservation) ? [piece] : [
      ...(piece.start < reservation.start ? [{ start: piece.start, end: reservation.start }] : []),
      ...(piece.end > reservation.end ? [{ start: reservation.end, end: piece.end }] : []),
    ]);
    pieces.forEach((piece, index) => {
      const status = ['completed', 'skipped'].includes(slot.status) ? slot.status : current >= piece.start && current < piece.end ? 'active' : 'planned';
      result.push({ ...slot, id: index ? `${slot.id}~${index}` : slot.id, baseSlotId: slot.id, start: label(piece.start), end: label(piece.end), status,
        pendingConfirmation: current >= piece.end && !['completed', 'skipped'].includes(status) });
    });
  }
  for (const row of rows) {
    const p = row.plan, own = ownerKey === p.key;
    const status = row.historical ? 'skipped' : p.status === 'completed' ? 'completed' : current >= row.start && current < row.end ? 'active' : 'planned';
    result.push({ id: `appointment:${p.id}${row.historical ? ':' + row.start : ''}`, start: label(row.start), end: label(row.end),
      activity: row.historical ? own ? `${p.title}（原计划已调整）` : '原先约好的活动（已调整）' : own ? p.title : '已约好的活动',
      status, appointment: true, ...(own ? { appointmentId: p.id } : {}),
      confidence: status === 'completed' ? 'virtual_self_report' : 'plan', details: {},
      durationEstimated: p.durationEstimated !== false,
      pendingConfirmation: current >= row.end && !['completed', 'skipped'].includes(status) });
  }
  return result.sort((a, b) => minute(a.start) - minute(b.start));
}

export function calendarEventConflict({ data, role, date, slot, status, now }) {
  const rows = reservations(data, role).filter(r => !r.historical);
  if (status === 'active') {
    const instant = serial(date, now.time);
    return rows.some(r => r.start <= instant && instant < r.end);
  }
  return status === 'completed' && rows.some(r => overlap(r, { start: serial(date, slot.start), end: serial(date, slot.end) }));
}
