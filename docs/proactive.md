# 场景切换主动分享

默认关闭。它由**本地时间检查**触发候选机会，之后才由宿主现有 Agent 判断是否值得分享；没有独立模型 API，也没有每分钟调用模型。

私聊绑定启用例：

```json
{"enabled":true,"maxPerDay":2,"minGapMinutes":240,"idleMinutes":20,
 "transitionGraceMinutes":15,"quietStart":"22:00","quietEnd":"08:00",
 "sceneIds":["breakfast","afternoon","evening"]}
```

以上对象放在 `life.proactive`。首次运行只建立基线，不补发当前场景；切角色同样只建立基线。只有切到允许的场景、在新场景开始后 15 分钟内、非静默时间且最近 20 分钟未互动才可能提供机会。最多每日 2 次尝试、至少间隔 4 小时；是尝试计数，发送失败不会返还次数。错过的场景不追发。

宿主流程：

1. 每 30 秒向 `/v1/presence` 上报 ready/busy/lastInteractionAt（毫秒时间戳），只在有发送权限且 Agent 可用时 ready=true。90 秒无心跳视为离线。
2. 每分钟请求 `/v1/opportunities/take`。有候选时先持久标记已领取，再返回含 context/instruction 的回合；宿主必须私下保留 commitToken。
3. 用已有模型处理返回的上下文，调用普通发送路径。可使用 `runChatTurn({opportunity,...})` 复用发送与提交。
4. 不值得分享时不发送，使用该回合 commitToken 提交 `delivery.status:"skipped"` 关闭回合。不要把内部跳过原因发给用户。

领取和发送不是一个原子操作；进程崩溃或未知结果不会自动重领，优先避免重复打扰。JSON机会文件中的 accepted 仅表示已产生候选，不表示用户已收到消息。无宿主轮询时启用开关也不会自动向 QQ 发消息。

真实主动分享需要宿主发送授权，不能用于未授权群聊。本功能不主动生图、改头像、发空间或操作手机。
