/**
 * 统一 LLM 客户端
 *
 * 抽象掉模型供应商差异，对外暴露三个能力：
 *   - chat({ user, system, jsonSchema? })   普通 / 结构化输出
 *   - chatJson<T>({ ... })                  结构化 JSON（自带 schema 校验 + fallback 抽取）
 *   - chatStream({ ... })                   流式纯文本
 *
 * 三种 provider：
 *   - platform: 沙箱内置 Anthropic 代理（Anthropic Messages API）— 仅演示用
 *   - deepseek / qwen / doubao: OpenAI 兼容 chat.completions — 国内可商用
 *
 * 切换 provider 只改环境变量：
 *   LLM_PROVIDER=deepseek + DEEPSEEK_API_KEY=...
 *   LLM_PROVIDER=qwen     + DASHSCOPE_API_KEY=...
 *   LLM_PROVIDER=doubao   + ARK_API_KEY=...
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// ============ 配置层（切换 API 只动这里） ============

export type ProviderName = "platform" | "deepseek" | "qwen" | "doubao";

type ProviderConfig = {
  baseURL?: string;
  apiKey: string;
  models: {
    fast: string; // 归因 / 翻译等高频任务
    quality: string; // 周报洞察等高质量任务
  };
};

function pickProvider(): { name: ProviderName; config: ProviderConfig } {
  const forced = process.env.LLM_PROVIDER as ProviderName | undefined;

  if (forced === "deepseek" || (!forced && process.env.DEEPSEEK_API_KEY)) {
    return {
      name: "deepseek",
      config: {
        baseURL: "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY || "",
        models: { fast: "deepseek-chat", quality: "deepseek-chat" },
      },
    };
  }
  if (forced === "qwen" || (!forced && process.env.DASHSCOPE_API_KEY)) {
    return {
      name: "qwen",
      config: {
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: process.env.DASHSCOPE_API_KEY || "",
        models: { fast: "qwen-plus", quality: "qwen-max" },
      },
    };
  }
  if (forced === "doubao" || (!forced && process.env.ARK_API_KEY)) {
    return {
      name: "doubao",
      config: {
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: process.env.ARK_API_KEY || "",
        models: {
          fast: process.env.DOUBAO_FAST_ENDPOINT || "doubao-1-6-lite",
          quality: process.env.DOUBAO_QUALITY_ENDPOINT || "doubao-1-6-pro",
        },
      },
    };
  }

  // 沙箱演示用（Anthropic Messages API）
  return {
    name: "platform",
    config: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      models: { fast: "claude_haiku_4_5", quality: "claude_sonnet_4_6" },
    },
  };
}

const { name: PROVIDER, config: CONFIG } = pickProvider();
console.log(
  `[llm] provider=${PROVIDER} fast=${CONFIG.models.fast} quality=${CONFIG.models.quality} hasKey=${Boolean(CONFIG.apiKey)}`
);

// 实例化客户端：platform 用 Anthropic，其它三家用 OpenAI 兼容 chat.completions
const openaiClient =
  PROVIDER !== "platform"
    ? new OpenAI({ apiKey: CONFIG.apiKey || "sk-placeholder", baseURL: CONFIG.baseURL })
    : null;

const anthropicClient = PROVIDER === "platform" ? new Anthropic() : null;

// ============ 对外类型 ============

export type LLMTask = "fast" | "quality";

export type ChatOptions = {
  task?: LLMTask;
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 若提供，要求模型严格按此 JSON Schema 返回（实际通过 prompt 约束） */
  jsonSchema?: { name: string; schema: object };
};

export type StreamOptions = ChatOptions & {
  onChunk: (text: string) => void;
};

// ============ 工具函数 ============

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`LLM timeout ${ms}ms`)), ms)
    ),
  ]);
}

async function retryable<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

function schemaSystemAddendum(schema: object): string {
  return [
    "你必须严格按以下 JSON Schema 输出，不允许有任何其他文字、注释、代码块标记或前后空行：",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
    "直接输出符合 schema 的 JSON 对象。",
  ].join("\n");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) return JSON.parse(m[1]);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  throw new Error("No JSON found in LLM response");
}

// ============ 核心 API ============

export async function chat(opts: ChatOptions): Promise<string> {
  const model =
    opts.task === "quality" ? CONFIG.models.quality : CONFIG.models.fast;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const temperature = opts.temperature ?? (opts.jsonSchema ? 0.1 : 0.4);

  let system = opts.system || "";
  if (opts.jsonSchema) {
    system = (system ? system + "\n\n" : "") + schemaSystemAddendum(opts.jsonSchema.schema);
  }

  const run = async () => {
    if (PROVIDER === "platform" && anthropicClient) {
      // 沙箱 Anthropic 代理
      const resp = await anthropicClient.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 1500,
        temperature,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: opts.user }],
      });
      // 拼接所有 text 块
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return text;
    }

    // OpenAI 兼容 chat.completions（DeepSeek / Qwen / Doubao）
    const resp = await openaiClient!.chat.completions.create({
      model,
      temperature,
      max_tokens: opts.maxTokens ?? 1500,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content: opts.user },
      ],
      ...(opts.jsonSchema
        ? { response_format: { type: "json_object" as const } }
        : {}),
    });
    return resp.choices?.[0]?.message?.content || "";
  };

  return withTimeout(retryable(run), timeoutMs);
}

export async function chatJson<T = unknown>(opts: ChatOptions): Promise<T> {
  const raw = await chat(opts);
  try {
    return extractJson(raw) as T;
  } catch (e) {
    throw new Error(
      `LLM JSON 解析失败：${(e as Error).message}。原始返回: ${raw.slice(0, 200)}`
    );
  }
}

export async function chatStream(opts: StreamOptions): Promise<string> {
  const model =
    opts.task === "quality" ? CONFIG.models.quality : CONFIG.models.fast;
  const temperature = opts.temperature ?? 0.4;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const run = async () => {
    let full = "";

    if (PROVIDER === "platform" && anthropicClient) {
      const stream = anthropicClient.messages.stream({
        model,
        max_tokens: opts.maxTokens ?? 1500,
        temperature,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content: opts.user }],
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          full += event.delta.text;
          opts.onChunk(event.delta.text);
        }
      }
      return full;
    }

    const stream = await openaiClient!.chat.completions.create({
      model,
      temperature,
      max_tokens: opts.maxTokens ?? 1500,
      stream: true,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.user },
      ],
    });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        opts.onChunk(delta);
      }
    }
    return full;
  };

  return withTimeout(retryable(run, 1), timeoutMs);
}

export function getProviderInfo() {
  return {
    provider: PROVIDER,
    fast: CONFIG.models.fast,
    quality: CONFIG.models.quality,
    hasKey: Boolean(CONFIG.apiKey),
  };
}
