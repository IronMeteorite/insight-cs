import type { Conversation } from "@shared/schema";

const FAILURE_LABEL: Record<string, string> = {
  knowledge_gap: "知识缺失",
  routing_error: "路由错误",
  policy_limit: "政策限制",
  merchant_misunderstanding: "商家预期偏差",
  systemic_unsolvable: "系统不可解",
};

const FAILURE_ROOT_CAUSE: Record<string, string> = {
  knowledge_gap: "知识库未覆盖商家工单中的具体规则/条款,机器人多轮返回模板。",
  routing_error: "首轮意图识别错误,工单被分配至非对应业务组(常见于结算/海外工单)。",
  policy_limit: "现有政策无法覆盖商家合理诉求,系统僵化驳回(常见于举证类型不全、超时窗口)。",
  merchant_misunderstanding: "商家对平台规则归属/操作路径理解偏差,机器人未主动澄清。",
  systemic_unsolvable: "依赖外部系统(银行通道、3PL、海关)数据,平台侧无法实时给出确定答复。",
};

const REGION_LABEL: Record<string, string> = {
  CN: "中国",
  US: "北美",
  EU: "欧洲",
  SEA: "东南亚",
  LATAM: "拉美",
  MEA: "中东/非洲",
};

function safeParse<T = any>(s: string | null, def: T): T {
  if (!s) return def;
  try {
    return JSON.parse(s) as T;
  } catch {
    return def;
  }
}

type Turn = { role: string; content: string; ts: string };

// ============ LLM 洞察传入数据形态 ============

export type LLMInsightsPayload = {
  topProblems: Array<{
    bucket: { category: string; failureType: string };
    bucketSize: number;
    ratio: number;
    sampleConv: Conversation;
    insight:
      | { title: string; problemStatement: string; impactScope: string; impactResult: string }
      | { __err: string };
  }>;
  failurePatterns: Array<{
    failureType: string;
    bucketSize: number;
    ratio: number;
    sampleConv: Conversation;
    insight: { typicalBehavior: string; triggerScenario: string } | { __err: string };
  }>;
  rootCause:
    | { rootCauses: Array<{ layer: string; description: string; evidence: string }> }
    | { __err: string };
  recommendations:
    | {
        recommendations: Array<{
          priority: "P0" | "P1" | "P2";
          title: string;
          action: string;
          owner: string;
          expectedImpact: string;
        }>;
      }
    | { __err: string };
  representative:
    | { picks: Array<{ conversationId: string; whyTypical: string; productImplication: string }> }
    | { __err: string };
  candidates: string[];
};

function hasErr<T extends object>(
  v: T | { __err: string } | null | undefined
): v is { __err: string } {
  return !!v && typeof v === "object" && "__err" in v;
}

export interface ReportInput {
  from: string;
  to: string;
  conversations: Conversation[];
  previousConversations?: Conversation[];
  llmInsights?: LLMInsightsPayload | null;
}

export function generateReport(input: ReportInput): string {
  const { from, to, conversations: convs, previousConversations: prev = [], llmInsights } = input;
  const fmt = (iso: string) => iso.slice(0, 10);

  const total = convs.length;
  if (total === 0) {
    return `# 跨境电商商家工单分析周报\n\n**周期**:${fmt(from)} ~ ${fmt(to)}\n\n选定时间范围内没有对话数据。请扩大筛选范围。\n`;
  }

  // —— 基础指标 ——
  const resolved = convs.filter((c) => c.resolutionStatus === "resolved").length;
  const escalated = convs.filter((c) => c.resolutionStatus === "escalated").length;
  const abandoned = convs.filter((c) => c.resolutionStatus === "abandoned").length;
  const unresolved = total - resolved;
  const badCaseCount = total - resolved; // 非已解决 = bad case
  const resolutionRate = (resolved / total) * 100;
  const escalationRate = (escalated / total) * 100;
  const badCaseRate = (badCaseCount / total) * 100;
  const avgCsat = convs.reduce((s, c) => s + (c.satisfactionScore || 0), 0) / total;
  const enCount = convs.filter((c) => c.language === "en").length;
  const enShare = (enCount / total) * 100;

  // —— 环比 ——
  const prevTotal = prev.length;
  const prevResolved = prev.filter((c) => c.resolutionStatus === "resolved").length;
  const prevEscalated = prev.filter((c) => c.resolutionStatus === "escalated").length;
  const prevBad = prevTotal ? prevTotal - prevResolved : 0;
  const prevResolutionRate = prevTotal ? (prevResolved / prevTotal) * 100 : null;
  const prevEscalationRate = prevTotal ? (prevEscalated / prevTotal) * 100 : null;
  const prevBadCaseRate = prevTotal ? (prevBad / prevTotal) * 100 : null;
  const prevCsat = prevTotal
    ? prev.reduce((s, c) => s + (c.satisfactionScore || 0), 0) / prevTotal
    : null;

  const deltaStr = (cur: number, prevVal: number | null, unit = "%", digits = 1, lowerBetter = false) => {
    if (prevVal === null) return "(无可比基线)";
    const d = cur - prevVal;
    const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "→";
    return `${arrow} ${Math.abs(d).toFixed(digits)}${unit} vs 上周期 ${prevVal.toFixed(digits)}${unit}`;
  };

  // —— 按场景 bad case 率 ——
  const categoryStats: Record<string, { total: number; bad: number; escalated: number }> = {};
  for (const c of convs) {
    if (!categoryStats[c.category]) categoryStats[c.category] = { total: 0, bad: 0, escalated: 0 };
    categoryStats[c.category].total += 1;
    if (c.resolutionStatus !== "resolved") categoryStats[c.category].bad += 1;
    if (c.resolutionStatus === "escalated") categoryStats[c.category].escalated += 1;
  }
  const categoryRows = Object.entries(categoryStats)
    .map(([cat, s]) => ({
      category: cat,
      total: s.total,
      bad: s.bad,
      escalated: s.escalated,
      badRate: (s.bad / s.total) * 100,
      escRate: (s.escalated / s.total) * 100,
    }))
    .sort((a, b) => b.badRate - a.badRate);

  // —— 失败聚类(failureType × category) ——
  const clusters: Record<string, { failureType: string; category: string; ids: number[] }> = {};
  for (const c of convs) {
    if (!c.failureType) continue;
    const key = `${c.failureType}|${c.category}`;
    clusters[key] = clusters[key] || { failureType: c.failureType, category: c.category, ids: [] };
    clusters[key].ids.push(c.id);
  }
  const clusterList = Object.values(clusters).sort((a, b) => b.ids.length - a.ids.length);

  const systemicIssues = clusterList
    .filter((x) => x.ids.length >= 4 && x.ids.length / total >= 0.04)
    .slice(0, 3);
  const patternClusters = clusterList.slice(0, 5);

  // —— 根因维度统计 ——
  const failureCounts: Record<string, number> = {};
  for (const c of convs) {
    if (c.failureType) failureCounts[c.failureType] = (failureCounts[c.failureType] || 0) + 1;
  }
  const failureDimensions = [
    "knowledge_gap",
    "routing_error",
    "policy_limit",
    "merchant_misunderstanding",
    "systemic_unsolvable",
  ] as const;

  const severity = (count: number) => {
    if (count === 0) return "—";
    const pct = (count / total) * 100;
    if (pct >= 15) return "高";
    if (pct >= 6) return "中";
    return "低";
  };

  // —— 代表性对话 ——
  const reps = selectRepresentatives(convs);

  // —— 渲染 Markdown ——
  const lines: string[] = [];

  lines.push(`# 跨境电商商家工单分析周报`);
  lines.push("");
  lines.push(
    `**周期**:${fmt(from)} ~ ${fmt(to)}　**样本量**:${total} 通工单　**英文占比**:${enShare.toFixed(1)}% (${enCount} 通)　**生成时间**:${new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", " ")}`
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // ========== 0. 系统性总结表 ==========
  lines.push(`# 0. 系统性总结(Executive Snapshot)`);
  lines.push("");
  lines.push(`| 维度 | 本周表现 | 环比 | 健康度 |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(
    `| 工单总量 | ${total} 通 | ${prevTotal ? deltaStr(total, prevTotal, " 通", 0) : "—"} | — |`
  );
  lines.push(
    `| 一次性解决率 | **${resolutionRate.toFixed(1)}%** | ${deltaStr(resolutionRate, prevResolutionRate)} | ${
      resolutionRate >= 60 ? "🟢 健康" : resolutionRate >= 40 ? "🟡 关注" : "🔴 告警"
    } |`
  );
  lines.push(
    `| Bad Case 率 | **${badCaseRate.toFixed(1)}%** (${badCaseCount} 通) | ${deltaStr(badCaseRate, prevBadCaseRate)} | ${
      badCaseRate <= 40 ? "🟢 健康" : badCaseRate <= 60 ? "🟡 关注" : "🔴 告警"
    } |`
  );
  lines.push(
    `| 转人工率 | ${escalationRate.toFixed(1)}% | ${deltaStr(escalationRate, prevEscalationRate)} | ${
      escalationRate <= 20 ? "🟢 健康" : escalationRate <= 35 ? "🟡 关注" : "🔴 告警"
    } |`
  );
  lines.push(
    `| 平均 CSAT | ${avgCsat.toFixed(2)} / 5.0 | ${deltaStr(avgCsat, prevCsat, "", 2)} | ${
      avgCsat >= 3.5 ? "🟢 健康" : avgCsat >= 2.5 ? "🟡 关注" : "🔴 告警"
    } |`
  );
  lines.push(
    `| 英文工单占比 | ${enShare.toFixed(1)}% | — | ${enShare >= 20 ? "🟡 关注双语承接" : "🟢 健康"} |`
  );
  lines.push(`| 系统性问题数 | ${systemicIssues.length} 类 | — | ${systemicIssues.length === 0 ? "🟢 健康" : systemicIssues.length <= 2 ? "🟡 关注" : "🔴 告警"} |`);
  lines.push("");

  // 场景 bad case 率表
  lines.push(`**各业务场景 Bad Case 率**(按 bad rate 倒序):`);
  lines.push("");
  lines.push(`| 业务场景 | 工单量 | Bad Case | Bad Case 率 | 转人工率 |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const r of categoryRows) {
    const flag = r.badRate >= 70 ? "🔴" : r.badRate >= 50 ? "🟡" : "🟢";
    lines.push(
      `| ${r.category} | ${r.total} | ${r.bad} | **${r.badRate.toFixed(1)}%** ${flag} | ${r.escRate.toFixed(1)}% |`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ========== 1. 本周整体概览 ==========
  lines.push(`# 1. 本周整体概览(Summary)`);
  lines.push("");
  lines.push(
    `**整体表现**:平台本周期处理 **${total} 通**商家工单(其中 ${enCount} 通英文,占比 ${enShare.toFixed(1)}%),一次性解决率 **${resolutionRate.toFixed(
      1
    )}%**,Bad Case 率 **${badCaseRate.toFixed(1)}%**(共 ${badCaseCount} 通),转人工率 **${escalationRate.toFixed(
      1
    )}%**,平均 CSAT **${avgCsat.toFixed(2)}** / 5.0。`
  );
  lines.push("");
  lines.push(`**关键指标趋势**:`);
  lines.push(`- 一次性解决率:${resolutionRate.toFixed(1)}%　${deltaStr(resolutionRate, prevResolutionRate)}`);
  lines.push(`- Bad Case 率:${badCaseRate.toFixed(1)}%　${deltaStr(badCaseRate, prevBadCaseRate)}`);
  lines.push(`- 转人工率:${escalationRate.toFixed(1)}%　${deltaStr(escalationRate, prevEscalationRate)}`);
  lines.push(`- 平均 CSAT:${avgCsat.toFixed(2)}　${deltaStr(avgCsat, prevCsat, "", 2)}`);
  lines.push("");
  lines.push(`**本周期最重要的系统性问题**:`);
  if (systemicIssues.length === 0) {
    lines.push(`- 未识别出达到系统性规模(≥4 通且占比 ≥4%)的失效集群。`);
  } else {
    systemicIssues.forEach((s, i) => {
      const pct = ((s.ids.length / total) * 100).toFixed(1);
      lines.push(
        `${i + 1}. **${FAILURE_LABEL[s.failureType] || s.failureType} · ${s.category}**:影响 ${
          s.ids.length
        } 通(${pct}%),需优先处理。`
      );
    });
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ========== 2. Top 系统性问题 ==========
  lines.push(`# 2. Top 系统性问题`);
  lines.push("");
  if (llmInsights && llmInsights.topProblems.length > 0) {
    lines.push(`> _本节由 LLM 基于本周失效集群生成_`);
    lines.push("");
    llmInsights.topProblems.forEach((tp, i) => {
      const ftLabel = FAILURE_LABEL[tp.bucket.failureType] || tp.bucket.failureType;
      const headTitle = hasErr(tp.insight)
        ? `${ftLabel} · ${tp.bucket.category}`
        : tp.insight.title;
      lines.push(`## 2.${i + 1} ${headTitle}`);
      lines.push("");
      if (hasErr(tp.insight)) {
        lines.push(
          `- **问题描述**:LLM 生成失败 (${tp.insight.__err})，集群规模 ${tp.bucketSize} 通(${tp.ratio.toFixed(1)}%)。`
        );
      } else {
        lines.push(`- **问题描述**:${tp.insight.problemStatement}`);
        lines.push(`- **影响范围**:${tp.insight.impactScope}`);
        lines.push(`- **影响结果**:${tp.insight.impactResult}`);
      }
      const voice = pickMerchantVoice(convs, [tp.sampleConv.id]);
      if (voice) {
        lines.push(
          `- **商家原声** \`${voice.externalId}\` · ${voice.region}${voice.language === "en" ? " · 🇬🇧 英文" : ""}:`
        );
        lines.push(`  > ${voice.original}`);
        if (voice.translated) lines.push(`  > *中文翻译*:${voice.translated}`);
      }
      lines.push("");
    });
  } else if (systemicIssues.length === 0) {
    lines.push("本周期未识别出系统性规模的失效问题。建议持续观察并关注转人工率变化。");
  } else {
    systemicIssues.forEach((s, i) => {
      const pct = ((s.ids.length / total) * 100).toFixed(1);
      const sampleConv = convs.find((c) => c.id === s.ids[0]);
      const ftLabel = FAILURE_LABEL[s.failureType] || s.failureType;
      const issueName = inferIssueName(s.failureType, s.category, sampleConv?.primaryIntent);
      const escInCluster = convs.filter(
        (c) => s.ids.includes(c.id) && c.resolutionStatus === "escalated"
      ).length;
      const csatInCluster =
        s.ids.reduce((sum, id) => {
          const cv = convs.find((c) => c.id === id);
          return sum + (cv?.satisfactionScore || 0);
        }, 0) / s.ids.length;

      lines.push(`## 2.${i + 1} ${issueName}`);
      lines.push("");
      lines.push(
        `- **问题描述**:${sampleConv?.failureReason || ftLabel + "相关失效"} 该集群下机器人始终给出通用回复,无法推进到结案。`
      );
      lines.push(
        `- **影响范围**:${s.ids.length} 通工单(占本周 ${pct}%),集中在「${s.category}」业务下的「${
          sampleConv?.primaryIntent || "—"
        }」类意图。`
      );
      lines.push(
        `- **影响结果**:集群内 CSAT ${csatInCluster.toFixed(2)} / 5.0(显著低于整体 ${avgCsat.toFixed(
          2
        )}),${escInCluster} 通触发转人工(升级率 ${((escInCluster / s.ids.length) * 100).toFixed(
          0
        )}%),存在商家流失风险。`
      );
      // 商家原声
      const voice = pickMerchantVoice(convs, s.ids);
      if (voice) {
        lines.push(`- **商家原声** \`${voice.externalId}\` · ${voice.region}${voice.language === "en" ? " · 🇬🇧 英文" : ""}:`);
        lines.push(`  > ${voice.original}`);
        if (voice.translated) {
          lines.push(`  > *中文翻译*:${voice.translated}`);
        }
      }
      lines.push("");
    });
  }
  lines.push("---");
  lines.push("");

  // ========== 3. 失败模式归类 ==========
  lines.push(`# 3. 失败模式归类(Pattern Clusters)`);
  lines.push("");
  if (llmInsights && llmInsights.failurePatterns.length > 0) {
    lines.push(`> _本节由 LLM 基于失效归因分布生成_`);
    lines.push("");
    llmInsights.failurePatterns.forEach((fp, i) => {
      const ftLabel = FAILURE_LABEL[fp.failureType] || fp.failureType;
      lines.push(`### 模式 ${i + 1}:${ftLabel}`);
      if (hasErr(fp.insight)) {
        lines.push(`- **典型表现**:LLM 生成失败 (${fp.insight.__err})`);
      } else {
        lines.push(`- **典型表现**:${fp.insight.typicalBehavior}`);
        lines.push(`- **触发场景**:${fp.insight.triggerScenario}`);
      }
      lines.push(`- **覆盖量**:${fp.bucketSize} 通(${fp.ratio.toFixed(1)}%)`);
      const voice = pickMerchantVoice(convs, [fp.sampleConv.id]);
      if (voice) {
        lines.push(`- **商家原声** \`${voice.externalId}\`${voice.language === "en" ? " · 🇬🇧" : ""}:`);
        lines.push(`  > ${voice.original}`);
        if (voice.translated) lines.push(`  > *中文*:${voice.translated}`);
      }
      lines.push("");
    });
  } else if (patternClusters.length === 0) {
    lines.push("本周期失败对话数量不足以归类。");
  } else {
    patternClusters.forEach((p, i) => {
      const sampleConv = convs.find((c) => c.id === p.ids[0]);
      const ftLabel = FAILURE_LABEL[p.failureType] || p.failureType;
      const patternName = `${ftLabel} × ${p.category}`;
      lines.push(`### 模式 ${i + 1}:${patternName}`);
      lines.push(`- **典型表现**:${describePattern(p.failureType)}`);
      lines.push(
        `- **触发场景**:「${p.category}」业务,商家咨询「${sampleConv?.primaryIntent || "—"}」类问题。`
      );
      lines.push(`- **覆盖量**:${p.ids.length} 通(${((p.ids.length / total) * 100).toFixed(1)}%)`);
      const voice = pickMerchantVoice(convs, p.ids);
      if (voice) {
        lines.push(`- **商家原声** \`${voice.externalId}\`${voice.language === "en" ? " · 🇬🇧" : ""}:`);
        lines.push(`  > ${voice.original}`);
        if (voice.translated) {
          lines.push(`  > *中文*:${voice.translated}`);
        }
      }
      lines.push("");
    });
  }
  lines.push("---");
  lines.push("");

  // ========== 4. 根因分析 ==========
  lines.push(`# 4. 根因分析(Root Cause)`);
  lines.push("");
  lines.push(`| 维度 | 出现频率 | 严重程度 | 典型例子 |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const dim of failureDimensions) {
    const count = failureCounts[dim] || 0;
    const pct = total ? ((count / total) * 100).toFixed(1) : "0.0";
    const sample = convs.find((c) => c.failureType === dim);
    const example = sample
      ? `${sample.externalId} · ${sample.category} · ${sample.primaryIntent}`
      : "本周期未出现";
    lines.push(`| ${FAILURE_LABEL[dim]} | ${count} 通(${pct}%) | ${severity(count)} | ${example} |`);
  }
  lines.push("");
  lines.push(`**根因解读 + 商家原声**:`);
  lines.push("");
  if (llmInsights && !hasErr(llmInsights.rootCause)) {
    lines.push(`> _本节由 LLM 基于失效分布与抽样工单生成_`);
    lines.push("");
    for (const rc of llmInsights.rootCause.rootCauses) {
      lines.push(`#### ${rc.layer}`);
      lines.push(rc.description);
      lines.push(`> 证据:${rc.evidence}`);
      lines.push("");
    }
  } else {
  for (const dim of failureDimensions) {
    const count = failureCounts[dim] || 0;
    if (count === 0) continue;
    lines.push(`#### ${FAILURE_LABEL[dim]}(${count} 通)`);
    lines.push(`${FAILURE_ROOT_CAUSE[dim]}`);
    const sampleIds = convs.filter((c) => c.failureType === dim).map((c) => c.id);
    const voice = pickMerchantVoice(convs, sampleIds);
    if (voice) {
      lines.push(`> 商家原声 \`${voice.externalId}\`${voice.language === "en" ? " · 🇬🇧" : ""}:${voice.original}`);
      if (voice.translated) lines.push(`> *中文*:${voice.translated}`);
    }
    lines.push("");
  }
  } // end of root-cause llm/template if-else
  lines.push("---");
  lines.push("");

  // ========== 5. 可执行优化建议 ==========
  lines.push(`# 5. 可执行优化建议(Action Items)`);
  lines.push("");
  if (llmInsights && !hasErr(llmInsights.recommendations)) {
    lines.push(`> _本节由 LLM 基于本周根因生成可执行建议_`);
    lines.push("");
    const recs = llmInsights.recommendations.recommendations;
    for (const tier of ["P0", "P1", "P2"] as const) {
      const items = recs.filter((r) => r.priority === tier);
      lines.push(`## ${tier}(${tier === "P0" ? "必须立即做" : tier === "P1" ? "重要优化" : "长期优化"})`);
      lines.push("");
      if (items.length === 0) {
        lines.push(`- 本周期暂无 ${tier} 级别建议。`);
      } else {
        items.forEach((a, i) => {
          lines.push(`**${tier}-${i + 1}　${a.title}**`);
          lines.push(`- 具体改动:${a.action}`);
          lines.push(`- 责任方:${a.owner}`);
          lines.push(`- 预期影响:${a.expectedImpact}`);
          lines.push("");
        });
      }
    }
  } else {
  const actions = buildActions(failureCounts, systemicIssues, total, convs);
  for (const tier of ["P0", "P1", "P2"] as const) {
    const items = actions.filter((a) => a.tier === tier);
    lines.push(`## ${tier}(${tier === "P0" ? "必须立即做" : tier === "P1" ? "重要优化" : "长期优化"})`);
    lines.push("");
    if (items.length === 0) {
      lines.push(`- 本周期暂无 ${tier} 级别建议。`);
    } else {
      items.forEach((a, i) => {
        lines.push(`**${tier}-${i + 1}　${a.title}**`);
        lines.push(`- 具体改动:${a.action}`);
        lines.push(`- 解决问题:${a.target}`);
        lines.push(`- 预期影响:${a.impact}`);
        lines.push("");
      });
    }
  }
  } // end of recommendations llm/template if-else
  lines.push("---");
  lines.push("");

  // ========== 6. 代表性对话(完整原声) ==========
  lines.push(`# 6. 代表性对话(完整原声)`);
  lines.push("");
  let repsForRender: Array<Conversation & { reason: string; insight: string }> = reps as any;
  if (llmInsights && !hasErr(llmInsights.representative)) {
    lines.push(`> _本节工单由 LLM 从候选池精选_`);
    lines.push("");
    const picks = llmInsights.representative.picks;
    const llmReps = picks
      .map((p) => {
        const conv = convs.find((c) => c.externalId === p.conversationId);
        if (!conv) return null;
        return { ...conv, reason: p.whyTypical, insight: p.productImplication };
      })
      .filter((x): x is Conversation & { reason: string; insight: string } => !!x)
      .slice(0, 5);
    if (llmReps.length > 0) repsForRender = llmReps;
  }
  if (repsForRender.length === 0) {
    lines.push("本周期数据不足,无代表性样本。");
  } else {
    repsForRender.forEach((r, i) => {
      lines.push(`### 样本 ${i + 1}:${r.externalId}`);
      lines.push(
        `- **基本信息**:${r.category} · ${r.primaryIntent} · ${r.turns} 轮 · CSAT ${
          r.satisfactionScore?.toFixed(1) ?? "—"
        } · 区域 ${REGION_LABEL[r.merchantRegion] || r.merchantRegion} · ${r.language === "en" ? "🇬🇧 英文" : "🇨🇳 中文"}`
      );
      lines.push(`- **为什么典型**:${r.reason}`);
      lines.push(`- **对应问题类**:${FAILURE_LABEL[r.failureType || ""] || "—"}`);
      lines.push(`- **对产品的启示**:${r.insight}`);
      lines.push("");
      lines.push(`**完整对话原声**:`);
      lines.push("");
      const orig = safeParse<Turn[]>(r.rawTranscript, []);
      const trans = safeParse<Turn[]>(r.translatedTranscript, []);
      orig.forEach((turn, idx) => {
        const speaker = turn.role === "merchant" ? "🧑 商家" : turn.role === "human" ? "🎧 平台(人工)" : "🤖 平台(机器人)";
        lines.push(`> **${speaker}** · ${turn.ts}`);
        lines.push(`> ${turn.content}`);
        if (r.language === "en" && trans[idx]) {
          lines.push(`> *中文翻译*:${trans[idx].content}`);
        }
        lines.push("");
      });
    });
  }
  lines.push("---");
  lines.push("");
  lines.push(`*报告由 Insight CS 自动生成 · 共分析 ${total} 通商家工单 · 失败聚类 + LLM 根因归因*`);
  lines.push("");

  return lines.join("\n");
}

// ========================================================
// 辅助函数
// ========================================================

function inferIssueName(failureType: string, category: string, intent?: string): string {
  const map: Record<string, string> = {
    knowledge_gap: `${category}场景下知识库覆盖不足`,
    routing_error: `${category}工单首轮路由策略偏差`,
    policy_limit: `${category}诉求超出现有政策边界`,
    merchant_misunderstanding: `${category}规则商家认知偏差`,
    systemic_unsolvable: `${category}外部依赖数据缺失`,
  };
  const base = map[failureType] || `${FAILURE_LABEL[failureType] || failureType}(${category})`;
  return intent ? `${base}(${intent})` : base;
}

function describePattern(ft: string): string {
  const map: Record<string, string> = {
    knowledge_gap: "机器人多轮给出通用模板回复,无法命中商家具体诉求,工单冗长且最终未解决。",
    routing_error: "首轮意图识别错误,工单被错误分配至非对应业务组,解答方向偏离。",
    policy_limit: "商家诉求触碰政策硬边界(如举证类型不全、超期),机器人僵化驳回,缺乏弹性沟通。",
    merchant_misunderstanding: "商家对平台规则/责任归属理解错误,机器人未主动澄清,对话陷入循环。",
    systemic_unsolvable: "工单依赖上游/外部系统实时数据(银行通道、3PL、海关),平台侧无法直接给出确定性答复。",
  };
  return map[ft] || "对话表现为 LLM 输出与商家诉求长期错位。";
}

function pickMerchantVoice(
  allConvs: Conversation[],
  candidateIds: number[]
): { externalId: string; original: string; translated?: string; language: string; region: string } | null {
  // 偏好情绪激烈/转人工/英文工单作为代表声
  const pool = candidateIds
    .map((id) => allConvs.find((c) => c.id === id))
    .filter((c): c is Conversation => !!c);
  if (pool.length === 0) return null;

  const ranked = [...pool].sort((a, b) => {
    const score = (x: Conversation) =>
      (x.emotionEnd === "愤怒" ? 3 : x.emotionEnd === "失望" ? 2 : 0) +
      (x.resolutionStatus === "escalated" ? 2 : 0) +
      (x.language === "en" ? 1 : 0) +
      x.turns / 4;
    return score(b) - score(a);
  });

  for (const c of ranked) {
    const turns = safeParse<Turn[]>(c.rawTranscript, []);
    const transTurns = safeParse<Turn[]>(c.translatedTranscript, []);
    // 优先找升级类发言(通常是商家原声里最有信号的那条)
    const merchantTurns = turns.filter((t) => t.role === "merchant");
    if (merchantTurns.length === 0) continue;
    const target = merchantTurns[merchantTurns.length - 1]; // 最后一条商家发言通常最强烈
    const idx = turns.indexOf(target);
    return {
      externalId: c.externalId,
      original: target.content,
      translated: c.language === "en" && transTurns[idx] ? transTurns[idx].content : undefined,
      language: c.language,
      region: REGION_LABEL[c.merchantRegion] || c.merchantRegion,
    };
  }
  return null;
}

function buildActions(
  failureCounts: Record<string, number>,
  systemicIssues: Array<{ failureType: string; category: string; ids: number[] }>,
  total: number,
  convs: Conversation[]
) {
  const actions: Array<{
    tier: "P0" | "P1" | "P2";
    title: string;
    action: string;
    target: string;
    impact: string;
  }> = [];

  systemicIssues.forEach((s) => {
    const pct = ((s.ids.length / total) * 100).toFixed(1);
    const sample = convs.find((c) => c.id === s.ids[0]);
    const intent = sample?.primaryIntent || "相关意图";
    if (s.failureType === "knowledge_gap") {
      actions.push({
        tier: "P0",
        title: `补充「${s.category} · ${intent}」原子知识到商家帮助中心`,
        action: `针对「${intent}」拆分 5-8 条原子 FAQ(覆盖常见变体、责任归属边界、跨场景叠加规则),由内容团队 3 个工作日内完成入库,机器人侧建立直读通路,并加入夜间回归测试集。`,
        target: `${FAILURE_LABEL[s.failureType]} · ${s.category}(影响 ${s.ids.length} 通 / ${pct}%)`,
        impact: `预计该集群解决率从当前 0% 提升至 ≥60%,对应转人工率下降约 ${((s.ids.length * 0.6) / total * 100).toFixed(
          1
        )} 个百分点。`,
      });
    } else if (s.failureType === "routing_error") {
      actions.push({
        tier: "P0",
        title: `调整「${s.category} · ${intent}」首轮路由策略`,
        action: `在路由决策树中将该意图首轮直接命中后转入对应业务组的双语人工队列(英文工单走双语队列),跳过机器人多轮尝试;增加该意图的训练样本至少 200 条。`,
        target: `${FAILURE_LABEL[s.failureType]} · ${s.category}(影响 ${s.ids.length} 通 / ${pct}%)`,
        impact: `减少无效机器人轮次约 ${s.ids.reduce((sum, id) => sum + (convs.find((c) => c.id === id)?.turns || 0), 0)} 轮,CSAT 预期提升 0.3-0.5 分。`,
      });
    } else if (s.failureType === "policy_limit") {
      actions.push({
        tier: "P0",
        title: `扩充「${s.category} · ${intent}」举证材料类型 + 灰度通道`,
        action: `联合政策团队对该场景下「合理超限」情形(如因物流延迟导致超期、举证材料类型不在白名单)扩充举证材料 + 开放有条件灰度通道,机器人具备识别合理性 + 一键提交工单的能力。`,
        target: `${FAILURE_LABEL[s.failureType]} · ${s.category}(影响 ${s.ids.length} 通 / ${pct}%)`,
        impact: `预计 60% 该类对话可在机器人侧闭环,减少转人工同时提升 CSAT 0.4 分以上。`,
      });
    } else if (s.failureType === "merchant_misunderstanding") {
      actions.push({
        tier: "P0",
        title: `首轮主动澄清「${s.category} · ${intent}」责任归属`,
        action: `机器人识别到该意图后,首轮直接给出责任归属图(平台/3PL/货代/银行通道)+ 官方规则要点 + 跳转链接,避免商家在错误对象上反复沟通。`,
        target: `${FAILURE_LABEL[s.failureType]} · ${s.category}(影响 ${s.ids.length} 通 / ${pct}%)`,
        impact: `减少 30%+ 因责任归属误解导致的循环对话,首轮解决率显著提升。`,
      });
    } else {
      actions.push({
        tier: "P0",
        title: `专项治理「${s.category} · ${intent}」失效集群`,
        action: `拉通商家支持 + 业务 + 数据三方,针对该失效模式 5 个工作日内出具治理方案与回归指标(包含与上游通道的 SLA 谈判)。`,
        target: `${FAILURE_LABEL[s.failureType]} · ${s.category}(影响 ${s.ids.length} 通 / ${pct}%)`,
        impact: `集群级解决率提升 ≥ 30%。`,
      });
    }
  });

  // P1
  const dimMap: Array<[string, "P1" | "P2"]> = [
    ["knowledge_gap", "P1"],
    ["routing_error", "P1"],
    ["policy_limit", "P1"],
    ["merchant_misunderstanding", "P1"],
    ["systemic_unsolvable", "P2"],
  ];
  for (const [dim, tier] of dimMap) {
    const count = failureCounts[dim] || 0;
    const alreadyCovered = systemicIssues.some((s) => s.failureType === dim);
    if (count >= 5 && !alreadyCovered) {
      if (dim === "knowledge_gap") {
        actions.push({
          tier,
          title: "扩充商家帮助中心结构化字段",
          action: "联动招商 + 物流 + 财务三个中台,把高频追问的规则字段(VAT/海外仓 SLA/结算账期)补全为结构化字段,机器人直读。",
          target: `${FAILURE_LABEL[dim]}(${count} 通)`,
          impact: "减少机器人对此类问题的「猜测式」回答,CSAT 预期提升 0.2 分。",
        });
      } else if (dim === "routing_error") {
        actions.push({
          tier,
          title: "英文/非中文工单首轮直转双语人工",
          action: "对语言识别为 en 或非 zh 的工单,首轮即进入双语人工队列,跳过机器人尝试,并对双语人工 SLA 设定独立考核。",
          target: `${FAILURE_LABEL[dim]}(${count} 通)`,
          impact: "降低首轮路由错误率 ≥ 30%,英文商家 CSAT 提升 0.5 分以上。",
        });
      } else if (dim === "merchant_misunderstanding") {
        actions.push({
          tier,
          title: "机器人首轮主动澄清规则",
          action: "识别商家表述中的「规则误解」信号(如责任归属、举证范围、申诉窗口),机器人首轮即给出官方规则要点 + 引用链接。",
          target: `${FAILURE_LABEL[dim]}(${count} 通)`,
          impact: "减少 30% 因商家预期偏差导致的循环对话。",
        });
      } else if (dim === "policy_limit") {
        actions.push({
          tier,
          title: "建立政策灰度场景白名单",
          action: "梳理近 30 天因政策限制升级的工单,按发生频次产出灰度白名单与对应话术,机器人对白名单场景给出有温度的边界说明。",
          target: `${FAILURE_LABEL[dim]}(${count} 通)`,
          impact: "CSAT 提升 0.2-0.3 分,缓解商家负面情绪。",
        });
      } else if (dim === "systemic_unsolvable") {
        actions.push({
          tier,
          title: "与上游物流/支付系统打通实时数据接口",
          action: "推动平台与三方物流、支付通道签订 SLA 与数据回写时延,机器人具备实时数据查询能力。",
          target: `${FAILURE_LABEL[dim]}(${count} 通)`,
          impact: "彻底消除该类「无解」工单,长期 CSAT 提升 0.5 分以上。",
        });
      }
    }
  }

  if (actions.filter((a) => a.tier === "P1").length === 0) {
    actions.push({
      tier: "P1",
      title: "建立周度失效集群自动巡检",
      action: "将本报告中的失败聚类逻辑固化为定时任务,每周一自动产出 Top 5 集群清单并推送至产品 + 内容运营群。",
      target: "持续保障 — 防止新失效模式累积",
      impact: "新失效模式响应周期从 14 天缩短至 7 天。",
    });
  }
  if (actions.filter((a) => a.tier === "P2").length === 0) {
    actions.push({
      tier: "P2",
      title: "搭建情绪 - 解决率因果分析体系",
      action: "基于本周期情绪轨迹数据,建立「情绪拐点 → 失效根因」的归因模型,3 个月内落地。",
      target: "结构性认知缺口 — 缺乏情绪与失效关系的量化洞察",
      impact: "为路由策略、话术优化提供数据驱动的决策依据。",
    });
  }
  return actions;
}

function selectRepresentatives(convs: Conversation[]) {
  type Rep = Conversation & { reason: string; insight: string };
  const out: Rep[] = [];

  // 1) 失败 + 长对话
  const stuck = convs
    .filter((c) => c.resolutionStatus !== "resolved" && c.turns >= 8)
    .sort((a, b) => b.turns - a.turns)[0];
  if (stuck) {
    out.push({
      ...stuck,
      reason: `工单 ${stuck.turns} 轮仍未结案,典型「机器人通用回复循环」表现,商家最终未拿到具体答复。`,
      insight: "需在 4 轮无进展时强制断点 → 转双语人工 / 工单兜底,避免对话沉没成本。",
    });
  }

  // 2) 英文工单(优先)— 升级 + 情绪负向
  const en = convs
    .filter((c) => c.language === "en" && !out.find((x) => x.id === c.id))
    .sort((a, b) => {
      const score = (x: Conversation) =>
        (x.emotionEnd === "愤怒" ? 3 : x.emotionEnd === "失望" ? 2 : 0) +
        (x.resolutionStatus === "escalated" ? 2 : 0) +
        x.turns / 4;
      return score(b) - score(a);
    })[0];
  if (en) {
    out.push({
      ...en,
      reason: `海外商家英文工单,机器人多轮模板应答,商家情绪从 ${en.emotionStart} → ${en.emotionEnd}。验证英文工单首轮直转双语人工的必要性。`,
      insight: "非中文工单应跳过机器人,直接进入双语人工队列,并对双语 SLA 设定独立考核。",
    });
  }

  // 3) 系统不可解 / 情绪急转
  const sysUn = convs.find(
    (c) => c.failureType === "systemic_unsolvable" && !out.find((x) => x.id === c.id)
  );
  if (sysUn) {
    out.push({
      ...sysUn,
      reason: `属于「平台侧无解」类工单,体现对上游(银行通道/3PL)的强依赖,平台只能告知商家等待。`,
      insight: "推动与三方系统的实时数据互通,是从根本上解决此类工单的唯一路径;短期需在前置话术中明示责任归属。",
    });
  }

  return out.slice(0, 3);
}
