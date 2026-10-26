import fs from 'node:fs';
import path from 'node:path';

const THEMES = {
  breakfast: ['早餐的小满足或小插曲', '一种食物的口感、温度或搭配'],
  lunch: ['午间放松时冒出的一个小念头', '午饭里一个想分享的小细节'],
  afternoon: ['学习或阅读时发现的一个有趣小细节', '休息时突然想到的一个轻松话题'],
  break: ['放松或散步时注意到的颜色、声音或小事', '一首歌、一个小爱好带来的心情'],
  evening: ['晚上娱乐、阅读时遇到的小趣味', '今天一个具体的小满足'],
  winddown: ['睡前一个轻松的小念头'],
};
const mins = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

/** Bridge-owned timer calls tick. Claims persist before model dispatch; never retries unknown outcomes. */
export function createLifeSceneCompanion({ file, config, life, environment, dispatch, clock = () => Date.now(), onError = () => {} }) {
  let state = { version: 1, days: {}, attempts: [], lastAttemptAt: 0 };
  let writable = true, firstTick = true, running = false;
  try {
    if (fs.existsSync(file)) {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.version !== 1 || !state.days || !Array.isArray(state.attempts)) throw Error('场景分享文件格式不兼容');
    }
  } catch (e) { writable = false; onError(`场景主动分享已暂停，原文件保留：${e.message}`); }
  function save() {
    if (!writable) throw Error('场景主动分享状态不可写');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }
  async function tick() {
    const cfg = config.proactive;
    if (!config.enabled || cfg?.enabled !== true || !writable || running) return { skipped: 'disabled-or-busy' };
    running = true;
    try {
      const env = environment();
      if (!env.role || !env.key) return { skipped: 'no-owner-or-role' };
      const current = life.snapshot(env.role);
      if (!current) return { skipped: 'no-life' };
      const scene = current.slots.find(s => s.status === 'active');
      const sceneKey = JSON.stringify([env.key, env.role, current.date, scene?.id || 'rest']);
      if (firstTick || state.lastRole !== env.role || state.lastTarget !== env.key) {
        firstTick = false;
        state.lastScene = sceneKey; state.lastRole = env.role; state.lastTarget = env.key; save();
        return { skipped: 'baseline' };
      }
      if (state.lastScene === sceneKey) return { skipped: 'same-scene' };
      const markSeen = reason => { state.lastScene = sceneKey; save(); return { skipped: reason }; };
      if (!scene) return markSeen('rest');
      const time = mins(current.time), sinceStart = time - mins(scene.start);
      const quietStart = mins(cfg.quietStart || '22:00'), quietEnd = mins(cfg.quietEnd || '08:00');
      const quiet = quietStart > quietEnd ? time >= quietStart || time < quietEnd : time >= quietStart && time < quietEnd;
      if (quiet) return markSeen('quiet-hours');
      if (sinceStart < 0 || sinceStart > (cfg.transitionGraceMinutes ?? 15)) return markSeen('stale-transition');
      if (!env.ready || env.blocked || env.busy) return { skipped: 'not-ready-or-busy' };
      const t = clock();
      if (t - (env.lastInteractionAt || 0) < (cfg.idleMinutes ?? 20) * 60000) return { skipped: 'recent-chat' };
      if (!(cfg.sceneIds || ['breakfast', 'afternoon', 'break', 'evening']).includes(scene.id)) return markSeen('ordinary-scene');
      const daily = state.days[current.date] || { attempts: 0 };
      const max = Math.max(0, Math.min(5, Number(cfg.maxPerDay ?? 2)));
      if (daily.attempts >= max) return markSeen('daily-limit');
      if (t - state.lastAttemptAt < (cfg.minGapMinutes ?? 240) * 60000) return markSeen('cooldown');
      const id = sceneKey;
      if (state.attempts.some(a => a.id === id)) return markSeen('already-claimed');
      const ideas = THEMES[scene.id] || ['当前活动中的一个具体小细节'];
      const seed = ideas[[...current.date + scene.id].reduce((n, c) => n + c.charCodeAt(0), 0) % ideas.length];
      const claim = { id, date: current.date, role: env.role, scene: scene.id, claimedAt: t, status: 'claimed' };
      state.lastScene = sceneKey; state.lastAttemptAt = t;
      state.days[current.date] = { attempts: daily.attempts + 1 };
      state.attempts.push(claim); state.attempts = state.attempts.slice(-100);
      for (const d of Object.keys(state.days).sort().slice(0, -30)) delete state.days[d];
      save(); // Fail closed: no dispatch unless the deduplication claim is durable.
      try {
        const result = await dispatch({ key: env.key, role: env.role, date: current.date, scene: { id: scene.id, activity: scene.activity, end: scene.end }, seed });
        claim.status = result?.ok && !result?.skipped ? 'accepted' : 'not-accepted';
        save();
        return { attempted: true, accepted: claim.status === 'accepted', scene: scene.id };
      } catch (e) {
        claim.status = 'failed-or-unknown';
        try { save(); } catch {}
        onError(`场景分享投递结果未确认，不自动重发：${e.message}`);
        return { attempted: true, accepted: false };
      }
    } catch (e) { onError(`场景主动分享检查失败，普通聊天不受影响：${e.message}`); return { skipped: 'error' }; }
    finally { running = false; }
  }
  return { tick };
}

export function buildLifeSceneSharePrompt(event, lifeContext, roleText) {
  return `【角色卡】\n${roleText}\n${lifeContext}\n【主动分享机会】这是管理员授权的私聊分享，不是有人刚发来消息，也不是要你回复旧聊天。虚拟生活计划刚切换到“${event.scene.activity}”，时段预计${event.scene.end}结束。\n灵感方向（只是候选，不是已发生事实）：${event.seed}。优先结合已有记录和角色喜好，选一个你愿意分享的具体小细节、一个小趣味或感受；允许建立合理的虚拟生活细节，但不冒充现实证据，不编造用户、群友或第三方私事。\n值得分享时返回供宿主发送的1至2条短句，自然开口，不以“场景切换/定时提醒/生活实验”开头，不念日程，不每次问在干嘛或要求回复，不为了活人感硬编新经历。新确定的生活细节用life_propose提交lifeEvents，宿主确认发送成功后才保存；计划未完成不标completed。仅因想法或感受开口时不必登记事件。没有值得分享的内容，直接内部结束，不能把内部说明发给用户。\n本轮只用正常文字发送工具；不搜索、不生图、不调用手机、不改空间或账号资料。不要调用宿主已读操作清除新到用户消息，不设置等待或定时器，不重复发送；若未读里出现新消息，留给正常消息回合处理。`;
}
