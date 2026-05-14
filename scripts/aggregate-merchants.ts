/**
 * 一次性商家画像聚合脚本
 *
 * 用法:
 *   tsx scripts/aggregate-merchants.ts [--llm=0]   # llm=0 跳过 LLM 总结(快速调试)
 *   tsx scripts/aggregate-merchants.ts --merchant=M12345  # 只重算一个商家
 *
 * 输入: data.db 的 conversations 表
 * 输出: merchants + merchant_events 两表
 */

import { storage } from "../server/storage";
import type { Conversation, InsertMerchant, InsertMerchantEvent } from "../shared/schema";
import { generateMerchantNarrative, type MerchantTicketSummary } from "../server/llm/merchant-llm";

// CLI 默认: 走命令行参数;被 程序 import 时改用 runAggregate({ useLLM, single }) 传参
const CLI_USE_LLM = !process.argv.includes("--llm=0");
const CLI_SINGLE = process.argv.find((a) => a.startsWith("--merchant="))?.split("=")[1];

function parseTrajectory(json: string): { turn: number; score: number }[] {
  try {
    const p = JSON.parse(json);
    if (Array.isArray(p) && p.length && typeof p[0] === "object") return p;
  } catch {
    /* fallthrough */
  }
  return [];
}

// 情绪文字 → 0~1 数值(与 analyzer 的锚点一致)
function emotionToScore(label: string): number {
  switch (label) {
    case "满意":
      return 0.85;
    case "中性":
      return 0.5;
    case "焦虑":
      return 0.3;
    case "失望":
      return 0.2;
    case "愤怒":
      return 0.05;
    default:
      return 0.5;
  }
}

function eventTypeFor(c: Conversation): InsertMerchantEvent["eventType"] {
  if (c.resolutionStatus === "escalated") return "escalation";
  if (c.resolutionStatus === "resolved") return "resolution";
  if (c.emotionEnd === "愤怒" || c.emotionEnd === "失望") return "churn_signal";
  return "complaint";
}

// 区域代码 → 中文名
const REGION_CN: Record<string, string> = {
  CN: "中国大陆",
  US: "北美",
  EU: "欧洲",
  SEA: "东南亚",
  LATAM: "拉丁美洲",
  MEA: "中东/非洲",
};

// 失败类型 → 中文描述
const FAILURE_TYPE_CN: Record<string, string> = {
  knowledge_gap: "知识库缺失",
  policy_limit: "政策限制使发场受阻",
  routing_error: "路由到人工响应超时",
  merchant_misunderstanding: "商家对规则理解偏差",
  system_bug: "系统故障",
  llm_hallucination: "机器人给出错误回复",
  agent_error: "人工处理不到位",
  buyer_dispute: "买家事端争议未结",
};

// 启发式生成风险叙事 + 推荐动作（不调 LLM）
function generateHeuristicNarrative(args: {
  region: string;
  ticketCount: number;
  unresolved: number;
  escalated: number;
  avgEmotionEnd: number;
  avgCsat: number;
  churnRisk: number;
  topCategories: { category: string; count: number }[];
  topFailureTypes: { type: string; count: number }[];
}): { narrative: string; action: string } {
  const regionCn = REGION_CN[args.region] || args.region;
  const tier =
    args.churnRisk >= 0.75
      ? "极高风险"
      : args.churnRisk >= 0.5
      ? "高风险"
      : args.churnRisk >= 0.25
      ? "中等风险"
      : "低风险";

  const topCatText = args.topCategories
    .slice(0, 3)
    .map((c) => `${c.category}（${c.count} 起）`)
    .join("、");

  const topFailText = args.topFailureTypes
    .slice(0, 2)
    .map((f) => FAILURE_TYPE_CN[f.type] || f.type)
    .join("、");

  const emotionDesc =
    args.avgEmotionEnd >= 0.7
      ? "整体情绪偏正面"
      : args.avgEmotionEnd >= 0.45
      ? "情绪偏中性但有下滑迹象"
      : args.avgEmotionEnd >= 0.25
      ? "情绪偏负面"
      : "情绪严重负面、接近临界点";

  const unresolvedRatio = args.ticketCount > 0 ? args.unresolved / args.ticketCount : 0;
  const escalatedNote =
    args.escalated > 0 ? `，其中 ${args.escalated} 条已升级人工` : "";

  const narrative =
    `${regionCn}商家近期共计 ${args.ticketCount} 起工单，未解决 ${args.unresolved} 条${escalatedNote}。` +
    `高频痛点集中在${topCatText}。` +
    (topFailText ? `主要失败原因为${topFailText}。` : "") +
    `商家${emotionDesc}，平均 CSAT ${args.avgCsat.toFixed(1)}分。综合评估当前处于「${tier}」水位（流失分 ${args.churnRisk.toFixed(2)}）。`;

  let action: string;
  if (args.churnRisk >= 0.75) {
    action =
      `【P0 紧急】由所在区域商家成功经理于 24 小时内发起主动外呼，逐条复盘未解决工单；` +
      `针对${args.topCategories[0]?.category || "高频场景"}开启专属加速通道，并同步产品侧优化事项。`;
  } else if (args.churnRisk >= 0.5) {
    action =
      `【P1 高】 7 天内完成未解决工单复盘与闭环；` +
      `重点跟踪${args.topCategories[0]?.category || "主要品类"}上的反复问题，并评估是否需定点培训或知识库补齐。`;
  } else if (args.churnRisk >= 0.25) {
    action =
      `【P2 中】纳入双周跟进名单，保持${unresolvedRatio < 0.3 ? "当前解决节奏" : "提升首应速度"}；` +
      `在下次商家调研中采集${args.topCategories[0]?.category || "该品类"}占用问题的根本诉求。`;
  } else {
    action =
      `【P3 低】保持常规监控即可。当前问题解决能力充足，商家依赖度稳定，可作为样板案例在区域内复用运营经验。`;
  }

  return { narrative, action };
}

function riskTier(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 0.75) return "critical";
  if (score >= 0.5) return "high";
  if (score >= 0.25) return "medium";
  return "low";
}

export async function runAggregate(opts: { useLLM?: boolean; single?: string } = {}) {
  const USE_LLM = opts.useLLM ?? true;
  const SINGLE = opts.single;
  console.log(`[aggregate] LLM=${USE_LLM} single=${SINGLE || "all"}`);

  const all = await storage.listConversations();
  console.log(`[aggregate] loaded ${all.length} conversations`);

  // 按 merchantId 分组
  const groups = new Map<string, Conversation[]>();
  for (const c of all) {
    if (SINGLE && c.merchantId !== SINGLE) continue;
    if (!groups.has(c.merchantId)) groups.set(c.merchantId, []);
    groups.get(c.merchantId)!.push(c);
  }
  console.log(`[aggregate] ${groups.size} merchants to process`);

  let idx = 0;
  for (const [merchantId, convs] of groups) {
    idx++;
    const ticketCount = convs.length;
    const unresolved = convs.filter((c) => c.resolutionStatus !== "resolved").length;
    const escalated = convs.filter((c) => c.resolutionStatus === "escalated").length;
    const badCaseRate = unresolved / ticketCount;
    const avgCsat =
      convs.reduce((s, c) => s + (c.satisfactionScore ?? 3), 0) / ticketCount;
    const avgEmotionEnd =
      convs.reduce((s, c) => s + emotionToScore(c.emotionEnd), 0) / ticketCount;

    // top categories
    const catMap = new Map<string, number>();
    convs.forEach((c) => catMap.set(c.category, (catMap.get(c.category) || 0) + 1));
    const topCategories = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    // top failure types
    const ftMap = new Map<string, number>();
    convs.forEach((c) => {
      if (c.failureType) ftMap.set(c.failureType, (ftMap.get(c.failureType) || 0) + 1);
    });
    const topFailureTypes = Array.from(ftMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }));

    // Churn risk: 三因素加权
    // - badCaseRate(权重 0.4)
    // - 1 - avgEmotionEnd(权重 0.4)
    // - escalated/ticketCount(权重 0.2)
    const churnRisk = Math.min(
      1,
      Math.max(
        0,
        +(
          0.4 * badCaseRate +
          0.4 * (1 - avgEmotionEnd) +
          0.2 * (escalated / ticketCount)
        ).toFixed(3)
      )
    );

    const sorted = [...convs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const firstSeen = sorted[0].startedAt;
    const lastSeen = sorted[sorted.length - 1].startedAt;

    // 先用启发式生成 keyQuotes(LLM 失败时兜底)
    const heuristicQuotes = convs
      .filter((c) => c.merchantKeyQuote && c.merchantKeyQuote.length > 6)
      .sort((a, b) => emotionToScore(a.emotionEnd) - emotionToScore(b.emotionEnd))
      .slice(0, 3)
      .map((c) => ({
        quote: c.merchantKeyQuote || "",
        ticketId: c.externalId,
        emotion: c.emotionEnd,
      }));

    // 默认先用启发式生成一份 narrative + action，保证任何情况下都有内容
    const heuristic = generateHeuristicNarrative({
      region: convs[0].merchantRegion,
      ticketCount,
      unresolved,
      escalated,
      avgEmotionEnd,
      avgCsat,
      churnRisk,
      topCategories,
      topFailureTypes,
    });
    let riskNarrative: string | null = heuristic.narrative;
    let recommendedAction: string | null = heuristic.action;
    let keyQuotes = heuristicQuotes;

    if (USE_LLM) {
      try {
        const summary: MerchantTicketSummary[] = convs.slice(0, 10).map((c) => ({
          ticketId: c.externalId,
          category: c.category,
          emotionEnd: c.emotionEnd,
          emotionScore: emotionToScore(c.emotionEnd),
          resolutionStatus: c.resolutionStatus,
          failureType: c.failureType,
          csat: c.satisfactionScore,
          quote: c.merchantKeyQuote,
          occurredAt: c.startedAt,
        }));

        const narr = await generateMerchantNarrative({
          merchantId,
          region: convs[0].merchantRegion,
          ticketCount,
          badCaseRate,
          avgEmotionEnd,
          topCategories,
          topFailureTypes,
          tickets: summary,
        });

        riskNarrative = narr.riskNarrative;
        recommendedAction = narr.recommendedAction;
        if (narr.keyQuotes && narr.keyQuotes.length > 0) keyQuotes = narr.keyQuotes;
      } catch (err) {
        console.warn(`[aggregate] LLM failed for ${merchantId}: ${(err as Error).message}`);
      }
    }

    const now = new Date().toISOString();
    const insert: InsertMerchant = {
      merchantId,
      merchantRegion: convs[0].merchantRegion,
      ticketCount,
      unresolvedCount: unresolved,
      escalatedCount: escalated,
      avgSatisfaction: +avgCsat.toFixed(2),
      avgEmotionEnd: +avgEmotionEnd.toFixed(3),
      badCaseRate: +badCaseRate.toFixed(3),
      churnRiskScore: churnRisk,
      riskTier: riskTier(churnRisk),
      topCategories: JSON.stringify(topCategories),
      topFailureTypes: JSON.stringify(topFailureTypes),
      keyQuotes: JSON.stringify(keyQuotes),
      riskNarrative,
      recommendedAction,
      firstSeen,
      lastSeen,
      updatedAt: now,
    };

    await storage.upsertMerchant(insert);

    // 事件流
    const events: InsertMerchantEvent[] = sorted.map((c) => ({
      merchantId,
      ticketExternalId: c.externalId,
      conversationId: c.id,
      eventType: eventTypeFor(c),
      category: c.category,
      emotionEnd: c.emotionEnd,
      emotionScore: emotionToScore(c.emotionEnd),
      resolutionStatus: c.resolutionStatus,
      occurredAt: c.startedAt,
    }));
    await storage.replaceMerchantEvents(merchantId, events);

    console.log(
      `[aggregate] ${idx}/${groups.size} ${merchantId} risk=${churnRisk.toFixed(2)} tier=${riskTier(churnRisk)} ${USE_LLM && riskNarrative ? "LLM✓" : "heuristic"}`
    );
  }

  console.log("[aggregate] done");
}

// 只有被命令行直接调用时才走 main + exit;被 import 时仅导出 runAggregate
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /aggregate-merchants/.test(process.argv[1]);

if (isDirectRun) {
  runAggregate({ useLLM: CLI_USE_LLM, single: CLI_SINGLE })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
