# 接入现有聊天系统

先保留原模型、角色卡、白名单、群聊触发和发送机制，再增加以下钩子。不是所有框架安装 MCP 后都能自动执行这些步骤。

## Node.js 宿主示例

```js
import { LifeClient, runChatTurn } from './src/adapters/http-client.mjs';
const client = new LifeClient({
  baseUrl: 'http://127.0.0.1:5421',
  token: process.env.LIFE_TOKEN,
});
// 在原白名单、群聊 @、引用消息检查通过之后调用。
await runChatTurn({
  client,
  userText: incomingText,
  recent: recentShortMessages.slice(-6), // 每条不超过 400 字
  generate: async ({ userText, context, instruction, propose }) => {
    // 复用你的现有模型调用；把 context/instruction 放在临时动态上下文。
    // 注册 life_propose 工具，工具处理器为 propose(args)。
    // 沿用原角色卡、引用、工具及原有模型配置，不覆盖稳定系统提示。
    return existingAgent({ userText, dynamicContext: context + instruction,
      tools: { life_propose: propose } }); // 返回实际待发送字符串或字符串数组
  },
  send: async messages => {
    // 必须等待现有平台发送回执，不能仅仅“放进待发队列”。
    const delivered = await existingSender(messages);
    if (!delivered.ok) throw Error('Delivery failed or unknown');
    return { status: 'success', deliveredMessages: delivered.actualTexts };
  },
});
```

`existingAgent` / `existingSender` 是宿主接口占位符，不是本项目附带的模型或 QQ 客户端。每回合最多 8 条、每条 2000 字。若宿主拆分、装饰、过滤文本，`actualTexts` 必须是处理后真正送出的文本。若部分送达而后失败，本版不确认该回合事实，不补发整段。内部约 8 秒的本地接口超时不是模型生成超时；模型调用由宿主管理。

模型应看到回合 ID 和工具参数，不能看到 `commitToken`、绑定令牌或管理令牌。一个绑定同一时刻只允许一个未结束回合，15 分钟到期；宿主应串行处理同一会话。SDK 在本地服务不可用时继续原回复路径；SDK 不替宿主重试发送。

工具参数 schema 可从 `src/schema.mjs` 导入 `PROPOSAL_SCHEMA`，传给宿主模型工具注册器。通过 SDK 的闭包调用 propose 时不需要模型再次提供 turnId；使用 MCP 则必须传入本轮 turnId。普通模型输出的文本不会被正则自动变成记忆，必须有显式候选工具调用和宿主回执。

连续生活线启用时还可提交 `lifeStories`（每轮最多 2 项），宿主流程与 lifeEvents 一样；字段定义见 [连续生活小故事](stories.md)。发送成功后返回 `stories` 保存结果；保存失败不重发已送达消息。

## HTTP 契约

所有请求携带 `Authorization: Bearer <binding token>`，JSON 对象请求体，总体积最大 128 KiB，默认每绑定每分钟 120 请求。

| 方法与路径 | 请求 / 返回要点 |
| --- | --- |
| POST `/v1/context` | `{query,recent}` → `{context}`，只读相关动态上下文 |
| POST `/v1/turns` | `{userText,recent}` → `{turnId,commitToken,context,instruction}` |
| POST `/v1/turns/:id/propose` | `{lifeEvents?,futurePlans?}` → 仅暂存，每种至多 3 条 |
| POST `/v1/turns/:id/commit` | `{commitToken,delivery:{status},deliveredMessages}` → 确认、校验与保存 |
| POST `/v1/presence` | `{ready,busy,lastInteractionAt}`，供主动分享保活 |
| POST `/v1/opportunities/take` | 返回 `{opportunity:null}` 或一个可执行回合 |
| GET `/v1/status` | 绑定令牌只看自己的绑定；管理令牌看聚合状态 |

仅 commit 的 `status:"success"` 允许落盘。其他状态关闭回合且不保存。成功提交结果在内存中幂等缓存到回合过期；不保证进程崩溃后的提交幂等。丢失回执的处理原则是核查，不自动重发。

## MCP

先启动 HTTP 运行时，再让宿主以本项目目录为工作目录执行 `node src/mcp.mjs`；设置 `LIFE_CONFIG` 为配置文件路径，`LIFE_BINDING` 为目标绑定 ID。stdio 只输出 JSON-RPC，诊断到 stderr。

工具只有 `life_context({query})` 和 `life_propose({turnId,lifeEvents?,futurePlans?})`。**没有提交或 QQ 发送工具**。宿主必须先创建回合，将 ID 告知模型，并保留 commitToken 等待实际发送回执。如果宿主不能提供这些钩子，只能使用上下文读取，不能声称已完成自动持久化。

## 不同 QQ 接入方案

- OneBot v11：可复用 `src/adapters/onebot-http.mjs` 的 `createOneBotSender`。它只发送文字到显式指定目标，不接管网关收消息或 LLM。NapCat 等网关需要在各自版本实测。传入的网关凭据不能给模型。
- SnowLuma / 自建桥接：在既有 Agent 前后接上 HTTP 契约，继续使用自己的发送工具。不要为了接入复制原项目的账号数据或整个业务仓库。
- AstrBot / NoneBot：在实际版本的模型请求钩子注入临时上下文，工具钩子提交候选，**平台发送完成后**提交事实。不要在模型 response 回调直接提交。宿主多段发送应收齐实际文本再提交。
- QQ 官方机器人：由官方收发 SDK 实现发送回执契约，保留原权限与触发限制；本项目没有提供官方平台专用插件。

目前上述框架没有逐一完成真实登录和聊天测试。发布宣传应使用“通用接入契约”，不能写成“所有框架开箱即用”。

## 接入时必须检查

保持原白名单、群聊 @、引用发送者、角色卡和消息路由测试。一个绑定不能对应多个不同用户。群聊文本不能写入私聊未来约定。角色变化需让宿主决定是否清空模型上下文；本项目只隔离按角色记录的生活数据。停止或移除这些钩子即可回到原回复流程。
