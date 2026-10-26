const minutes = s => typeof s.start === 'string' ? Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3)) : NaN;
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function intent(text, currentId) {
  const times = [];
  if (/早饭|早餐/.test(text)) times.push(s => s.id === 'breakfast' || /早饭|早餐/.test(s.activity));
  else if (/早上|上午|今早|清晨/.test(text)) times.push(s => minutes(s) >= 240 && minutes(s) < 690);
  if (/午饭|午餐/.test(text)) times.push(s => s.id === 'lunch' || /午饭|午餐/.test(s.activity));
  else if (/中午|午休/.test(text)) times.push(s => minutes(s) >= 690 && minutes(s) < 840);
  if (/下午|午后/.test(text)) times.push(s => minutes(s) >= 840 && minutes(s) < 1020);
  if (/晚饭|晚餐/.test(text)) times.push(s => /晚饭|晚餐/.test(s.activity) || s.id === 'dinner' || s.id === 'break');
  else if (/晚上|傍晚|今晚|夜里|睡前/.test(text)) times.push(s => minutes(s) >= 1020);
  const books = /书名|读书|看书|什么书|看的书|看了.*书|看过.*书|那本|这本|哪本|书里|书中|书的|小说|阅读|读了什么|读的|读后|读到|狐狸/.test(text);
  const meals = /吃了什么|吃什么|吃啥|吃的|喝了什么|喝什么|喝的/.test(text);
  const extraTopics = [
    [/游戏|玩什么|玩了啥|玩的什么/, /game|游戏/, /游戏/],
    [/什么歌|听歌|音乐|哪首歌/, /song|music|歌/, /音乐|听歌/],
    [/电影|追剧|什么剧/, /movie|film|电影|剧名/, /电影|追剧/],
    [/哪门课|什么课|上课|学了什么/, /course|课程|科目/, /上课|学习/],
  ].filter(([query]) => query.test(text));
  const allDay = /一整天|整天|一天|全天|今天.*(?:都做|都干|做了|干了|发生|经历)|当天.*总结/.test(text);
  const current = /现在|这会儿|此刻|正在干|在干嘛|在做什么/.test(text);
  const entity = s => Object.values(s.details || {}).some(v => {
    const name = String(v).replace(/[《》]/g, '');
    return name.length >= 2 && text.includes(name);
  });
  const hasEntity = slots => slots.some(entity);
  return { allDay, known: slots => allDay || times.length || books || meals || extraTopics.length || current || hasEntity(slots),
    match: s => {
      if (allDay) return true;
      if (times.length && !times.some(f => f(s))) return false;
      if (!times.length && current && s.id !== currentId) return false;
      if (books && !/book|书名|阅读/.test(Object.keys(s.details || {}).join(' ')) && !/阅读|看书|读书/.test(s.activity)) return false;
      if (meals && !/food|drink|食物|饮料/.test(Object.keys(s.details || {}).join(' ')) && !/早饭|午饭|晚饭|餐/.test(s.activity)) return false;
      if (extraTopics.length && !extraTopics.some(([, fields, activity]) => fields.test(Object.keys(s.details || {}).join(' ')) || activity.test(s.activity))) return false;
      return Boolean(times.length || books || meals || extraTopics.length || current || entity(s));
    } };
}

/** Keyword/time gate only; no model request, no mutation of stored facts. */
export function selectLifeDetails({ days, role, date, slots, topic = '', context = [], currentId }) {
  const text = String(topic).slice(0, 300);
  const roleDays = Object.values(days).filter(d => d.role === role);
  const dates = new Set();
  for (const match of text.matchAll(/\d{4}-\d{2}-\d{2}/g)) dates.add(match[0]);
  if (/昨天|昨日/.test(text)) dates.add(shiftDate(date, -1));
  if (/前天/.test(text)) dates.add(shiftDate(date, -2));
  if (!dates.size || /今天|今日|今早|今晚/.test(text)) dates.add(date);
  let request = intent(text, currentId);
  const allSlots = roleDays.flatMap(d => d.slots);
  if (!request.known(allSlots) && /^(?:那|然后|后来|再|具体|细细|细说|展开|刚才|为什么[呀啊呢？?]*$)|细细讲|具体一点|具体点/.test(text)) {
    for (const message of context.slice(-6).reverse()) {
      const previous = intent(String(message?.text ?? message).slice(0, 400), currentId);
      if (previous.known(allSlots)) { request = previous; break; }
    }
  }
  const confirmed = s => s.confidence === 'virtual_self_report';
  const historical = /以前|之前|过去|最近几天/.test(text);
  const max = request.allDay ? 8 : 3;
  const facts = dates.has(date) ? slots.filter(s => confirmed(s) && request.match(s)).slice(0, max) : [];
  const history = roleDays.filter(d => d.date !== date && (dates.has(d.date) || historical && d.date < date)).sort((a, b) => b.date.localeCompare(a.date))
    .flatMap(d => d.slots.filter(s => confirmed(s) && request.match(s)).map(s => ({ date: d.date, ...s }))).slice(0, 3);
  const index = slots.filter(confirmed).map(s => `${s.id}:${Object.keys(s.details).join('/')}`).join('；');
  return { facts, history, index, allDay: request.allDay,
    weekly: /这周|一周|上周|上个星期|七日|最近[七7]天|周总结/.test(text),
    historical, matches: request.match };
}
