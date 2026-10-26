# 数据、日程与工具参数

配置来自 `config.local.json`，不要提交 Git。令牌由 `npm run init` 使用本机安全随机数生成；示例占位符不能用于运行。每个绑定有独立数据文件，运行时只允许一个进程写相同数据目录。

```text
data/
  <binding>/life.json          日程、细节、修订、七日摘要、未来约定
  <binding>/scenes.json        主动分享计数与持久去重
  <binding>/opportunity.json   待领取的分享机会
  .runtime.lock               单写入进程锁
```

原始聊天不整段保存。事实证据、约定请求片段本身仍可能有隐私，以上均为本地明文；不要把 data 当示例上传。备份前停止运行时并完整复制 data 和本地配置。损坏文件会保留，暂停写入，不会自动清空或猜测修复。

本版每个绑定拥有独立的生活时间线；相同角色在不同绑定也不会共享私聊事实。这优先保证隐私隔离，不提供跨群共享人格记忆。绑定显示名应使用通用标识，不把真实账号写入公开示例。

## 日程模板

在绑定的 `life` 中配置：

```json
{
  "enabled": true,
  "timeZone": "Asia/Shanghai",
  "schedule": [
    {"id":"breakfast","start":"08:00","end":"08:30","activity":"吃早饭"},
    {"id":"morning","start":"08:30","end":"11:30","activity":"上课"},
    {"id":"evening","start":"19:00","end":"22:00","activity":"阅读和娱乐"}
  ],
  "detailGate":{"enabled":true},
  "weeklySummary":{"enabled":true},
  "futurePlans":{"enabled":true},
  "proactive":{"enabled":false}
}
```

按日与角色隔离。每天首次使用复制模板，不额外请求模型；已经生成的当日日程不会因编辑模板而自动重写。跨日期切到新一天。仅时间进入时段时显示 `active`（当前计划），时间过去仍是待确认的计划，不会自动成为经历。

`planned` 计划，`active` 当前活动，`completed` 已确认完成，`skipped` 跳过。新计划与另一活动重叠时，未完成的冲突时段标记跳过；已完成经历不能用新计划覆盖。单个模板最多 16 时段，同日内按时间排序、不重叠。可用 `roleSchedules` 按角色覆盖模板。

## life_propose：候选生活事件

```json
{
  "turnId": "宿主本轮提供的UUID",
  "lifeEvents": [{
    "date": "2026-01-10",
    "slotId": "breakfast",
    "status": "completed",
    "subject": "character",
    "basis": "own_virtual_experience",
    "certainty": "settled",
    "details": {"food":"小笼包","drink":"豆浆","note":"豆浆有点烫"},
    "evidence": "早饭吃了小笼包和豆浆，豆浆有点烫"
  }]
}
```

每次最多 3 事件，当前日期与有效时段。`evidence` 必须是本次实际送达文本的连续原文（最多 300 字）；细节最多 6 项，键不超过 24 字、值不超过 80 字，值须逐字见于证据。中英别名仅内置少量映射；推荐稳定使用 `food/drink/place/note/book/feeling`，避免同一事实使用不同键名。

`settled` 表示选定的虚拟事实，`tentative` 仅保存候选，不注入为已确认经历。不是对现实真实性的认证。更改活动须加 `activity`、`changeReason`，可加 `end`；新活动名也必须见于回复。未来时段不能直接标记 completed。

工具调用只暂存，重复调用同类数组替换本轮该类候选，不做无界累积。实际送达后才校验：错误证据拒绝、已知字段冲突保留旧值并记入 revisions。支持部分字段精确匹配时舍弃不支持的字段，返回 skippedFields；全部无证据不会转成已确认事实。原始记录与来源包含日期、角色、时段、状态、证据、会话绑定及确认程度。

## futurePlans：未来约定

私聊绑定且 `futurePlans.enabled=true`：

```json
{
  "futurePlans": [{
    "action":"create",
    "date":"2026-01-12",
    "time":"01:00",
    "title":"一起看电影",
    "keywords":["电影"],
    "requestEvidence":"后天一点陪我",
    "evidence":"好，后天一点陪你看电影"
  }]
}
```

绝对日期/时区必须按当前注入时间推断，尤其注意午夜。requestEvidence 须来自宿主提供的本轮用户原文，evidence 须来自成功送达的回复。公开群聊不能写入私聊约定。修改使用 `action:update` 和原 `id`、新 date/time/title、changeReason；取消/完成使用 `cancel/complete`、id、changeReason、两类 evidence。未来约定不能提前标记完成。

提前仅在日期、话题、约定或关键词触发时注入（最多 3 项），到当天可注入；过期不会自动兑现、不提供闹钟。无关话题不携带未来约定。

## 相关细节和七日摘要

完整今日粗略日程保留，细节按早/午/晚、关键词与短上下文匹配；这是本地规则筛选，不是向量数据库或额外模型检索，可能漏掉隐晦表达。没有命中时可用 `life_context(query)` 指定话题查阅。

七日窗口以角色最早记录日为锚，每满 7 个完整日历日在下次访问时生成本地摘要；不补造缺失日期，不把“当时正在做”变成完成，不删除原始记录。摘要文本有长度上限、来源哈希和可检索条目，历史不会全部注入每个请求。存储本身仍会增长，当前没有自动删除策略。
