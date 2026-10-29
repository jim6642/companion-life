import crypto from 'node:crypto';
const clean = (s, n) => typeof s === 'string' && s.trim().length > 0 && s.length <= n && !/[\r\n]/.test(s);
const safeKey = s => clean(s, 24) && !['__proto__', 'constructor', 'prototype'].includes(s);
const terminal = s => ['completed', 'dropped'].includes(s);
export const lifeStoryKey = (config, key) => key && config.stories?.scope === 'character' ? 'character' : key;
// Normalize only an explicitly submitted candidate with actual delivered evidence.
// Never scan ordinary chat and manufacture a story without a proposal.
export function prepareLifeStories(changes, sentText) {
  let repairedFields = 0;
  if (!Array.isArray(changes)) return { changes, repairedFields };
  return { changes: changes.map(c => {
    if (!c || !clean(c.evidence, 300) || !sentText.join('').includes(c.evidence)) return c;
    const result = { ...c };
    const sentences = c.evidence.split(/[。！？\n]/).map(s => s.trim()).filter(s => clean(s, 100));
    const planned = s => /明天|后天|下次|接下来|准备|打算|想看看/.test(s);
    if (typeof c.progress === 'string' && !c.evidence.includes(c.progress)) {
      const actual = sentences.find(s => !planned(s) && /读|看|练|画|学|做|开始|完成|试|整理/.test(s));
      if (actual) { result.progress = actual; repairedFields++; }
    }
    if (c.nextStep !== undefined && (typeof c.nextStep !== 'string' || !c.evidence.includes(c.nextStep))) {
      const actual = sentences.find(planned);
      if (actual) result.nextStep = actual;
      else delete result.nextStep;
      repairedFields++;
    }
    return result;
  }), repairedFields };
}
export function listLifeStories(data, role, key) {
  if (!key) return [];
  return Object.values(data.stories || {}).filter(s => s.role === role && s.key === key);
}
export function checkLifeStories({ data, role, key, changes, sentText, now }) {
  if (!changes?.length && (changes === undefined || Array.isArray(changes))) return { ok: true };
  if (!key || !Array.isArray(changes) || changes.length > 2) return { ok: false, error: '生活线需绑定当前会话，每轮最多2项' };
  const seen = new Set(); let creates = 0;
  for (const c of changes) {
    if (!c || !['create', 'advance', 'complete', 'drop'].includes(c.action) || c.date !== now.date
      || c.subject !== 'character' || c.basis !== 'own_virtual_experience') return { ok: false, error: '只能保存角色自己当天的虚拟生活线' };
    if (!clean(c.evidence, 300) || !sentText.join('').includes(c.evidence) || /如果|假如|比如|开玩笑|假装|梦到|你说|他说|她说/.test(c.evidence)) return { ok: false, error: '生活线证据须是本轮送达的自述，不能是假设或他人经历' };
    if (!clean(c.progress, 100) || !c.evidence.includes(c.progress)) return { ok: false, error: '本次进展须逐字见于证据' };
    if (c.action === 'complete' && /还没|准备|打算|可能|也许|明天/.test(c.progress)) return { ok: false, error: '未来打算不能直接标记完成' };
    if (c.nextStep !== undefined && (!clean(c.nextStep, 100) || !c.evidence.includes(c.nextStep))) return { ok: false, error: '下一步须是回复中明确提到的计划' };
    const facts = c.facts || {};
    if (!facts || typeof facts !== 'object' || Array.isArray(facts) || Object.keys(facts).length > 6 || Object.entries(facts).some(([k, v]) => !safeKey(k) || !clean(v, 80) || !c.evidence.includes(v))) return { ok: false, error: '生活线事实最多6项，值须逐字见于证据' };
    let identity;
    if (c.action === 'create') {
      if (!clean(c.title, 60) || !c.evidence.includes(c.title) || !['reading', 'hobby', 'daily'].includes(c.category)) return { ok: false, error: '创建生活线需明确标题与类型' };
      identity = storyId(role, key, c.title);
      if (data.stories?.[identity]) return { ok: false, code: 'story_conflict', error: '同名生活线已经存在，请使用原ID和revision推进' };
      creates++;
    } else {
      const old = data.stories?.[c.id]; identity = c.id;
      if (!old || old.role !== role || old.key !== key) return { ok: false, error: '生活线ID不属于当前角色/会话' };
      if (c.expectedRevision !== old.revision || terminal(old.status)) return { ok: false, code: 'story_conflict', error: '生活线已变化或已结束，请读取最新记录，不要回退进度' };
      if (Object.entries(facts).some(([k, v]) => old.facts[k] !== undefined && old.facts[k] !== v)) return { ok: false, code: 'story_conflict', error: '生活线固定事实冲突，请保留原事实' };
      if (Object.keys({ ...old.facts, ...facts }).length > 12) return { ok: false, error: '单条生活线最多12项固定事实' };
    }
    if (seen.has(identity)) return { ok: false, error: '同轮不能重复修改同一生活线' };
    seen.add(identity);
  }
  if (listLifeStories(data, role, key).filter(s => !terminal(s.status)).length + creates > 3) return { ok: false, error: '同时最多3条未结束生活线，先自然结束已有内容' };
  return { ok: true };
}
const storyId = (role, key, title) => crypto.createHash('sha256').update(JSON.stringify([role, key, title])).digest('hex').slice(0, 20);
export function applyLifeStories({ data, role, key, changes, now }) {
  data.stories ||= {}; const ids = [];
  for (const c of changes) {
    const id = c.action === 'create' ? storyId(role, key, c.title) : c.id, old = data.stories[id];
    const event = { date: now.date, at: now.at, action: c.action, progress: c.progress, ...(c.nextStep ? { nextStep: c.nextStep } : {}), evidence: c.evidence, source: 'delivered_virtual_self_report' };
    if (old) data.revisions.push({ type: 'life_story', id, at: now.at, previousRevision: old.revision, previousProgress: old.progress, action: c.action });
    data.stories[id] = { ...(old || { id, role, key, title: c.title, category: c.category, createdAt: now.at, startedDate: now.date }),
      status: c.action === 'complete' ? 'completed' : c.action === 'drop' ? 'dropped' : 'ongoing',
      revision: (old?.revision || 0) + 1, progress: c.progress,
      nextStep: terminal(c.action === 'complete' ? 'completed' : c.action === 'drop' ? 'dropped' : 'ongoing') ? null : c.nextStep ?? (c.action === 'advance' ? null : old?.nextStep || null),
      facts: { ...old?.facts, ...c.facts }, updatedDate: now.date, updatedAt: now.at,
      history: [...(old?.history || []), event].slice(-8) };
    ids.push(id);
  }
  return { ok: true, recorded: ids.length, ids, noResend: true };
}
export function storyContext({ data, role, key, topic = '', now }) {
  const all = listLifeStories(data, role, key);
  const normalizeName = value => String(value).replace(/[《》“”「」『』]/g, '');
  const normalizedTopic = normalizeName(topic);
  const mentions = value => normalizeName(value).length >= 2 && normalizedTopic.includes(normalizeName(value));
  const related = s => mentions(s.title) || Object.values(s.facts).some(mentions)
    || s.category === 'reading' && /书|读|小说|看到|看完|那本/.test(topic) || s.category === 'hobby' && /爱好|练习|进展/.test(topic);
  const sorted = [...all].sort((a, b) => Number(related(b)) - Number(related(a)) || b.updatedAt.localeCompare(a.updatedAt));
  const selected = sorted.filter(s => related(s) || !terminal(s.status) && /现在|今天|昨天|最近|后来|然后|进展|接着|那本|那个/.test(topic)).slice(0, 2);
  const active = all.filter(s => !terminal(s.status)).slice(0, 3);
  if (!all.length) return '';
  const brief = s => ({ id: s.id, revision: s.revision, title: s.title, category: s.category, status: s.status,
    progress: s.progress, nextStep: s.nextStep, facts: s.facts, updatedDate: s.updatedDate,
    recent: s.history.slice(-2).map(h => ({ date: h.date, progress: h.progress })) });
  let used = 0;
  const text = selected.map(s => JSON.stringify(brief(s))).filter(line => { if (used + line.length > 1800) return false; used += line.length; return true; }).join('\n');
  const sharedRule = key === 'character' ? '这是同一角色各会话共享的公共生活进度，优先于各自旧聊天和旧时段中冲突的进度；不要因换群或转私聊重新开同一本书。只保存角色本身的公共生活，不写用户身份、私聊互动或私人约定。\n' : '';
  return `【连续生活线】\n${sharedRule}未结束索引：${active.map(s => `${s.id} r${s.revision} ${s.title}`).join('；') || '无'}\n${text || '本轮无相关细节；可按标题补读。'}\n沿用已确认内容自然续聊，日期推进不代表进度自动发生；nextStep只是计划，离线期间不自动补剧情。无需每轮提起或每次新开故事。已保存进度是带日期的历史位置，不要求今天重复这一段。距updatedDate超过一天且有继续阅读的活动时，自主决定一个合理的小进展、暂停或读完；不要每天重复同一剧情或感受。用户追问旧段落仍可回顾，但回顾不等于进度回退。谈及新进展时必须随发送附lifeStories（原id、expectedRevision、action、date、progress、evidence），让下一轮读到更新；不能只说“接着看”却不登记。跨日可自然创作小进展，但只在实际说出后保存，不预先编好结局；真实作品情节不确定时不杜撰。\n`;
}

// Conservative fallback for an existing reading line only. Never create stories,
// infer an unseen chapter, or interpret reflection/plans as new reading progress.
export function inferDeliveredReading({data,role,key,sentText,now}) {
 const result=[];
 for(const story of listLifeStories(data,role,key).filter(s=>s.category==='reading'&&!terminal(s.status))){
  for(const message of sentText){
   const sentences=String(message).split(/[。！？\n]/).map(s=>s.trim());
   const evidence=sentences.find(s=>clean(s,100)&&s.includes(story.title)
    && /我/.test(s)&&/(?:读到|翻到|看到|读完了|看完了)/.test(s)
    && !/如果|假如|比如|假装|你说|他说|她说|昨天|以前|曾经|准备|打算|明天|下次|还没|没读|没看|又想到|又想起|回想|重读|重温|回顾|记得|想看|想读|也许|可能|未读|未看|没有读|没有看|并未/.test(s));
   if(!evidence||evidence===story.progress)continue;
   result.push({action:/读完了|看完了/.test(evidence)?'complete':'advance',date:now.date,id:story.id,expectedRevision:story.revision,subject:'character',basis:'own_virtual_experience',certainty:'settled',progress:evidence,evidence});break;
  }
 }
 return result.slice(0,2);
}
