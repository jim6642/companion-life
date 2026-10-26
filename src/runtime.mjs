import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createVirtualLife } from './core/virtual-life.js';
import { createLifeSceneCompanion, buildLifeSceneSharePrompt } from './core/virtual-life-proactive.js';

export class RuntimeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function createRuntime(config, { clock = () => Date.now(), onError = () => {} } = {}) {
  const bindings = new Map(), turns = new Map();
  for (const b of config.bindings) {
    const dir = path.join(config.dataDir, b.id);
    fs.mkdirSync(dir, { recursive: true });
    const life = createVirtualLife({ file: path.join(dir, 'life.json'), config: b.life, clock: () => new Date(clock()), onError });
    const entry = { b, life, dir, presence: { ready: false, busy: false, at: 0, lastInteractionAt: 0 } };
    entry.controller = createLifeSceneCompanion({ file: path.join(dir, 'scenes.json'), config: b.life, life,
      clock, onError, environment: () => ({ key: b.id, role: b.role,
        ready: entry.presence.ready && clock() - entry.presence.at < 90000,
        blocked: b.kind !== 'private', busy: entry.presence.busy || busy(b.id), lastInteractionAt: entry.presence.lastInteractionAt }),
      dispatch: async event => {
        const candidate = { id: crypto.randomUUID(), event, createdAt: clock(), claimed: false };
        fs.writeFileSync(path.join(dir, 'opportunity.json.tmp'), JSON.stringify(candidate));
        fs.renameSync(path.join(dir, 'opportunity.json.tmp'), path.join(dir, 'opportunity.json'));
        return { ok: true };
      } });
    bindings.set(b.id, entry);
  }
  function cleanup() {
    for (const [id, t] of turns) if (clock() - t.createdAt > 15 * 60000) turns.delete(id);
  }
  function busy(id) { cleanup(); return [...turns.values()].some(t => t.binding === id && !t.result); }
  function binding(id) { const e = bindings.get(id); if (!e) throw new RuntimeError(403, 'Unknown binding'); return e; }
  function context(id, query = '', recent = []) {
    const { b, life } = binding(id);
    return life.prompt(b.role, String(query).slice(0, 300), recent.slice(-6), { key: b.id });
  }
  function startTurn(id, body, proactive = false) {
    const e = binding(id); cleanup();
    if (busy(id)) throw new RuntimeError(409, 'Conversation already has an open turn');
    if (turns.size >= 1000) throw new RuntimeError(429, 'Too many pending turns');
    if (typeof body.userText !== 'string' || body.userText.length > 8000) throw new RuntimeError(400, 'userText must be a string up to 8000 characters');
    const recent = body.recent || [];
    if (!Array.isArray(recent) || recent.length > 6 || recent.some(s => typeof s !== 'string' || s.length > 400)) throw new RuntimeError(400, 'recent must contain up to six short strings');
    const turnId = crypto.randomUUID(), commitToken = crypto.randomBytes(24).toString('hex');
    const lifeContext = context(id, body.userText, recent);
    const storyInstruction = e.b.life.stories?.enabled ? 'Use lifeStories for multi-day virtual story continuity: create requires date, title, category(reading/hobby/daily), subject=character, basis=own_virtual_experience, progress and evidence from the delivered reply; nextStep is only a plan, facts are fixed details. Advance/complete/drop requires existing id and expectedRevision. Never auto-advance by time, change fixed facts, or create a new story every reply. Only mention it naturally when relevant. ' : '';
    turns.set(turnId, { binding: id, createdAt: clock(), commitToken, userText: proactive ? '' : body.userText, proposal: {} });
    if (!proactive) e.presence.lastInteractionAt = clock();
    return { turnId, commitToken, context: lifeContext,
      instruction: e.b.life.enabled ? `Use life_propose(turnId="${turnId}", lifeEvents=[...], futurePlans=[...]) only for new virtual facts or accepted commitments. subject="character"; never claim a real action happened. Proposals are not saved until the host confirms delivery. ${storyInstruction}${e.b.kind === 'private' && e.b.life.futurePlans?.enabled ? 'For an accepted future commitment use futurePlans: action=create, absolute date=YYYY-MM-DD, time=HH:mm, title, keywords, requestEvidence verbatim from this user request, evidence verbatim from your delivered acceptance. To update/cancel/complete use the saved id and changeReason. A plan is never an already completed event.' : 'Future commitments are disabled for this binding.'}` : '' };
  }
  function turn(id, turnId) {
    cleanup(); const t = turns.get(turnId);
    if (!t || t.binding !== id) throw new RuntimeError(404, 'Turn missing or expired');
    return t;
  }
  function propose(id, turnId, body) {
    const t = turn(id, turnId);
    if (t.result) throw new RuntimeError(409, 'Turn already closed');
    for (const k of Object.keys(body)) if (!['lifeEvents', 'futurePlans', 'lifeStories'].includes(k)) throw new RuntimeError(400, 'Unknown proposal field');
    for (const k of ['lifeEvents', 'futurePlans', 'lifeStories']) if (body[k] !== undefined && (!Array.isArray(body[k]) || body[k].length > (k === 'lifeStories' ? 2 : 3))) throw new RuntimeError(400, 'Proposal count exceeded');
    const { b, life } = binding(id);
    if (b.kind === 'private' && b.life.calendar?.enabled && body.futurePlans?.length) {
      const checked = life.checkPlans(b.role, body.futurePlans, body.futurePlans.map(c => String(c?.evidence || '')), [t.userText], id);
      if (checked.code === 'schedule_conflict') throw new RuntimeError(409, checked.error);
    }
    t.proposal = { ...t.proposal, ...structuredClone(body) };
    return { ok: true, staged: true, saved: false };
  }
  function commit(id, turnId, body) {
    const t = turn(id, turnId), { b, life } = binding(id);
    if (typeof body.commitToken !== 'string' || body.commitToken !== t.commitToken) throw new RuntimeError(403, 'Host delivery capability required');
    if (t.result) return t.result;
    if (body.delivery?.status !== 'success') {
      t.result = { ok: true, delivered: false, recorded: 0, noResend: true }; return t.result;
    }
    const messages = body.deliveredMessages;
    if (!Array.isArray(messages) || !messages.length || messages.length > 8 || messages.some(s => typeof s !== 'string' || !s || s.length > 2000)) throw new RuntimeError(400, 'Actual deliveredMessages required');
    const result = { ok: true, delivered: true, noResend: true, life: { recorded: 0 }, plans: { recorded: 0 } };
    if (t.proposal.lifeEvents?.length) {
      try {
        const prepared = life.prepare(t.proposal.lifeEvents);
        result.life = { ...life.record(b.role, prepared.events, messages, id), skippedFields: prepared.skippedFields };
      } catch { result.life = { ok: false, error: 'Memory persistence failed; do not resend' }; }
    }
    if (t.proposal.futurePlans?.length) {
      try {
        result.plans = b.kind === 'private' ? life.recordPlans(b.role, t.proposal.futurePlans, messages, [t.userText], id)
          : { ok: false, error: 'Private commitments are disabled for group bindings' };
      } catch { result.plans = { ok: false, error: 'Commitment persistence failed; do not resend' }; }
    }
    t.result = result;
    if (t.proposal.lifeStories?.length) {
      try { result.stories = life.recordStories(b.role, t.proposal.lifeStories, messages, id); }
      catch { result.stories = { ok: false, error: 'Story persistence failed; do not resend' }; }
    }
    return result;
  }
  function presence(id, body) {
    const e = binding(id);
    e.presence = { ready: body.ready === true, busy: body.busy === true, at: clock(),
      lastInteractionAt: Math.max(e.presence.lastInteractionAt, Math.min(clock(), Number(body.lastInteractionAt) || 0)) };
    return { ok: true };
  }
  function takeOpportunity(id) {
    const e = binding(id), file = path.join(e.dir, 'opportunity.json');
    if (!e.b.life.proactive?.enabled || !fs.existsSync(file) || busy(id)) return null;
    const candidate = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (candidate.claimed || clock() - candidate.createdAt > 15 * 60000) return null;
    candidate.claimed = true; fs.writeFileSync(`${file}.tmp`, JSON.stringify(candidate)); fs.renameSync(`${file}.tmp`, file);
    const turn = startTurn(id, { userText: '', recent: [] }, true);
    turn.context = buildLifeSceneSharePrompt(candidate.event, context(id, candidate.event.scene.activity), e.b.persona);
    return turn;
  }
  return { bindings, context, startTurn, propose, commit, presence, takeOpportunity, busy,
    tick: async () => { for (const e of bindings.values()) await e.controller.tick(); },
    stats: () => ({ bindings: bindings.size, openTurns: [...turns.values()].filter(t => !t.result).length }) };
}
