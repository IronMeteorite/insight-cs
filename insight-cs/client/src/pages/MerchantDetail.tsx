import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import type { Merchant, MerchantEvent, Conversation } from "@shared/schema";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import {
  ArrowLeft,
  Quote,
  Flame,
  AlertTriangle,
  ShieldAlert,
  Lightbulb,
  Activity,
  TrendingDown,
  ChevronRight,
  MapPin,
  MessageSquare,
} from "lucide-react";

const REGION_LABEL: Record<string, string> = {
  CN: "中国",
  US: "美国",
  EU: "欧洲",
  SEA: "东南亚",
  LATAM: "拉美",
  MEA: "中东/非洲",
};

const TIER_STYLE: Record<string, { label: string; pill: string; bar: string }> = {
  critical: {
    label: "极高风险",
    pill: "bg-destructive/15 text-destructive border-destructive/40",
    bar: "bg-destructive",
  },
  high: {
    label: "高风险",
    pill: "bg-[hsl(var(--chart-5))]/15 text-[hsl(var(--chart-5))] border-[hsl(var(--chart-5))]/40",
    bar: "bg-[hsl(var(--chart-5))]",
  },
  medium: {
    label: "中等风险",
    pill: "bg-[hsl(var(--chart-4))]/15 text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4))]/40",
    bar: "bg-[hsl(var(--chart-4))]",
  },
  low: {
    label: "低风险",
    pill: "bg-muted text-muted-foreground border-border",
    bar: "bg-[hsl(var(--chart-2))]",
  },
};

const FAILURE_LABEL: Record<string, string> = {
  knowledge_gap: "知识缺口",
  routing_error: "路由错误",
  policy_limit: "政策限制",
  merchant_misunderstanding: "商家理解偏差",
  systemic_unsolvable: "系统性无解",
};

const EVENT_STYLE: Record<string, { label: string; color: string; dot: string }> = {
  complaint: { label: "投诉", color: "text-[hsl(var(--chart-4))]", dot: "bg-[hsl(var(--chart-4))]" },
  escalation: { label: "升级", color: "text-[hsl(var(--chart-5))]", dot: "bg-[hsl(var(--chart-5))]" },
  resolution: { label: "解决", color: "text-[hsl(var(--chart-2))]", dot: "bg-[hsl(var(--chart-2))]" },
  churn_signal: { label: "流失信号", color: "text-destructive", dot: "bg-destructive" },
};

const RESOLUTION_LABEL: Record<string, string> = {
  resolved: "已解决",
  unresolved: "未解决",
  escalated: "已升级",
  abandoned: "已放弃",
};

const EMOTION_LABEL: Record<string, string> = {
  愤怒: "愤怒",
  失望: "失望",
  焦虑: "焦虑",
  中性: "中性",
  满意: "满意",
};

interface DetailResp {
  merchant: Merchant;
  events: MerchantEvent[];
  tickets: Conversation[];
}

export default function MerchantDetail() {
  const [, params] = useRoute("/merchants/:id");
  const id = params?.id;

  const { data, isLoading } = useQuery<DetailResp>({
    queryKey: [`/api/merchants/${id}`],
    enabled: !!id,
  });

  if (!id) return null;

  if (isLoading || !data) {
    return (
      <AppLayout>
        <PageHeader title="商家详情" subtitle="加载中…" />
        <div className="px-8 py-12 text-center text-muted-foreground text-[13px]">
          加载商家画像…
        </div>
      </AppLayout>
    );
  }

  const { merchant: m, events, tickets } = data;
  const tier = TIER_STYLE[m.riskTier] || TIER_STYLE.low;
  const cats = safeParseArr(m.topCategories);
  const fts = safeParseArr(m.topFailureTypes);
  const quotes = safeParseArr(m.keyQuotes);
  const riskPct = Math.round((m.churnRiskScore ?? 0) * 100);

  // 排序事件按时间
  const sortedEvents = [...events].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : -1
  );

  // 工单按时间排序
  const sortedTickets = [...tickets].sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : -1
  );

  return (
    <AppLayout>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Link href="/merchants">
              <a
                data-testid="back-merchants"
                className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                商家列表
              </a>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono">{m.merchantId}</span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded border uppercase tracking-wider ${tier.pill}`}
            >
              {tier.label}
            </span>
          </span>
        }
        subtitle={
          <span className="flex items-center gap-3 text-[11.5px]">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {REGION_LABEL[m.merchantRegion] || m.merchantRegion}
            </span>
            <span>·</span>
            <span>工单 {m.ticketCount}</span>
            <span>·</span>
            <span>升级 {m.escalatedCount}</span>
            <span>·</span>
            <span>未解决 {m.unresolvedCount}</span>
          </span>
        }
      />

      <div className="px-8 py-6 space-y-6">
        {/* 4 个核心指标 */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            icon={Flame}
            label="流失风险分"
            value={(m.churnRiskScore ?? 0).toFixed(2)}
            sub={`${riskPct}%`}
            tone={m.riskTier === "critical" ? "destructive" : m.riskTier === "high" ? "warning" : undefined}
          >
            <div className="h-1.5 bg-muted rounded mt-2 overflow-hidden">
              <div className={`h-full ${tier.bar}`} style={{ width: `${riskPct}%` }} />
            </div>
          </KpiCard>
          <KpiCard
            icon={AlertTriangle}
            label="坏单率 bad_case_rate"
            value={`${Math.round((m.badCaseRate ?? 0) * 100)}%`}
            sub="未解决 + 已升级 + 放弃"
          />
          <KpiCard
            icon={TrendingDown}
            label="期末平均情绪"
            value={(m.avgEmotionEnd ?? 0).toFixed(2)}
            sub="0=愤怒 · 0.5=中性 · 1=满意"
          />
          <KpiCard
            icon={ShieldAlert}
            label="平均满意度"
            value={(m.avgSatisfaction ?? 0).toFixed(2)}
            sub="0~5 分"
          />
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* 左:LLM 风险叙事 + 推荐动作 */}
          <div className="col-span-2 space-y-4">
            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-3.5 h-3.5 text-[hsl(var(--chart-1))]" />
                <span className="text-[10.5px] text-muted-foreground uppercase tracking-wider">
                  LLM 风险叙事
                </span>
              </div>
              <p className="text-[13.5px] leading-relaxed">
                {m.riskNarrative || (
                  <span className="text-muted-foreground italic">尚未生成叙事</span>
                )}
              </p>
            </div>

            <div className="bg-card border border-card-border rounded-lg p-5 border-l-2 border-l-primary">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10.5px] text-muted-foreground uppercase tracking-wider">
                  推荐下一步动作
                </span>
              </div>
              <p className="text-[13.5px] leading-relaxed">
                {m.recommendedAction || (
                  <span className="text-muted-foreground italic">尚未生成动作</span>
                )}
              </p>
            </div>

            {/* 商家原声 */}
            {quotes.length > 0 && (
              <div className="bg-card border border-card-border rounded-lg p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Quote className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10.5px] text-muted-foreground uppercase tracking-wider">
                    关键商家原声
                  </span>
                </div>
                <div className="space-y-3">
                  {quotes.slice(0, 6).map((q: any, i: number) => (
                    <div
                      key={i}
                      className="border-l-2 border-l-border pl-3"
                      data-testid={`quote-${i}`}
                    >
                      <p className="text-[12.5px] italic leading-relaxed">
                        "{q.quote}"
                      </p>
                      <div className="text-[10.5px] text-muted-foreground mt-1 flex items-center gap-2">
                        <span className="font-mono">
                          工单 {q.ticketId}
                        </span>
                        {q.emotion && (
                          <>
                            <span>·</span>
                            <span>情绪:{EMOTION_LABEL[q.emotion] || q.emotion}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 工单列表 */}
            <div className="bg-card border border-card-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="text-[13px] font-medium">关联工单</span>
                  <span className="text-[11px] text-muted-foreground">
                    {sortedTickets.length} 条
                  </span>
                </div>
              </div>
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {sortedTickets.map((t) => (
                  <Link key={t.id} href={`/conversations/${t.id}`}>
                    <a
                      data-testid={`ticket-${t.id}`}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40 transition-colors"
                    >
                      <span className="font-mono text-[11.5px] text-muted-foreground w-24 truncate">
                        {t.externalId}
                      </span>
                      <span className="text-[11.5px] flex-1 truncate">
                        {t.category} · {t.primaryIntent}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          t.resolutionStatus === "resolved"
                            ? "border-[hsl(var(--chart-2))]/40 text-[hsl(var(--chart-2))] bg-[hsl(var(--chart-2))]/10"
                            : t.resolutionStatus === "escalated"
                            ? "border-[hsl(var(--chart-5))]/40 text-[hsl(var(--chart-5))] bg-[hsl(var(--chart-5))]/10"
                            : t.resolutionStatus === "abandoned"
                            ? "border-destructive/40 text-destructive bg-destructive/10"
                            : "border-border text-muted-foreground bg-muted/30"
                        }`}
                      >
                        {RESOLUTION_LABEL[t.resolutionStatus] || t.resolutionStatus}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground w-32 truncate">
                        {formatDate(t.startedAt)}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    </a>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* 右:Top 类目 + 失效模式 + 事件时间线 */}
          <div className="space-y-4">
            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider mb-2">
                Top 工单类目
              </div>
              <div className="space-y-2">
                {cats.length === 0 && (
                  <div className="text-[11.5px] text-muted-foreground">无</div>
                )}
                {cats.map((c: any, i: number) => {
                  const max = Math.max(...cats.map((x: any) => x.count));
                  const w = max === 0 ? 0 : (c.count / max) * 100;
                  return (
                    <div key={i} className="text-[11.5px]">
                      <div className="flex justify-between mb-0.5">
                        <span>{c.category}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {c.count}
                        </span>
                      </div>
                      <div className="h-1 bg-muted rounded overflow-hidden">
                        <div
                          className="h-full bg-[hsl(var(--chart-1))]"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider mb-2">
                Top 失效模式
              </div>
              <div className="space-y-2">
                {fts.length === 0 && (
                  <div className="text-[11.5px] text-muted-foreground">无</div>
                )}
                {fts.map((f: any, i: number) => {
                  const max = Math.max(...fts.map((x: any) => x.count));
                  const w = max === 0 ? 0 : (f.count / max) * 100;
                  return (
                    <div key={i} className="text-[11.5px]">
                      <div className="flex justify-between mb-0.5">
                        <span>{FAILURE_LABEL[f.type] || f.type}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {f.count}
                        </span>
                      </div>
                      <div className="h-1 bg-muted rounded overflow-hidden">
                        <div
                          className="h-full bg-[hsl(var(--chart-5))]"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 事件时间线 */}
            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider mb-3">
                事件时间线
              </div>
              <div className="relative pl-5 space-y-3 max-h-[480px] overflow-y-auto">
                <div className="absolute left-1.5 top-1 bottom-1 w-px bg-border" />
                {sortedEvents.length === 0 && (
                  <div className="text-[11.5px] text-muted-foreground">无事件</div>
                )}
                {sortedEvents.slice(0, 30).map((e) => {
                  const st = EVENT_STYLE[e.eventType] || EVENT_STYLE.complaint;
                  return (
                    <div
                      key={e.id}
                      className="relative"
                      data-testid={`event-${e.id}`}
                    >
                      <div
                        className={`absolute -left-[14px] top-1 w-2 h-2 rounded-full ${st.dot} ring-2 ring-background`}
                      />
                      <div className="flex items-center gap-2">
                        <span className={`text-[10.5px] uppercase tracking-wider ${st.color}`}>
                          {st.label}
                        </span>
                        <span className="text-[10.5px] text-muted-foreground">
                          {formatDate(e.occurredAt)}
                        </span>
                      </div>
                      <div className="text-[11.5px] mt-0.5">
                        {e.category}
                        <span className="text-muted-foreground">
                          {" "}
                          · 情绪 {(e.emotionScore ?? 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function safeParseArr(s: string | null | undefined): any[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  children,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "destructive" | "warning";
  children?: React.ReactNode;
}) {
  const tint =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
      ? "text-[hsl(var(--chart-5))]"
      : "text-foreground";
  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${tint}`} />
        <span className="text-[10.5px] text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className={`text-[22px] font-semibold tabular-nums mt-1.5 ${tint}`}>
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</div>}
      {children}
    </div>
  );
}
