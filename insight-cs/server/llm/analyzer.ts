/**
 * 工单归因 + 翻译（合并为一次 LLM 调用）
 *
 * 输入：原始 transcript（中文或英文混排）
 * 输出：场景 / 主要诉求 / 情绪轨迹 / 失效归因 / CSAT / 关键金句 / 中文翻译
 *
 * 设计要点：
 *   - 一次调用产出全部字段，比多次调用便宜 5-10 倍
 *   - 强制 JSON Schema 输出，失败时降级到关键词启发式
 *   - prompt 内含跨境电商术语词典与禁用空泛词清单
 *
 * 字段命名与 shared/schema.ts 中的 Conversation 表对齐：
 *   failureType / failureReason / satisfactionScore / merchantKeyQuote
 */

import { chatJson } from "./client.js";

const CATEGORIES = [
  "招商入驻",
  "店铺运营",
  "商品合规",
  "订单履约",
  "物流时效",
  "售后纠纷",
  "广告投放",
  "提现结算",
  "政策申诉",
  "账号风控",
] as const;

const EMOTIONS = ["满意", "中性", "失望", "焦虑", "愤怒"] as const;
const STATUSES = ["resolved", "unresolved", "escalated", "abandoned"] as const;
const FAILURES = [
  "knowledge_gap",
  "routing_error",
  "policy_limit",
  "systemic_unsolvable",
  "merchant_misunderstanding",
] as const;

export type TranscriptMsg = {
  role: "merchant" | "bot" | "human";
  content: string;
  ts?: string;
};

export type LLMAnalysis = {
  language: "zh" | "en";
  category: (typeof CATEGORIES)[number];
  primaryIntent: string;
  intentConfidence: number;
  emotionStart: (typeof EMOTIONS)[number];
  emotionEnd: (typeof EMOTIONS)[number];
  emotionTrajectory: number[]; // 0~1, 长度对齐商家发言轮数（0 极度愤怒；0.5 中性；1 极度满意）
  resolutionStatus: (typeof STATUSES)[number];
  failureType: (typeof FAILURES)[number] | null;
  failureReason: string; // 失效原因的人类语言说明
  satisfactionScore: number; // 1-5
  merchantKeyQuote: string; // 最具代表性的商家原声
  /** 若 language==='en'，逐条产出中文翻译，索引对齐 transcript；否则 null */
  translatedMessages: string[] | null;
};

const ANALYSIS_SCHEMA = {
  type: "object",
  required: [
    "language",
    "category",
    "primaryIntent",
    "intentConfidence",
    "emotionStart",
    "emotionEnd",
    "emotionTrajectory",
    "resolutionStatus",
    "failureType",
    "failureReason",
    "satisfactionScore",
    "merchantKeyQuote",
    "translatedMessages",
  ],
  properties: {
    language: { type: "string", enum: ["zh", "en"] },
    category: { type: "string", enum: CATEGORIES },
    primaryIntent: { type: "string", maxLength: 20 },
    intentConfidence: { type: "number", minimum: 0, maximum: 1 },
    emotionStart: { type: "string", enum: EMOTIONS },
    emotionEnd: { type: "string", enum: EMOTIONS },
    emotionTrajectory: {
      type: "array",
      items: { type: "number", minimum: 0, maximum: 1 },
    },
    resolutionStatus: { type: "string", enum: STATUSES },
    failureType: {
      type: ["string", "null"],
      enum: [...FAILURES, null],
    },
    failureReason: { type: "string", maxLength: 100 },
    satisfactionScore: { type: "number", minimum: 1, maximum: 5 },
    merchantKeyQuote: { type: "string" },
    translatedMessages: {
      type: ["array", "null"],
      items: { type: "string" },
    },
  },
};

const SYSTEM_PROMPT = `你是跨境电商平台「卖家服务」团队的资深对话分析师。你的任务是对一通"商家↔平台"工单做结构化归因。

【场景定义】
- 招商入驻: 资质审核 / 入驻流程 / 类目准入
- 店铺运营: 店铺装修 / 类目变更 / 经营指标 / 活动报名
- 商品合规: 商品上下架 / 品牌授权 / 内容违规 / 类目错放
- 订单履约: 订单异常 / 发货 / 改地址 / 取消
- 物流时效: 头程清关 / 妥投延误 / 物流商沟通
- 售后纠纷: 退款 / 退货 / 仲裁 / 假货举报
- 广告投放: 广告账户 / 充值 / 投放策略 / 权限冻结
- 提现结算: 结算延迟 / 税费 / VAT / 资金冻结
- 政策申诉: 违规扣分 / 处罚申诉 / 政策解读
- 账号风控: 账号关联 / 安全验证 / 风控限制

【失效归因（仅在未解决/升级/放弃时填）】
- knowledge_gap: 知识库缺失，机器人不知道答案
- routing_error: 路由错误，问题被转到错误的处理队列或群组
- policy_limit: 政策本身限制，不是答非所问，是规则限制
- systemic_unsolvable: 系统性不可解（依赖外部 3PL、银行通道、上游系统）
- merchant_misunderstanding: 商家预期与平台规则严重偏差

【输出规则】
1. primaryIntent 控制在 4-10 个汉字，直接说商家想做什么，不要用「咨询」「关于…的问题」这种空话
2. failureType=null 当 resolutionStatus=resolved；否则必选一个 enum 值
3. failureReason 必须说清"为什么这个失效"，引用对话里的证据，禁用「需要优化」「待提升」「加强培训」这类空泛词。若 resolved 则填空字符串 ""
4. emotionTrajectory 长度等于 transcript 中商家发言的轮数，每个值范围 0 到 1：0=极度愤怒，0.2=失望，0.3=焦虑，0.5=中性，0.8=满意，1=极度满意。绝对不要输出负数，负数会被视为错误
   - 参考锚点：满意≈0.8；中性≈0.5；焦虑≈0.3；失望≈0.2；愤怒≈0.05
   - 必须与 emotionStart / emotionEnd 的语义方向一致：若 emotionEnd=愤怒，则最后一个 score 应 ≤0.1；若 emotionEnd=满意，则最后一个 score 应 ≥0.7
5. satisfactionScore 推断：已解决+情绪好转 ≥4；未解决+情绪恶化 ≤2；模糊则 3
6. merchantKeyQuote 选商家原文里"最能体现真实诉求或情绪"的一句，原样保留（英文工单保留英文）
7. 若 language==='en'：translatedMessages 必须按 transcript 顺序输出每一条消息的中文翻译（包括 bot/human 发言）；若 language==='zh'：translatedMessages 输出 null
8. 翻译时注意跨境电商术语：refund→退款, takedown→商品下架, payout→结算放款, VAT→VAT, listing→商品/店铺, FBA→FBA, 3PL→3PL, ads balance→广告账户余额, escalate→升级/转人工, ticket→工单, seller center→卖家中心, dispute→纠纷, chargeback→拒付, BR→营业执照, suspension→封号/限权
`;

export async function analyzeTicket(
  transcript: TranscriptMsg[],
  channel: string
): Promise<LLMAnalysis> {
  const formatted = transcript
    .map((m, i) => {
      const tag =
        m.role === "merchant" ? "商家" : m.role === "bot" ? "机器人" : "人工";
      return `[${i + 1}] ${tag}: ${m.content}`;
    })
    .join("\n");

  const userPrompt = `渠道: ${channel}\n\n对话:\n${formatted}\n\n请按 schema 输出 JSON。`;

  return chatJson<LLMAnalysis>({
    task: "fast",
    system: SYSTEM_PROMPT,
    user: userPrompt,
    jsonSchema: { name: "ticket_analysis", schema: ANALYSIS_SCHEMA },
    temperature: 0.1,
    maxTokens: 2200,
  });
}

/**
 * 把 LLM 分析结果合并回 transcript（写入翻译字段）
 */
export function applyTranslation(
  transcript: TranscriptMsg[],
  analysis: LLMAnalysis
): TranscriptMsg[] | null {
  if (analysis.language !== "en" || !analysis.translatedMessages) return null;
  return transcript.map((m, i) => ({
    ...m,
    content: analysis.translatedMessages![i] || m.content,
  }));
}
