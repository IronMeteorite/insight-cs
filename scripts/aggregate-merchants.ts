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

    let riskNarrative: string | null = null;
    let recommendedAction: string | null = null;
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
