import fs from 'node:fs';
import path from 'node:path';

function validateSchedule(rows) {
  if (!Array.isArray(rows) || rows.length > 16) throw Error('Invalid schedule');
  const ids = new Set(); let end = '';
  for (const s of rows) {
    if (!s || typeof s.id !== 'string' || !s.id.trim() || s.id.length > 40 || ids.has(s.id)
      || typeof s.activity !== 'string' || !s.activity.trim() || s.activity.length > 60 || /[\r\n]/.test(s.id + s.activity)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end)
      || s.start < end || s.end <= s.start) throw Error('Schedule must be sorted, same-day and non-overlapping');
    ids.add(s.id); end = s.end;
  }
}

export function loadConfig(file = process.env.LIFE_CONFIG || 'config.local.json') {
  const configPath = path.resolve(file);
  const c = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  if (c.version !== 1) throw Error('Unsupported config version');
  if (!['127.0.0.1', '::1', 'localhost'].includes(c.host)) throw Error('This release only listens on loopback');
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw Error('port must be 1024..65535');
  if (!Array.isArray(c.bindings) || !c.bindings.length || c.bindings.length > 100) throw Error('Configure 1..100 bindings');
  const ids = new Set(), tokens = new Set();
  for (const token of [c.adminToken, ...c.bindings.map(b => b.token)]) {
    if (typeof token !== 'string' || token.length < 32 || token.startsWith('GENERATE_') || tokens.has(token)) throw Error('Use init to generate unique local tokens');
    tokens.add(token);
  }
  for (const b of c.bindings) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(b.id) || ids.has(b.id)) throw Error('Binding IDs must be unique safe names');
    if (!['private', 'group'].includes(b.kind) || typeof b.role !== 'string' || !b.role || b.role.length > 80) throw Error('Binding kind/role invalid');
    if (typeof b.persona !== 'string' || b.persona.length > 4000 || !b.life || typeof b.life.enabled !== 'boolean') throw Error('Binding persona/life invalid');
    new Intl.DateTimeFormat('en', { timeZone: b.life.timeZone || 'Asia/Shanghai' }).format();
    if (b.life.schedule !== undefined) validateSchedule(b.life.schedule);
    if (b.life.roleSchedules !== undefined) {
      if (!b.life.roleSchedules || typeof b.life.roleSchedules !== 'object' || Array.isArray(b.life.roleSchedules)) throw Error('Invalid role schedules');
      for (const rows of Object.values(b.life.roleSchedules)) validateSchedule(rows);
    }
    const proactive = b.life.proactive;
    if (proactive?.enabled) {
      for (const name of ['quietStart', 'quietEnd']) if (proactive[name] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(proactive[name])) throw Error('Invalid quiet hours');
      for (const [name, max] of [['maxPerDay', 5], ['minGapMinutes', 10080], ['idleMinutes', 1440], ['transitionGraceMinutes', 120]]) {
        if (proactive[name] !== undefined && (!Number.isInteger(proactive[name]) || proactive[name] < 0 || proactive[name] > max)) throw Error('Invalid proactive limits');
      }
      if (proactive.sceneIds !== undefined && (!Array.isArray(proactive.sceneIds) || proactive.sceneIds.some(id => typeof id !== 'string'))) throw Error('Invalid proactive scene IDs');
    }
    if (b.kind === 'group' && (b.life.futurePlans?.enabled || b.life.proactive?.enabled)) throw Error('Private commitments/proactive sharing cannot be enabled in group bindings');
    ids.add(b.id);
  }
  if (typeof c.dataDir !== 'string' || !c.dataDir) throw Error('dataDir required');
  return { ...c, configPath, dataDir: path.resolve(path.dirname(configPath), c.dataDir) };
}
