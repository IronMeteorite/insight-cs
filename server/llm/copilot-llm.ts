/**
 * 实时 Copilot LLM 助手
 *
 * 输入: 当前对话所有轮次(merchant/bot/human)
 * 输出: 单轮增量分析 — 情绪、升级风险、失败预测、话术建议
 *
 * Prompt 设计为极简,~150 token 输出,单次成本 < ¥0.001
 */
import { chatJson } from "./client";

export type CopilotTurn = {
  role: "merchant" | "bot" | "human" | "agent";
  content: string;
};

export type CopilotAnalysis = {
  emotion: number; // 0~1 当前情绪状态
  emotionLabel: string; // 愤怒/失望/焦虑/中性/满意
  escalationRisk: number; // 0~1 升级人工/差评的风险
  predictedFailureTypes: { type: string; confidence: number }[]; // 最多 3 个
  suggestedReplies: { text: string; rationale: string }[]; // 2-3 条
  redFlags: string[]; // 需要立即注意的信号(可为空)
};

const SYSTEM_PROMPT = [
  "你是跨境电商平台的客服坐席副驾,帮助人工客服实时把握商家情绪并提供下一步话术。",
  "我会给你一段正在进行的客服对话(可能包括机器人、人工、商家三种角色)。",
  "你必须只关注**最后一轮商家发言**,但结合前文上下文来分析。",
  "",
  "输出字段说明:",
  "- emotion: 0~1 之间的浮点数表示商家当前情绪。0=愤怒, 0.2=失望, 0.3=焦虑, 0.5=中性, 0.8=满意, 1=极度满意。",
  "- emotionLabel: 必须从 [愤怒, 失望, 焦虑, 中性, 满意] 中选一个",
  "- escalationRisk: 0~1,表示这通对话最终升级人工/差评/恶评的概率",
  "- predictedFailureTypes: 从 [knowledge_gap, routing_error, policy_limit, merchant_misunderstanding, systemic_unsolvable] 中预测可能的失败类型,最多 3 个,带置信度",
  "- suggestedReplies: 给客服坐席的 2-3 条话术建议。每条 30-80 字,要直接可用(不是'建议你说...'),并附 15-30 字的理由。",
  "- redFlags: 需要立即注意的信号,例如商家提到法律、监管、社交媒体曝光、连续投诉。无则空数组。",
  "",
  "严格按 JSON Schema 输出,不要任何额外文字。",
].join("\n");

const SCHEMA = {
  type: "object",
  required: ["emotion", "emotionLabel", "escalationRisk", "predictedFailureTypes", "suggestedReplies", "redFlags"],
  properties: {
    emotion: { type: "number", minimum: 0, maximum: 1 },
    emotionLabel: { type: "string", enum: ["愤怒", "失望", "焦虑", "中性", "满意"] },
    escalationRisk: { type: "number", minimum: 0, maximum: 1 },
    predictedFailureTypes: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        required: ["type", "confidence"],
        properties: {
          type: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    suggestedReplies: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        required: ["text", "rationale"],
        properties: {
          text: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
    redFlags: { type: "array", items: { type: "string" } },
  },
};

function formatTranscript(turns: CopilotTurn[]): string {
  return turns
    .map((t, i) => {
      const tag =
        t.role === "merchant"
          ? "商家"
          : t.role === "bot"
          ? "机器人"
          : t.role === "human" || t.role === "agent"
          ? "人工客服"
          : t.role;
      return `[${i + 1}] ${tag}: ${t.content}`;
    })
    .join("\n");
}

export async function analyzeCopilotTurn(turns: CopilotTurn[]): Promise<CopilotAnalysis> {
  if (turns.length === 0) throw new Error("turns is empty");
  const lastMerchant = [...turns].reverse().find((t) => t.role === "merchant");
  if (!lastMerchant) throw new Error("no merchant turn");

  const user = `对话上下文:
${formatTranscript(turns)}

请基于上述完整对话,重点分析**最后一条商家发言**,给出情绪/升级风险/话术建议。`;

  const result = await chatJson<CopilotAnalysis>({
    task: "fast",
    system: SYSTEM_PROMPT,
    user,
    maxTokens: 800,
    temperature: 0.2,
    timeoutMs: 20_000,
    jsonSchema: { name: "CopilotAnalysis", schema: SCHEMA },
  });

  // 防御性 clamp
  result.emotion = Math.max(0, Math.min(1, +result.emotion.toFixed(3)));
  result.escalationRisk = Math.max(0, Math.min(1, +result.escalationRisk.toFixed(3)));
  return result;
}
