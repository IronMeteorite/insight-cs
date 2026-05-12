/**
 * 商家画像 LLM 助手
 *
 * - generateMerchantNarrative: 基于工单摘要,生成"画像总结 + 推荐动作"
 */
import { chatJson } from "./client";

export type MerchantTicketSummary = {
  ticketId: string;
  category: string;
  emotionEnd: string;
  emotionScore: number; // 0~1
  resolutionStatus: string;
  failureType: string | null;
  csat: number | null;
  quote: string | null;
  occurredAt: string;
};

export type MerchantNarrative = {
  riskNarrative: string;
  recommendedAction: string;
  keyQuotes: { quote: string; ticketId: string; emotion: string }[];
};

export async function generateMerchantNarrative(input: {
  merchantId: string;
  region: string;
  ticketCount: number;
  badCaseRate: number;
  avgEmotionEnd: number; // 0~1
  topCategories: { category: string; count: number }[];
  topFailureTypes: { type: string; count: number }[];
  tickets: MerchantTicketSummary[];
}): Promise<MerchantNarrative> {
  const summary = input.tickets
    .map(
      (t) =>
        `- [${t.occurredAt.slice(0, 10)}] ${t.ticketId} | ${t.category} | ${t.resolutionStatus} | 情绪结束=${t.emotionEnd}(${t.emotionScore.toFixed(2)})${
          t.failureType ? ` | 归因=${t.failureType}` : ""
        }${t.quote ? ` | "${t.quote.slice(0, 60)}"` : ""}`
    )
    .join("\n");

  const system = [
    "你是跨境电商平台的商家关系经理。",
    "我会给你一个商家在最近一段时间的所有客服工单摘要。",
    "请基于这些事实,产出: ",
    "1) 一段 80-120 字的中文商家画像总结(说清楚这个商家的核心痛点、情绪走向、是否有流失风险)",
    "2) 一条 30-50 字的下一步推荐动作(给到运营/客服主管的具体建议,要可执行)",
    "3) 从工单 quote 中挑出最具代表性的 1-3 条原声(要能体现商家真实诉求或情绪)",
    "保持客观,不要编造未在工单中出现的事实。",
  ].join("\n");

  const user = `商家ID: ${input.merchantId} | 区域: ${input.region}
工单数: ${input.ticketCount} | Bad Case 率: ${(input.badCaseRate * 100).toFixed(1)}% | 平均收尾情绪: ${input.avgEmotionEnd.toFixed(2)}(0=愤怒,1=满意)
Top 业务场景: ${input.topCategories.map((c) => `${c.category}×${c.count}`).join(", ")}
Top 失败归因: ${input.topFailureTypes.map((f) => `${f.type}×${f.count}`).join(", ") || "无"}

工单清单:
${summary}`;

  return chatJson<MerchantNarrative>({
    task: "fast",
    system,
    user,
    maxTokens: 800,
    timeoutMs: 25_000,
    jsonSchema: {
      name: "MerchantNarrative",
      schema: {
        type: "object",
        required: ["riskNarrative", "recommendedAction", "keyQuotes"],
        properties: {
          riskNarrative: { type: "string", description: "80-120 字商家画像总结" },
          recommendedAction: { type: "string", description: "30-50 字可执行下一步动作" },
          keyQuotes: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              required: ["quote", "ticketId", "emotion"],
              properties: {
                quote: { type: "string" },
                ticketId: { type: "string" },
                emotion: { type: "string" },
              },
            },
          },
        },
      },
    },
  });
}
