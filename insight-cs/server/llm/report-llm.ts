/**
 * 周报洞察生成
 *
 * 把统计层算好的"桶"喂给 LLM，让它产出真正的分析文案。
 * 5 类段落：
 *   - topProblem: Top 系统性问题（"问题描述 / 影响范围 / 影响结果"）
 *   - failurePattern: 失败模式归类（"典型表现 / 触发场景"）
 *   - rootCause: 根因解释
 *   - recommendation: P0/P1/P2 行动建议
 *   - representativeWhy: 代表性对话的"为什么典型 / 对产品的启示"
 */

import { chatJson } from "./client.js";
import type { Conversation } from "@shared/schema";

const STYLE_RULES = `
【文风要求 — 强制遵守】
1. 写给产品负责人看，不是写给客服培训用
2. 强调"问题→原因→影响→行动"链路，每句话都要有信息密度
3. 禁用以下空泛短语：「提升模型能力」「优化用户体验」「加强培训」「需要关注」「进一步研究」「待改进」「持续优化」
4. 必须引用具体证据：工单 ID、商家原文片段、数字
5. 不要复述已经在表格里的数字，要从数字里抽出"so what"
6. 字数严格控制，宁可少不要凑字数
`;

function summarizeBucket(convs: Conversation[]): string {
  if (!convs.length) return "（空）";
  return convs
    .slice(0, 6)
    .map((c) => {
      const intent = c.primaryIntent;
      const quote = c.merchantKeyQuote || "";
      const status = c.resolutionStatus;
      const reason = c.failureType || "—";
      return `- ${c.externalId} [${c.category}/${status}/${reason}] 诉求:${intent} 原声:「${quote.slice(0, 80)}」`;
    })
    .join("\n");
}

// ============ Section 2: Top 系统性问题 ============

const TOP_PROBLEM_SCHEMA = {
  type: "object",
  required: ["title", "problemStatement", "impactScope", "impactResult"],
  properties: {
    title: { type: "string", maxLength: 30 },
    problemStatement: { type: "string", maxLength: 120 },
    impactScope: { type: "string", maxLength: 80 },
    impactResult: { type: "string", maxLength: 100 },
  },
};

export type TopProblemInsight = {
  title: string;
  problemStatement: string;
  impactScope: string;
  impactResult: string;
};

export async function generateTopProblem(input: {
  category: string;
  failureReason: string;
  bucketConvs: Conversation[];
  totalCount: number;
  bucketSize: number;
  avgCsat: number;
  prevBucketSize?: number;
}): Promise<TopProblemInsight> {
  const ratio = ((input.bucketSize / input.totalCount) * 100).toFixed(1);
  const prevHint = input.prevBucketSize
    ? `（环比上周 ${input.prevBucketSize} 通）`
    : "";

  const user = `
本桶定义：业务场景=${input.category}，失效归因=${input.failureReason}
本桶规模：${input.bucketSize} 通 / 整周 ${input.totalCount} 通（占比 ${ratio}%）${prevHint}
桶内集群 CSAT：${input.avgCsat.toFixed(2)} / 5.0

桶内代表性工单（最多 6 通）：
${summarizeBucket(input.bucketConvs)}

请输出 JSON：
- title: 用一句话点出"什么场景 × 什么失效"，10-25 字
- problemStatement: 从证据里抽象出问题本质，30-90 字，必须说清"机器人在哪一步卡住"或"政策与商家预期在哪个点错位"
- impactScope: 描述影响范围，含工单数和占比，30-60 字
- impactResult: 描述对商家和平台的实际影响，引用 CSAT 数字与情绪信号，40-80 字

${STYLE_RULES}
`.trim();

  return chatJson<TopProblemInsight>({
    task: "quality",
    user,
    jsonSchema: { name: "top_problem", schema: TOP_PROBLEM_SCHEMA },
    temperature: 0.3,
    maxTokens: 800,
  });
}

// ============ Section 3: 失败模式 ============

const PATTERN_SCHEMA = {
  type: "object",
  required: ["typicalBehavior", "triggerScenario"],
  properties: {
    typicalBehavior: { type: "string", maxLength: 120 },
    triggerScenario: { type: "string", maxLength: 100 },
  },
};

export type FailurePatternInsight = {
  typicalBehavior: string;
  triggerScenario: string;
};

export async function generateFailurePattern(input: {
  failureReason: string;
  topCategory: string;
  bucketConvs: Conversation[];
  bucketSize: number;
  totalCount: number;
}): Promise<FailurePatternInsight> {
  const user = `
失败模式：失效归因=${input.failureReason}，主要集中在「${input.topCategory}」场景
规模：${input.bucketSize} 通 / 整周 ${input.totalCount} 通

代表性工单：
${summarizeBucket(input.bucketConvs)}

请输出 JSON：
- typicalBehavior: 这类失败在对话里的典型表现，40-100 字，要具体（"机器人重复推送 X 模板"比"未能正确响应"好）
- triggerScenario: 商家通常在什么诉求下踩到这个模式，30-80 字

${STYLE_RULES}
`.trim();

  return chatJson<FailurePatternInsight>({
    task: "quality",
    user,
    jsonSchema: { name: "failure_pattern", schema: PATTERN_SCHEMA },
    temperature: 0.3,
    maxTokens: 600,
  });
}

// ============ Section 4: 根因分析 ============

const ROOT_CAUSE_SCHEMA = {
  type: "object",
  required: ["rootCauses"],
  properties: {
    rootCauses: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        required: ["layer", "description", "evidence"],
        properties: {
          layer: { type: "string", maxLength: 24 },
          description: { type: "string", maxLength: 120 },
          evidence: { type: "string", maxLength: 80 },
        },
      },
    },
  },
};

export type RootCauseInsight = {
  rootCauses: { layer: string; description: string; evidence: string }[];
};

export async function generateRootCause(input: {
  totalCount: number;
  unresolvedCount: number;
  failureShares: { reason: string; count: number }[];
  topProblems: { category: string; reason: string; size: number }[];
  sampleConvs: Conversation[];
}): Promise<RootCauseInsight> {
  const failureSummary = input.failureShares
    .map((f) => `${f.reason}: ${f.count} 通`)
    .join("，");
  const topSummary = input.topProblems
    .slice(0, 3)
    .map((p, i) => `${i + 1}. ${p.category}×${p.reason} (${p.size}通)`)
    .join("； ");

  const user = `
整周数据：${input.totalCount} 通 / 未解决 ${input.unresolvedCount} 通
失效归因分布：${failureSummary}
Top 系统性问题：${topSummary}

抽样工单：
${summarizeBucket(input.sampleConvs)}

请输出 JSON，3-4 条根因，每条按"层"组织：
- layer: 哪一层的根因，可选「知识库 / 路由策略 / 政策机制 / 跨系统协同 / 商家预期管理」之一，或自定义但不超过 12 字
- description: 这一层根因的具体内容，60-110 字，要说清"为什么这一层出问题导致了上述失效"
- evidence: 引用具体工单 ID 或商家原声片段作证据，30-70 字

不要把"模型能力不足"作为根因，那是症状不是根因。要追问到具体的内容/流程/规则层面。

${STYLE_RULES}
`.trim();

  return chatJson<RootCauseInsight>({
    task: "quality",
    user,
    jsonSchema: { name: "root_cause", schema: ROOT_CAUSE_SCHEMA },
    temperature: 0.35,
    maxTokens: 1500,
  });
}

// ============ Section 5: P0/P1/P2 建议 ============

const RECOMMENDATION_SCHEMA = {
  type: "object",
  required: ["recommendations"],
  properties: {
    recommendations: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        required: ["priority", "title", "action", "owner", "expectedImpact"],
        properties: {
          priority: { type: "string", enum: ["P0", "P1", "P2"] },
          title: { type: "string", maxLength: 30 },
          action: { type: "string", maxLength: 140 },
          owner: { type: "string", maxLength: 20 },
          expectedImpact: { type: "string", maxLength: 80 },
        },
      },
    },
  },
};

export type RecommendationInsight = {
  recommendations: {
    priority: "P0" | "P1" | "P2";
    title: string;
    action: string;
    owner: string;
    expectedImpact: string;
  }[];
};

export async function generateRecommendations(input: {
  topProblems: { category: string; reason: string; size: number; ratio: number }[];
  rootCauses: RootCauseInsight["rootCauses"];
  totalCount: number;
}): Promise<RecommendationInsight> {
  const topSummary = input.topProblems
    .slice(0, 4)
    .map((p, i) => `${i + 1}. ${p.category}×${p.reason} (${p.size}通, ${p.ratio.toFixed(1)}%)`)
    .join("\n");
  const rcSummary = input.rootCauses
    .map((r) => `- [${r.layer}] ${r.description}`)
    .join("\n");

  const user = `
本周 Top 问题：
${topSummary}

已识别根因：
${rcSummary}

整周工单总数：${input.totalCount}

请输出 JSON：3-5 条可执行优化建议，每条必须：
- priority: P0（本周必做）/ P1（两周内）/ P2（迭代规划），至少 1 条 P0
- title: 8-20 字，动词开头，如"补充 VAT 申诉问答库""引入双语人工承接路径"
- action: 80-130 字，要写出"做什么 / 怎么做 / 如何验证"，禁用空泛词，禁止只说"优化 X"
- owner: 责任方，限定在「客服策略组 / 算法 NLU / 政策中台 / 国际化运营 / 风控产品 / 财资产品」中选
- expectedImpact: 30-60 字，量化预期，如"预计本类型 bad case 率从 75% 降至 50%"

不要给出"提升模型理解能力"「持续优化」这种伪建议，每条都要能被工程师/产品当 Jira 单子来做。

${STYLE_RULES}
`.trim();

  return chatJson<RecommendationInsight>({
    task: "quality",
    user,
    jsonSchema: { name: "recommendations", schema: RECOMMENDATION_SCHEMA },
    temperature: 0.4,
    maxTokens: 1800,
  });
}

// ============ Section 6: 代表性对话精选 ============

const REPRESENTATIVE_SCHEMA = {
  type: "object",
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        required: ["conversationId", "whyTypical", "productImplication"],
        properties: {
          conversationId: { type: "string" },
          whyTypical: { type: "string", maxLength: 100 },
          productImplication: { type: "string", maxLength: 120 },
        },
      },
    },
  },
};

export type RepresentativeInsight = {
  picks: {
    conversationId: string;
    whyTypical: string;
    productImplication: string;
  }[];
};

export async function generateRepresentativePicks(input: {
  candidates: Conversation[]; // 已经按规则筛过的候选池
}): Promise<RepresentativeInsight> {
  const list = input.candidates
    .slice(0, 20)
    .map((c) => {
      const csat = c.satisfactionScore ?? 3;
      return `${c.externalId} | ${c.category} | ${c.resolutionStatus} | ${c.failureType || "—"} | CSAT ${csat.toFixed(1)} | 诉求:${c.primaryIntent} | 原声:「${(c.merchantKeyQuote || "").slice(0, 90)}」`;
    })
    .join("\n");

  const user = `
候选工单池（已按"未解决+CSAT 低+轮次多"粗筛）：
${list}

请从中精选 3-5 通最值得产品负责人看的工单，输出 JSON：
- conversationId: 工单 ID
- whyTypical: 30-80 字，说清"为什么这通比其他更值得看"——是揭示了独特问题，还是放大了普遍现象，还是商家原声特别有冲击力
- productImplication: 50-100 字，对产品负责人的具体启示——这通工单暴露的问题应该让团队做什么决策

避免重复选择同一场景/同一归因，尽量覆盖不同问题类型。

${STYLE_RULES}
`.trim();

  return chatJson<RepresentativeInsight>({
    task: "quality",
    user,
    jsonSchema: { name: "representative_picks", schema: REPRESENTATIVE_SCHEMA },
    temperature: 0.35,
    maxTokens: 1500,
  });
}
