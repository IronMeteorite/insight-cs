import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { storage } from "./storage";
import { insertConversationSchema } from "@shared/schema";
import { generateReport } from "./report";
import type { Conversation } from "@shared/schema";
import { analyzeTicket, type TranscriptMsg } from "./llm/analyzer";
import { getProviderInfo } from "./llm/client";
import {
  generateTopProblem,
  generateFailurePattern,
  generateRootCause,
  generateRecommendations,
  generateRepresentativePicks,
} from "./llm/report-llm";
import { analyzeCopilotTurn, type CopilotTurn } from "./llm/copilot-llm";

// ============ 工具:把字符串 transcript 转结构化 ============
function parseTranscript(input: unknown): TranscriptMsg[] {
  if (Array.isArray(input)) return input as TranscriptMsg[];
  if (typeof input !== "string") return [];
  // 如果已经是 JSON 字符串
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return parsed as TranscriptMsg[];
  } catch {
    /* not JSON, fall through */
  }
  // 按行解析
  return input
    .split("\n")
    .filter(Boolean)
    .map((line, i): TranscriptMsg => {
      const mZh = line.match(/^(商家|用户|机器人|人工)[：:]\s*(.*)$/);
      const mEn = line.match(/^(merchant|seller|bot|agent|human)\s*[:：]\s*(.*)$/i);
      if (mZh) {
        const role =
          mZh[1] === "机器人"
            ? ("bot" as const)
            : mZh[1] === "人工"
            ? ("human" as const)
            : ("merchant" as const);
        return { role, content: mZh[2], ts: `00:${(i * 12).toString().padStart(2, "0")}` };
      }
      if (mEn) {
        const tag = mEn[1].toLowerCase();
        const role =
          tag === "bot"
            ? ("bot" as const)
            : tag === "agent" || tag === "human"
            ? ("human" as const)
            : ("merchant" as const);
        return { role, content: mEn[2], ts: `00:${(i * 12).toString().padStart(2, "0")}` };
      }
      return { role: "merchant" as const, content: line, ts: `00:${(i * 12).toString().padStart(2, "0")}` };
    });
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // 系统状态(展示当前 LLM Provider)
  app.get("/api/system/llm", (_req, res) => {
    res.json(getProviderInfo());
  });

  // 列表
  app.get("/api/conversations", async (_req, res) => {
    const list = await storage.listConversations();
    res.json(list);
  });

  // 详情
  app.get("/api/conversations/:id", async (req, res) => {
    const id = Number(req.params.id);
    const conv = await storage.getConversation(id);
    if (!conv) return res.status(404).json({ error: "not found" });
    res.json(conv);
  });

  // 录入(优先调用 LLM,失败降级到启发式)
  app.post("/api/conversations", async (req, res) => {
    try {
      const body = req.body;
      const transcript = parseTranscript(body.rawTranscript);
      const channel = body.channel || "seller_center";

      let enriched: Record<string, unknown>;
      try {
        // 调用真实 LLM
        const a = await analyzeTicket(transcript, channel);
        const turns = transcript.filter((m) => m.role === "merchant").length || 2;
        // 防御性 clamp：LLM 偶尔不听话输出负数或 >1，手动归一到 0~1
        const trajectoryPoints = a.emotionTrajectory.map((score, i) => ({
          turn: i + 1,
          score: Math.max(0, Math.min(1, +score.toFixed(2))),
        }));
        const translatedTranscript = a.translatedMessages
          ? JSON.stringify(
              transcript.map((m, i) => ({
                ...m,
                content: a.translatedMessages![i] || m.content,
              }))
            )
          : null;
        enriched = {
          externalId: body.externalId || `TKT-LLM-${Date.now().toString().slice(-6)}`,
          merchantId: body.merchantId || `M${Math.floor(Math.random() * 90000) + 10000}`,
          merchantRegion: body.merchantRegion || (a.language === "en" ? "US" : "CN"),
          channel,
          language: a.language,
          category: a.category,
          startedAt: body.startedAt || new Date().toISOString(),
          durationSec: body.durationSec || transcript.length * 30,
          turns: transcript.length,
          rawTranscript: JSON.stringify(transcript),
          translatedTranscript,
          primaryIntent: a.primaryIntent,
          intentConfidence: a.intentConfidence,
          emotionStart: a.emotionStart,
          emotionEnd: a.emotionEnd,
          emotionTrajectory: JSON.stringify(trajectoryPoints),
          resolutionStatus: a.resolutionStatus,
          failureType: a.failureType,
          failureReason: a.failureReason || null,
          satisfactionScore: a.satisfactionScore,
          merchantKeyQuote: a.merchantKeyQuote,
          tags: JSON.stringify([a.category, a.primaryIntent, a.language, "llm-analyzed"]),
        };
      } catch (err) {
        console.warn("[ingest] LLM 归因失败,降级到启发式:", (err as Error).message);
        enriched = fallbackHeuristic(transcript, body, channel);
      }

      const parsed = insertConversationSchema.parse(enriched);
      const created = await storage.createConversation(parsed);
      res.json(created);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ============ ✨ 试试看:SSE 流式分步归因 ============
  app.post("/api/conversations/try-it", async (req, res) => {
    const transcript = parseTranscript(req.body.rawTranscript);
    const channel = req.body.channel || "seller_center";

    // 设置 SSE 头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send("step", { step: "detect", message: "检测对话语言..." });
      const hasEnglish = transcript.some((m) => /[A-Za-z]{6,}/.test(m.content));
      const hasChinese = transcript.some((m) => /[\u4e00-\u9fa5]/.test(m.content));
      const lang = hasEnglish && !hasChinese ? "en" : "zh";
      await new Promise((r) => setTimeout(r, 400));
      send("detected", { language: lang });

      send("step", { step: "analyzing", message: "LLM 正在分析对话内容..." });
      const a = await analyzeTicket(transcript, channel);

      // 依次推送各字段,前端逐项 fade-in
      send("field", { key: "language", value: a.language, label: "语言" });
      await new Promise((r) => setTimeout(r, 200));
      send("field", { key: "category", value: a.category, label: "业务场景" });
      await new Promise((r) => setTimeout(r, 200));
      send("field", {
        key: "primaryIntent",
        value: a.primaryIntent,
        confidence: a.intentConfidence,
        label: "商家诉求",
      });
      await new Promise((r) => setTimeout(r, 200));
      send("field", {
        key: "emotion",
        value: `${a.emotionStart} → ${a.emotionEnd}`,
        trajectory: a.emotionTrajectory,
        label: "情绪轨迹",
      });
      await new Promise((r) => setTimeout(r, 200));
      send("field", {
        key: "resolution",
        value: a.resolutionStatus,
        label: "解决状态",
      });
      await new Promise((r) => setTimeout(r, 200));
      send("field", {
        key: "failure",
        value: a.failureType,
        reason: a.failureReason,
        label: "失效归因",
      });
      await new Promise((r) => setTimeout(r, 200));
      send("field", { key: "csat", value: a.satisfactionScore, label: "CSAT 推断" });
      await new Promise((r) => setTimeout(r, 200));
      send("field", {
        key: "keyQuote",
        value: a.merchantKeyQuote,
        label: "商家原声金句",
      });

      if (a.language === "en" && a.translatedMessages) {
        send("step", { step: "translating", message: "正在翻译为中文..." });
        for (let i = 0; i < transcript.length; i++) {
          send("translate", {
            index: i,
            original: transcript[i].content,
            translated: a.translatedMessages[i],
          });
          await new Promise((r) => setTimeout(r, 80));
        }
      }

      send("done", { analysis: a });
    } catch (err) {
      send("error", { message: (err as Error).message });
    } finally {
      res.end();
    }
  });

  // 翻译 API(LLM 版本,沿用 analyzer 内置词典)
  app.post("/api/translate", async (req, res) => {
    const { text } = req.body as { text: string };
    if (!text) return res.status(400).json({ error: "text required" });
    res.json({ translated: simpleLexTranslate(text), sourceLang: "en", targetLang: "zh" });
  });

  // ============ 周报生成(LLM 增强) ============
  // 缓存:同时间窗 + 同数据 hash 命中直接返回
  const reportCache = new Map<string, { ts: number; payload: unknown }>();
  const CACHE_TTL = 5 * 60 * 1000;

  app.get("/api/report", async (req, res) => {
    const from = (req.query.from as string) || new Date(Date.now() - 7 * 86400_000).toISOString();
    const to = (req.query.to as string) || new Date().toISOString();
    const useLLM = req.query.llm !== "0"; // 默认开启,?llm=0 走规则版

    const all = await storage.listConversations();
    const inRange = all.filter((c) => c.startedAt >= from && c.startedAt <= to);
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const span = toMs - fromMs;
    const prevFrom = new Date(fromMs - span).toISOString();
    const prevTo = from;
    const prev = all.filter((c) => c.startedAt >= prevFrom && c.startedAt < prevTo);

    const aggregates = computeAggregates(inRange);

    // 缓存 key
    const dataHash = crypto
      .createHash("md5")
      .update(inRange.map((c) => c.id).join(",") + `|${useLLM}`)
      .digest("hex")
      .slice(0, 12);
    const cacheKey = `${from}|${to}|${dataHash}`;
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.json(cached.payload);
    }

    // LLM 洞察(若启用且有足够数据)
    let llmInsights: Record<string, unknown> | null = null;
    if (useLLM && inRange.length >= 5) {
      try {
        llmInsights = await buildLLMInsights(inRange, prev, aggregates);
      } catch (err) {
        console.warn("[report] LLM 洞察失败,回退到模板版:", (err as Error).message);
      }
    }

    const markdown = generateReport({
      from,
      to,
      conversations: inRange,
      previousConversations: prev,
      llmInsights: llmInsights as never,
    });

    const payload = {
      markdown,
      meta: {
        from,
        to,
        count: inRange.length,
        prevCount: prev.length,
        llmEnabled: Boolean(llmInsights),
      },
      aggregates,
    };
    reportCache.set(cacheKey, { ts: Date.now(), payload });
    res.json(payload);
  });

  // 流式周报生成进度(SSE)
  app.get("/api/report/stream", async (req, res) => {
    const from = (req.query.from as string) || new Date(Date.now() - 7 * 86400_000).toISOString();
    const to = (req.query.to as string) || new Date().toISOString();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const all = await storage.listConversations();
      const inRange = all.filter((c) => c.startedAt >= from && c.startedAt <= to);
      const fromMs = new Date(from).getTime();
      const span = new Date(to).getTime() - fromMs;
      const prev = all.filter((c) => {
        const t = new Date(c.startedAt).getTime();
        return t >= fromMs - span && t < fromMs;
      });
      send("progress", { stage: "聚合统计层", pct: 10 });
      const aggregates = computeAggregates(inRange);

      send("progress", { stage: "LLM 生成 Top 系统性问题", pct: 25 });
      send("progress", { stage: "LLM 生成失败模式归类", pct: 45 });
      send("progress", { stage: "LLM 生成根因分析", pct: 65 });
      send("progress", { stage: "LLM 生成可执行建议", pct: 80 });
      send("progress", { stage: "LLM 精选代表性对话", pct: 90 });

      const llmInsights = await buildLLMInsights(inRange, prev, aggregates);
      const markdown = generateReport({
        from,
        to,
        conversations: inRange,
        previousConversations: prev,
        llmInsights: llmInsights as never,
      });

      send("done", {
        markdown,
        meta: { from, to, count: inRange.length, prevCount: prev.length, llmEnabled: true },
        aggregates,
      });
    } catch (err) {
      send("error", { message: (err as Error).message });
    } finally {
      res.end();
    }
  });

  // 建议列表
  app.get("/api/recommendations", async (_req, res) => {
    res.json(await storage.listRecommendations());
  });

  // 创建建议(从周报营销转落库;也用于手动补充)
  app.post("/api/recommendations", async (req, res) => {
    try {
      const body = req.body;
      const created = await storage.createRecommendation({
        type: body.type || "knowledge_base",
        title: body.title,
        description: body.description,
        affectedCount: body.affectedCount || 0,
        failurePattern: body.failurePattern || "",
        priority: body.priority || "medium",
        status: body.status || "pending",
        evidenceConversationIds: JSON.stringify(body.evidenceConversationIds || []),
        createdAt: new Date().toISOString(),
        targetMetric: body.targetMetric || "bad_case_rate",
        targetCategory: body.targetCategory || null,
        targetFailureType: body.targetFailureType || null,
        baselineValue: body.baselineValue ?? null,
        baselineWindowDays: body.baselineWindowDays || 7,
        implementedAt: null,
        owner: body.owner || null,
      });
      res.json(created);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // 状态切换 — 进入 in_progress 时自动记录 baseline
  app.patch("/api/recommendations/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { status, owner } = req.body;
    const rec = await storage.getRecommendation(id);
    if (!rec) return res.status(404).json({ error: "not found" });

    const patch: Record<string, unknown> = { status };
    if (owner !== undefined) patch.owner = owner;

    // 进入 in_progress 且之前未记录 baseline,现场计算基线
    if (status === "in_progress" && !rec.implementedAt) {
      const now = new Date();
      const windowDays = rec.baselineWindowDays || 7;
      const fromIso = new Date(now.getTime() - windowDays * 86400_000).toISOString();
      const all = await storage.listConversations();
      const baselineConvs = all.filter(
        (c) =>
          c.startedAt >= fromIso &&
          c.startedAt < now.toISOString() &&
          (!rec.targetCategory || c.category === rec.targetCategory) &&
          (!rec.targetFailureType || c.failureType === rec.targetFailureType)
      );
      const baseline = computeMetric(baselineConvs, rec.targetMetric || "bad_case_rate");
      patch.implementedAt = now.toISOString();
      patch.baselineValue = baseline;
    }

    const updated = await storage.updateRecommendation(id, patch);
    res.json(updated);
  });

  // 推荐效果计算 — 实施后对比 baseline
  app.get("/api/recommendations/:id/effect", async (req, res) => {
    const id = Number(req.params.id);
    const rec = await storage.getRecommendation(id);
    if (!rec) return res.status(404).json({ error: "not found" });
    if (!rec.implementedAt || rec.baselineValue == null) {
      return res.json({
        ready: false,
        message: "推荐尚未进入实施阶段,无法计算效果。",
      });
    }

    const windowDays = rec.baselineWindowDays || 7;
    const implementedAt = new Date(rec.implementedAt);
    const now = new Date();
    const elapsedDays = (now.getTime() - implementedAt.getTime()) / 86400_000;
    const compareUntil =
      elapsedDays >= windowDays
        ? new Date(implementedAt.getTime() + windowDays * 86400_000).toISOString()
        : now.toISOString();

    const all = await storage.listConversations();
    const postConvs = all.filter(
      (c) =>
        c.startedAt >= rec.implementedAt! &&
        c.startedAt < compareUntil &&
        (!rec.targetCategory || c.category === rec.targetCategory) &&
        (!rec.targetFailureType || c.failureType === rec.targetFailureType)
    );
    const currentValue = computeMetric(postConvs, rec.targetMetric || "bad_case_rate");
    const baseline = rec.baselineValue;
    const delta = +(currentValue - baseline).toFixed(3);
    const deltaPct = baseline === 0 ? null : +((delta / baseline) * 100).toFixed(1);

    // 对于 bad_case_rate / escalation_rate 下降是好事;avg_csat 上升是好事
    const isImprovement =
      rec.targetMetric === "avg_csat" ? delta > 0 : delta < 0;

    res.json({
      ready: true,
      metric: rec.targetMetric || "bad_case_rate",
      baseline,
      currentValue,
      delta,
      deltaPct,
      isImprovement,
      sampleCountBaseline: 0, // 可选:后续补充
      sampleCountPost: postConvs.length,
      windowDays,
      implementedAt: rec.implementedAt,
      compareUntil,
      elapsedDays: +elapsedDays.toFixed(1),
    });
  });

  // ============ ✨ 实时 Copilot SSE ============
  app.post("/api/copilot/turn", async (req, res) => {
    const turns = (req.body.turns || []) as CopilotTurn[];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      if (turns.length === 0) {
        send("error", { message: "对话为空" });
        return res.end();
      }
      send("step", { stage: "正在分析商家意图与情绪..." });
      const analysis = await analyzeCopilotTurn(turns);
      send("analysis", analysis);
      send("done", { ok: true });
    } catch (err) {
      send("error", { message: (err as Error).message });
    } finally {
      res.end();
    }
  });

  // ============ 商家画像 API ============
  app.get("/api/merchants", async (_req, res) => {
    const list = await storage.listMerchants();
    res.json(list);
  });

  app.get("/api/merchants/:id", async (req, res) => {
    const merchant = await storage.getMerchant(req.params.id);
    if (!merchant) return res.status(404).json({ error: "not found" });
    const events = await storage.listMerchantEvents(req.params.id);
    const all = await storage.listConversations();
    const tickets = all.filter((c) => c.merchantId === req.params.id);
    res.json({ merchant, events, tickets });
  });

  return httpServer;
}

// 计算指标
function computeMetric(convs: Conversation[], metric: string): number {
  if (convs.length === 0) return 0;
  if (metric === "escalation_rate") {
    return +(convs.filter((c) => c.resolutionStatus === "escalated").length / convs.length).toFixed(3);
  }
  if (metric === "avg_csat") {
    return +(convs.reduce((s, c) => s + (c.satisfactionScore ?? 3), 0) / convs.length).toFixed(2);
  }
  // default: bad_case_rate
  return +(convs.filter((c) => c.resolutionStatus !== "resolved").length / convs.length).toFixed(3);
}

// ============================
// 聚合数据
// ============================
function computeAggregates(convs: Conversation[]) {
  const total = convs.length;
  const categoryStats: Record<string, { total: number; bad: number; escalated: number }> = {};
  for (const c of convs) {
    if (!categoryStats[c.category]) categoryStats[c.category] = { total: 0, bad: 0, escalated: 0 };
    categoryStats[c.category].total += 1;
    if (c.resolutionStatus !== "resolved") categoryStats[c.category].bad += 1;
    if (c.resolutionStatus === "escalated") categoryStats[c.category].escalated += 1;
  }
  const categoryBadCase = Object.entries(categoryStats)
    .map(([category, s]) => ({
      category,
      total: s.total,
      bad: s.bad,
      escalated: s.escalated,
      badRate: total ? +((s.bad / s.total) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.badRate - a.badRate);

  const failureCounts: Record<string, number> = {};
  for (const c of convs) {
    if (c.failureType) failureCounts[c.failureType] = (failureCounts[c.failureType] || 0) + 1;
  }
  const rootCauseShare = Object.entries(failureCounts).map(([type, count]) => ({
    type,
    count,
    share: total ? +((count / total) * 100).toFixed(1) : 0,
  }));

  const langCounts: Record<string, number> = {};
  for (const c of convs) langCounts[c.language] = (langCounts[c.language] || 0) + 1;
  const languageMix = Object.entries(langCounts).map(([lang, count]) => ({
    lang,
    count,
    share: total ? +((count / total) * 100).toFixed(1) : 0,
  }));

  return { categoryBadCase, rootCauseShare, languageMix };
}

// ============================
// LLM 洞察组装(并发分段调用)
// ============================
async function buildLLMInsights(
  inRange: Conversation[],
  prev: Conversation[],
  aggregates: ReturnType<typeof computeAggregates>
) {
  const total = inRange.length;

  // 1. Top 系统性问题:取 bad rate 最高且工单数 ≥3 的前 3 个 category+failureType 组合
  type BucketKey = { category: string; failureType: string };
  const bucketMap = new Map<string, { key: BucketKey; convs: Conversation[] }>();
  for (const c of inRange) {
    if (c.resolutionStatus === "resolved" || !c.failureType) continue;
    const k = `${c.category}::${c.failureType}`;
    if (!bucketMap.has(k))
      bucketMap.set(k, { key: { category: c.category, failureType: c.failureType }, convs: [] });
    bucketMap.get(k)!.convs.push(c);
  }
  const topBuckets = Array.from(bucketMap.values())
    .filter((b) => b.convs.length >= 2)
    .sort((a, b) => b.convs.length - a.convs.length)
    .slice(0, 3);

  // 2. 失败模式按 failureType 维度分桶
  const failureTypeMap = new Map<string, Conversation[]>();
  for (const c of inRange) {
    if (!c.failureType) continue;
    if (!failureTypeMap.has(c.failureType)) failureTypeMap.set(c.failureType, []);
    failureTypeMap.get(c.failureType)!.push(c);
  }
  const failurePatterns = Array.from(failureTypeMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  // 3. 代表性候选池(粗筛)
  const candidates = inRange
    .filter((c) => c.resolutionStatus !== "resolved")
    .sort((a, b) => {
      const sa = (a.satisfactionScore ?? 3) - a.turns * 0.05;
      const sb = (b.satisfactionScore ?? 3) - b.turns * 0.05;
      return sa - sb;
    })
    .slice(0, 18);

  const sampleForRootCause = inRange
    .filter((c) => c.resolutionStatus !== "resolved")
    .slice(0, 8);

  // 并发执行各段 LLM 调用,各自失败不影响其他
  const settle = <T>(p: Promise<T>) => p.catch((e) => ({ __err: (e as Error).message }));

  const topProblemPromises = topBuckets.map((b) => {
    const sizes: Conversation[] = b.convs;
    const avgCsat =
      sizes.reduce((s: number, c: Conversation) => s + (c.satisfactionScore ?? 3), 0) /
      Math.max(1, sizes.length);
    const prevBucketSize = prev.filter(
      (c) => c.category === b.key.category && c.failureType === b.key.failureType
    ).length;
    return settle(
      generateTopProblem({
        category: b.key.category,
        failureReason: b.key.failureType,
        bucketConvs: sizes,
        totalCount: total,
        bucketSize: sizes.length,
        avgCsat,
        prevBucketSize,
      })
    );
  });

  const failurePatternPromises = failurePatterns.map(([reason, convs]: [string, Conversation[]]) => {
    // 找该归因下 top category
    const catCount = new Map<string, number>();
    convs.forEach((c: Conversation) => catCount.set(c.category, (catCount.get(c.category) || 0) + 1));
    const topCat = Array.from(catCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    return settle(
      generateFailurePattern({
        failureReason: reason,
        topCategory: topCat,
        bucketConvs: convs,
        bucketSize: convs.length,
        totalCount: total,
      })
    );
  });

  const rootCausePromise = settle(
    generateRootCause({
      totalCount: total,
      unresolvedCount: inRange.filter((c) => c.resolutionStatus !== "resolved").length,
      failureShares: aggregates.rootCauseShare.map((r) => ({ reason: r.type, count: r.count })),
      topProblems: topBuckets.map((b) => ({
        category: b.key.category,
        reason: b.key.failureType,
        size: b.convs.length,
      })),
      sampleConvs: sampleForRootCause,
    })
  );

  const representativePromise = settle(generateRepresentativePicks({ candidates }));

  const [topProblemResults, failurePatternResults, rootCauseResult, representativeResult] =
    await Promise.all([
      Promise.all(topProblemPromises),
      Promise.all(failurePatternPromises),
      rootCausePromise,
      representativePromise,
    ]);

  // 建议依赖根因
  const validRoot =
    rootCauseResult && !("__err" in rootCauseResult) ? rootCauseResult.rootCauses : [];
  const recommendationResult = await settle(
    generateRecommendations({
      topProblems: topBuckets.map((b) => ({
        category: b.key.category,
        reason: b.key.failureType,
        size: b.convs.length,
        ratio: (b.convs.length / total) * 100,
      })),
      rootCauses: validRoot,
      totalCount: total,
    })
  );

  return {
    topProblems: topProblemResults.map((r, i) => ({
      bucket: topBuckets[i].key,
      bucketSize: topBuckets[i].convs.length,
      ratio: (topBuckets[i].convs.length / total) * 100,
      sampleConv: topBuckets[i].convs[0],
      insight: r,
    })),
    failurePatterns: failurePatternResults.map((r, i) => ({
      failureType: failurePatterns[i][0],
      bucketSize: failurePatterns[i][1].length,
      ratio: (failurePatterns[i][1].length / total) * 100,
      sampleConv: failurePatterns[i][1][0],
      insight: r,
    })),
    rootCause: rootCauseResult,
    recommendations: recommendationResult,
    representative: representativeResult,
    candidates: candidates.slice(0, 6).map((c) => c.externalId),
  };
}

// ============================
// 启发式降级(LLM 失败时兜底)
// ============================
function fallbackHeuristic(
  transcript: TranscriptMsg[],
  body: Record<string, unknown>,
  channel: string
): Record<string, unknown> {
  const text = transcript.map((m) => m.content).join("\n");
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  const language = (body.language as string) || (hasChinese ? "zh" : "en");
  const inferIntent = (body.primaryIntent as string) || guessIntent(text);
  const inferCategory = (body.category as string) || guessCategory(text);
  const emotionEnd = /(angry|terrible|refund|escalate|愤|垃圾|投诉)/i.test(text)
    ? "愤怒"
    : /(disappointed|失望|算了|无语)/i.test(text)
    ? "失望"
    : /(thanks|good|满意|谢谢|好的)/i.test(text)
    ? "满意"
    : "中性";
  const resolutionStatus =
    emotionEnd === "满意" ? "resolved" : emotionEnd === "愤怒" ? "escalated" : "unresolved";
  const failureType =
    resolutionStatus === "resolved"
      ? null
      : /(knowledge|FAQ|不知道|没找到)/i.test(text)
      ? "knowledge_gap"
      : /(human|escalate|transfer|转人工|换人)/i.test(text)
      ? "routing_error"
      : "systemic_unsolvable";
  const turns = transcript.length;
  return {
    externalId: `TKT-RULE-${Date.now().toString().slice(-6)}`,
    merchantId: `M${Math.floor(Math.random() * 90000) + 10000}`,
    merchantRegion: language === "en" ? "US" : "CN",
    channel,
    language,
    category: inferCategory,
    startedAt: new Date().toISOString(),
    durationSec: turns * 30,
    turns,
    rawTranscript: JSON.stringify(transcript),
    translatedTranscript: language === "en" ? simpleLexTranslate(text) : null,
    primaryIntent: inferIntent,
    intentConfidence: 0.6,
    emotionStart: "中性",
    emotionEnd,
    emotionTrajectory: JSON.stringify([
      { turn: 1, score: 0.5 },
      { turn: turns, score: emotionEnd === "满意" ? 0.85 : emotionEnd === "愤怒" ? 0.1 : 0.3 },
    ]),
    resolutionStatus,
    failureType,
    failureReason: failureType ? "规则启发式判定,未调用 LLM。" : null,
    satisfactionScore: resolutionStatus === "resolved" ? 4.2 : 2.1,
    merchantKeyQuote: transcript.find((m) => m.role === "merchant")?.content || "",
    tags: JSON.stringify([inferCategory, inferIntent, language, "fallback"]),
  };
}

function guessIntent(text: string): string {
  const t = text.toLowerCase();
  if (/(audit|review|资质|审核|入驻)/.test(t)) return "资质审核进度";
  if (/(takedown|下架|appeal|申诉)/.test(t)) return "商品下架申诉";
  if (/(customs|清关|first.?mile|头程)/.test(t)) return "头程清关延误";
  if (/(refund|恶意退款)/.test(t)) return "退款纠纷";
  if (/(ad|广告|余额|充值)/.test(t)) return "广告账户异常";
  if (/(settlement|payout|结算|提现)/.test(t)) return "结算延迟";
  if (/(penalty|扣分|违规)/.test(t)) return "违规扣分申诉";
  return "通用咨询";
}
function guessCategory(text: string): string {
  const t = text.toLowerCase();
  if (/(audit|onboard|资质|入驻|审核)/.test(t)) return "招商入驻";
  if (/(campaign|装修|活动)/.test(t)) return "店铺运营";
  if (/(takedown|compliance|下架|合规)/.test(t)) return "商品合规";
  if (/(order|履约|发货)/.test(t)) return "订单履约";
  if (/(logistics|customs|物流|清关)/.test(t)) return "物流时效";
  if (/(refund|dispute|纠纷)/.test(t)) return "售后纠纷";
  if (/(ad|advertising|广告)/.test(t)) return "广告投放";
  if (/(payout|settlement|提现|结算)/.test(t)) return "提现结算";
  if (/(appeal|penalty|扣分|申诉)/.test(t)) return "政策申诉";
  if (/(risk|frozen|风控|冻结)/.test(t)) return "账号风控";
  return "店铺运营";
}

function simpleLexTranslate(text: string): string {
  const lex: Array<[RegExp, string]> = [
    [/refund/gi, "退款"],
    [/takedown/gi, "商品下架"],
    [/appeal/gi, "申诉"],
    [/customs/gi, "清关"],
    [/settlement/gi, "结算"],
    [/payout/gi, "提现"],
    [/seller center/gi, "卖家中心"],
    [/ad account/gi, "广告账户"],
    [/buyer/gi, "买家"],
    [/merchant|seller/gi, "商家"],
    [/platform/gi, "平台"],
  ];
  let zh = text;
  for (const [re, w] of lex) zh = zh.replace(re, w);
  return zh;
}
