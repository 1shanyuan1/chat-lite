import type { ProtocolSetting } from './protocol'

export type ProviderGroup = '聚合平台' | '国内厂商' | '海外厂商' | '本地 / 自建'

export interface Provider {
  id: string
  label: string
  group: ProviderGroup
  baseUrl: string
  protocol: ProtocolSetting
  /** 只作为初始值，实际以 /models 拉到的为准 */
  model?: string
  /** 该平台 /models 不可用或需要手填时的提示 */
  modelHint?: string
  /** 关掉模型列表按钮，避免给用户一个必然失败的入口 */
  supportsModelList?: boolean
}

export const PROVIDERS: Provider[] = [
  // ---------- 聚合平台 ----------
  {
    id: 'tokenrhythm',
    label: '基元律动',
    group: '聚合平台',
    baseUrl: 'https://tokenrhythm.studio/v1',
    protocol: 'auto',
    model: 'qwen3.8-flash',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    group: '聚合平台',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai',
    model: 'openai/gpt-4o-mini',
  },
  {
    id: 'ppio',
    label: 'PPIO 派欧云',
    group: '聚合平台',
    baseUrl: 'https://api.ppinfra.com/v3/openai',
    protocol: 'openai',
  },

  // ---------- 国内厂商 ----------
  { id: 'deepseek', label: 'DeepSeek', group: '国内厂商', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai', model: 'deepseek-chat' },
  { id: 'siliconflow', label: '硅基流动', group: '国内厂商', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai', model: 'Qwen/Qwen3-8B' },
  {
    id: 'dashscope',
    label: '阿里云百炼',
    group: '国内厂商',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai',
    model: 'qwen-plus',
  },
  { id: 'zhipu', label: '智谱 GLM', group: '国内厂商', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai', model: 'glm-4-flash' },
  { id: 'moonshot', label: '月之暗面 Kimi', group: '国内厂商', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai', model: 'moonshot-v1-8k' },
  {
    id: 'volcengine',
    label: '火山方舟 豆包',
    group: '国内厂商',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    protocol: 'openai',
    modelHint: '模型名需填「推理接入点 ID」（ep- 开头），或直接用平台上的模型 ID',
  },
  { id: 'hunyuan', label: '腾讯混元', group: '国内厂商', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', protocol: 'openai' },
  {
    id: 'qianfan',
    label: '百度千帆',
    group: '国内厂商',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    protocol: 'openai',
    model: 'ernie-4.5-turbo-128k',
  },
  {
    id: 'spark',
    label: '讯飞星火',
    group: '国内厂商',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    protocol: 'openai',
    model: 'lite',
    modelHint: '星火可能不提供模型列表接口，请手填模型名（如 lite / generalv3.5 / 4.0Ultra）',
  },
  { id: 'stepfun', label: '阶跃星辰', group: '国内厂商', baseUrl: 'https://api.stepfun.com/v1', protocol: 'openai', model: 'step-2-16k' },
  { id: 'minimax', label: 'MiniMax', group: '国内厂商', baseUrl: 'https://api.minimax.chat/v1', protocol: 'openai' },
  { id: 'baichuan', label: '百川智能', group: '国内厂商', baseUrl: 'https://api.baichuan-ai.com/v1', protocol: 'openai' },
  {
    id: 'sensenova',
    label: '商汤日日新',
    group: '国内厂商',
    baseUrl: 'https://api.sensenova.cn/compatible-mode/v1',
    protocol: 'openai',
    supportsModelList: false,
    modelHint: '商汤不提供模型列表接口，请手填模型名（如 SenseChat-5）',
  },

  // ---------- 海外厂商 ----------
  { id: 'openai', label: 'OpenAI', group: '海外厂商', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', model: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic Claude', group: '海外厂商', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic', model: 'claude-sonnet-4-5' },
  {
    id: 'gemini',
    label: 'Google Gemini',
    group: '海外厂商',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'gemini',
    model: 'gemini-2.5-flash',
  },
  { id: 'xai', label: 'xAI Grok', group: '海外厂商', baseUrl: 'https://api.x.ai/v1', protocol: 'openai', model: 'grok-4' },
  { id: 'groq', label: 'Groq', group: '海外厂商', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai' },
  { id: 'mistral', label: 'Mistral', group: '海外厂商', baseUrl: 'https://api.mistral.ai/v1', protocol: 'openai', model: 'mistral-large-latest' },
  { id: 'together', label: 'Together AI', group: '海外厂商', baseUrl: 'https://api.together.xyz/v1', protocol: 'openai' },
  { id: 'perplexity', label: 'Perplexity', group: '海外厂商', baseUrl: 'https://api.perplexity.ai', protocol: 'openai', model: 'sonar' },
  {
    id: 'fireworks',
    label: 'Fireworks',
    group: '海外厂商',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    protocol: 'openai',
  },
  { id: 'deepinfra', label: 'DeepInfra', group: '海外厂商', baseUrl: 'https://api.deepinfra.com/v1/openai', protocol: 'openai' },
  { id: 'huggingface', label: 'HuggingFace', group: '海外厂商', baseUrl: 'https://router.huggingface.co/v1', protocol: 'openai' },
  {
    id: 'githubmodels',
    label: 'GitHub Models',
    group: '海外厂商',
    baseUrl: 'https://models.github.ai/inference',
    protocol: 'openai',
    modelHint: '需要 GitHub 个人访问令牌（PAT）作为 Key',
  },

  // ---------- 本地 / 自建 ----------
  { id: 'ollama', label: 'Ollama', group: '本地 / 自建', baseUrl: 'http://localhost:11434/v1', protocol: 'openai', model: 'qwen2.5:7b' },
  { id: 'lmstudio', label: 'LM Studio', group: '本地 / 自建', baseUrl: 'http://localhost:1234/v1', protocol: 'openai' },
  { id: 'vllm', label: 'vLLM / SGLang', group: '本地 / 自建', baseUrl: 'http://localhost:8000/v1', protocol: 'openai' },
  { id: 'oneapi', label: 'one-api / new-api', group: '本地 / 自建', baseUrl: 'http://localhost:3000/v1', protocol: 'openai' },
]

export const PROVIDER_GROUPS: ProviderGroup[] = ['聚合平台', '国内厂商', '海外厂商', '本地 / 自建']

export function findProvider(baseUrl: string): Provider | undefined {
  const target = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  return PROVIDERS.find((p) => p.baseUrl.toLowerCase() === target)
}

export const PROVIDER_LABEL_CUSTOM = '自定义'
