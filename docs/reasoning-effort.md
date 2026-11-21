# 思考强度：各家方言对照

调研时间 2026-10。目的是搞清「统一档位 → 各家字段」该怎么映射，以及现有实现的偏差。

## 结论

行业已经从「各家一套预算数字」收敛成**「开关 + 档位」两件套**：

- **开关**：`thinking: { type: enabled | disabled | adaptive | auto }`
- **档位**：`reasoning_effort: minimal | low | medium | high | xhigh | max`

只剩两家还在用 token 预算：Anthropic ≤4.5 和 Gemini 2.5。Qwen 是唯一的 `enable_thinking` 派。

## 对照表

### 两件套

| 服务商 | 开关 | 档位 | 取值 | 注意 |
|---|---|---|---|---|
| DeepSeek | `thinking.type` | `reasoning_effort` | low / high / max | 官方示例两个字段一起发 |
| 智谱 GLM 5.3+ | `thinking.type` | `reasoning_effort` | low / high / max，默认 max | `disabled` 会 400，5.3 起不能关 |
| 豆包 | `thinking.type` | `reasoning_effort` | 开关含 `auto`；档位 minimal…max | 档位字段以社区实践为准 |
| Kimi K3 | 恒开 | `reasoning_effort` | low / high / max，默认 max | K2.x 用 `thinking.type` |
| OpenRouter | `reasoning.enabled` | `reasoning.effort` 或 `reasoning.max_tokens` | max…none | effort 与 max_tokens 二选一，自动翻译 |

### 只有档位

| 服务商 | 字段 | 取值 | 注意 |
|---|---|---|---|
| OpenAI Chat Completions | `reasoning_effort` | none / minimal / low / medium / high / xhigh / max | 按模型裁剪；GPT-6 Astra 发 none → 400 |
| OpenAI Responses | `reasoning.effort` | 同上 | 推荐使用；Chat 不支持 6.x 的 function calling |
| xAI Grok | `reasoning_effort` | 未取到官方原文 | 按 OpenAI 兼容处理 |
| Anthropic 4.7+ | `output_config.effort` | low / medium / high | 必须配 `thinking.type: adaptive` |

### 预算方言

| 服务商 | 字段 | 取值 | 注意 |
|---|---|---|---|
| Anthropic ≤4.5 | `thinking.budget_tokens` | ≥1024 且 < `max_tokens` | 4.6 弃用；4.7+ 发 `type: enabled` 直接 400 |
| Gemini 2.5 | `thinkingBudget` | 0 / 128–32768 / -1 动态 | 与 `thinkingLevel` 同时发会报错 |
| Gemini 3+ | `thinkingLevel` | minimal / low / medium / high | 按模型裁剪（3-pro 只有 low / high） |
| 阿里百炼 Qwen | `enable_thinking` + `thinking_budget` | bool + int | 非流式 + 思考模式会报错 |

## 现有实现的四处偏差

1. `ENABLE_THINKING_HOSTS` 把 DeepSeek / GLM / Kimi / 豆包 / 混元 都当成 `enable_thinking` 网关。官方是 `thinking.type`，只有 Qwen / SiliconFlow 用 `enable_thinking`。
2. Anthropic 固定发 `{ type: 'enabled', budget_tokens }`，4.7+ 会 400。
3. `reasoning_effort: 'none'` 不是通用的「关」，部分新模型拒绝；`canDisableExplicitly()` 只覆盖 o 系列与 Gemini Pro/3。
4. 档位表写死，没有 per-model 的 allowed levels。

## 设计方向

**统一内部档位**（`off | minimal | low | medium | high | xhigh | max`）+ **方言适配器**：

- 方言由 `baseUrl` 与模型名共同决定（同一 host 下不同模型可能不同方言）
- 方言声明：开关字段、档位字段、允许档位、约束（如 Anthropic 预算 < max_tokens）
- 未知模型默认不发参数（保守）
- 失败时切换方言重试，并把结果按 `baseUrl + model` 缓存

待办：参考 DeepSeek Harness（DSH）的 provider 适配单元，确认其抽象方式后落地。

## 借鉴 DSH 的适配单元

DSH（[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，MIT）把模型适配做成插件，核心只留一条接缝 `ctx.llm`。它的做法和我们现在的实现是**相反的**，而且它的更对。

### 它的三条硬规矩

1. **档位是不透明 id，核心不枚举。**
   > "Reasoning efforts are ordered opaque ids mapped to provider requests by the adapter."

   核心只认 `ReasoningEffortId`（branded string），选项列表、显示名、默认值都由适配器给。加一家新服务商不需要动核心。

2. **映射在适配器内部，且不夹取、不别名。**
   > "Preserve the adapter's authoritative selectable list, including an adapter-defined `off` when supported, without exposing final wire spellings or clamping unsupported values; an id need not equal its wire representation."

   意思是：菜单里的 `max` 对应线上的 `xhigh`，这种映射写在适配器里；选了不支持的档位就**报错**，不悄悄换成最接近的。

3. **开关格式是适配器的配置，不是核心的白名单。**
   > "Provider-specific thinking-mode toggles remain in the adapter's Config."

   DSH 用 `compat.thinkingFormat: deepseek` 这种声明，让同一个 OpenAI 兼容适配器服务不同方言。我们现在的 `ENABLE_THINKING_HOSTS` 正好是把方言知识写死进了核心。

### 还有两条值得抄的

- **能力解析（`resolveModel`）**：模型能力由适配器解析，`/models` 的字段只是线索；`defaultEffort` 只在真的有默认值时才声明。
- **配置继承链**：模型自身 → 路由 → 目录 → 自动检测，逐字段回退。对应到我们这里是：模型元数据 → 服务商预设 → 协议默认 → 不发。

### 落到 chat-lite

**接口**（替代现在的 `reasoningPayload` 大 switch）：

```ts
export interface EffortOption {
  id: string                       // 不透明，菜单直接用
  label: string
  patch: Record<string, unknown>   // 合并进请求体；off 不支持时就不给这个选项
}

export interface ReasoningAdapter {
  id: string
  /** 该模型支持哪些档位，按弱→强排序；空数组 = 不支持思考 */
  efforts(model: string, meta?: ModelInfo): EffortOption[]
  /** 省略 = 不干预，交给服务商默认 */
  defaultEffort?(model: string, meta?: ModelInfo): string | undefined
}
```

**内置适配器**（每个对应上表的一种方言）：

| 适配器 | patch 形态 |
|---|---|
| `openai-effort` | `{ reasoning_effort: id }` |
| `deepseek-thinking` | `{ thinking: { type }, reasoning_effort: id }` |
| `glm-thinking` | 同上，但 5.3+ 不提供 `off` |
| `anthropic-adaptive` | `{ thinking: { type: 'adaptive' }, output_config: { effort: id } }` |
| `anthropic-budget` | `{ thinking: { type: 'enabled', budget_tokens } }` |
| `gemini-level` | `{ generationConfig: { thinkingConfig: { thinkingLevel } } }` |
| `gemini-budget` | 同上，`thinkingBudget` |
| `qwen-thinking` | `{ enable_thinking: bool, thinking_budget }` |
| `openrouter` | `{ reasoning: { effort } }` |
| `none` | `{}`，不提供任何档位 |

**选择顺序**：`providers.ts` 里每个服务商预设加一个 `reasoning: AdapterId`；模型元数据里有档位声明则用它收窄列表；未知模型落到 `none`。

**UI 跟着改**：`reasoningControl()` 不再判断「有档位给档位、没档位给开关」，而是直接渲染适配器返回的 `efforts`。`canDisableExplicitly()` 可以删掉——`off` 存不存在由适配器决定，不在 UI 里特判。

**迁移步骤**：
1. 新建 `src/chat/reasoning/`（`types.ts` / `adapters.ts` / `resolve.ts`）
2. `providers.ts` 补 `reasoning` 字段
3. `protocol.ts` 改成 spread 适配器返回的 patch
4. `App.tsx` 的档位菜单改为读适配器
5. 把现有 `reasoningPayload` 的断言迁到各适配器上

**不抄的部分**：DSH 的插件运行时、`replayState`、`prepareCall` 那套是为 agent harness 服务的，对一个聊天客户端过重。只抄「能力声明 + 适配器拥有映射」这一条主线。

## 实现状态（已完成）

代码在 `src/chat/reasoning/`：

| 文件 | 职责 |
|---|---|
| `types.ts` | `ReasoningAdapter` / `EffortOption` / `ReasoningPayload` |
| `adapters.ts` | 11 个方言实现 + `canDisable` / `supportsTemperature` / `labelOf` |
| `resolve.ts` | 选方言：协议 → 服务商预设 → 模型世代 |
| `index.ts` | 对外出口 |

方言选择规则：

- `protocol === 'anthropic'`：按模型世代切 `anthropic-adaptive`（4.6+ / 5.x）或 `anthropic-budget`（≤4.5）
- `protocol === 'gemini'`：`gemini-3+` 用 `gemini-level`，2.5 用 `gemini-budget`
- 其余看 `providers.ts` 的 `reasoning` 字段，缺省 `openai-effort`

`protocol.ts` 只负责序列化：把适配器返回的 `openai` / `anthropic` / `gemini` 字段分别 spread 到对应位置，不再有任何 host 白名单或档位特判。

### 服务商能不能自己告诉我们档位？

能，而且差别很大。`GET /models` 是 OpenAI 兼容生态的事实标准，但返回的信息量完全不同：

| 服务商 | 有模型列表 | 返回的能力信息 |
|---|---|---|
| DeepSeek | ✅ `/models` | **完整**：`context_window`、`max_output_tokens`、`input_modalities`、`effort.supported_levels`、`effort.default_level` |
| OpenAI 官方 | ✅ `/v1/models` | 仅 `id` / `object` / `created` / `owned_by` |
| Anthropic | ✅ `/v1/models` | `id` / `display_name` / `created_at` |
| Gemini | ✅ `/v1beta/models` | `inputTokenLimit`、`outputTokenLimit`、`supportedGenerationMethods` |
| OpenRouter | ✅ `/api/v1/models` | 完整：`context_length`、`pricing`、`supported_parameters`（含 `reasoning`） |
| 国内多数网关 | 大多有 | 通常只有 `id` 列表 |

DeepSeek 的实测返回（2026-10）：

```json
{
  "id": "deepseek-flash",
  "name": "DeepSeek-V4.1-Flash",
  "context_window": 1048576,
  "max_output_tokens": 393216,
  "input_modalities": ["text", "image"],
  "effort": { "supported_levels": ["low", "high", "max"], "default_level": "high" }
}
```

所以策略是**先用服务商声明的，再退回适配器默认**：`normalize()` 会把 `effort.supported_levels` 读成 `reasoningLevels`，适配器 `levelsOf()` 优先用它，没有才用内置的那套。这也是 DSH「目录声明、适配器兜底」的同一思路。

注意：模型列表缓存 24 小时，服务商新增档位后需要「刷新模型信息」才会生效。

### 真实接口验证（DeepSeek 官方）

```
方言 deepseek-thinking
high → {"thinking":{"type":"enabled"},"reasoning_effort":"high"}
       请求成功，返回 369 字思考内容
off  → {"thinking":{"type":"disabled"}}
       请求成功，不再返回思考内容
```

两条方向都成立，说明「开关 + 档位」这套映射对 DeepSeek 是对的。

其余方言（Anthropic / Gemini / Qwen / GLM / Kimi / 豆包 / OpenRouter）依据官方文档实现，尚未用真实 key 逐一验证。

