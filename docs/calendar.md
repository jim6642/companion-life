# 聊天改变日程

私聊绑定同时开启 `life.futurePlans.enabled` 和 `life.calendar.enabled`。复用现有 Agent 的 `futurePlans` 候选与发送回执，不增加独立模型调用。

“今晚九点一起看电影” → 角色同意并提交 futurePlans → 宿主确认回复已送达 → 保存约定并占用 21:00 开始的时段。基础日程保持原样，展示/注入时按约定分割时间段；改期和取消会自动释放未来时段，恢复基础计划。约定不是已发生经历，到点不自动完成或发提醒。

## 参数

沿用 futurePlans 的 create/update/cancel/complete。新增可选 `durationMinutes`，15–360 分钟；省略时暂按 60 分钟估计并保存 durationEstimated。改期默认保留原时长。日期/开始时间不明确时先协商，不登记尚未同意的提议。

```json
{"futurePlans":[{"action":"create","date":"2026-01-10","time":"21:00",
 "durationMinutes":90,"title":"一起看电影","keywords":["电影"],
 "requestEvidence":"晚上九点一起看电影","evidence":"好，晚上九点一起看电影"}]}
```

修改用原 id 和 changeReason；取消用 cancel。只有明确聊到兑现后才 complete；提前结束会释放剩余估计时间。跨午夜按两个日期展示同一条约定。开始后改期/取消会保留已过去的原计划片段（标记已调整，不冒充完成），后续时间释放。

同一角色约定相互重叠或覆盖已确认完成的经历时返回 schedule_conflict。HTTP SDK/MCP 暂存阶段会提前检查冲突，模型可在发送前协商；实际送达后再次核对。宿主不能绕过工具调用自行承诺“已修改”。并发外部写入不在原型支持范围内。

普通 lifeEvents 仍使用原模板时段 ID。被约定打断的模板时段不能整体标完成；约定兑现使用 futurePlans.complete。最多每天 8 项同角色约定。

## 存储与隐私

futurePlans 保存约定和接受证据，calendarChanges 保存变更审计；days 保存基础日程，当前有效日程是二者合成的视图。关闭 calendar 不删除约定，展示恢复基础计划。

读取所属私聊时可显示约定标题；其他读取者只显示“已约好的活动”，不包含标题、对象、用户原文。HTTP 服务各绑定仍独立存储，不提供跨绑定共享私人约定。实时桥接若使用同一角色实例，应仅向有权限的私聊传入 ownerKey。

当前没有日程面板，不自动接受邀请，不实现群友修改管理员私人日程。若模板本来没有某个时间段，约定仍可单独占用该时间。
