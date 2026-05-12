import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { Merchant } from "@shared/schema";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Flame,
  TrendingDown,
  ShieldAlert,
  ChevronRight,
  MapPin,
} from "lucide-react";

const REGION_LABEL: Record<string, string> = {
  CN: "中国",
  US: "美国",
  EU: "欧洲",
  SEA: "东南亚",
  LATAM: "拉美",
  MEA: "中东/非洲",
};

const TIER_STYLE: Record<
  string,
  { label: string; pill: string; row: string; bar: string }
> = {
  critical: {
    label: "极高风险",
    pill: "bg-destructive/15 text-destructive border-destructive/40",
    row: "border-l-2 border-l-destructive",
    bar: "bg-destructive",
  },
  high: {
    label: "高风险",
    pill: "bg-[hsl(var(--chart-5))]/15 text-[hsl(var(--chart-5))] border-[hsl(var(--chart-5))]/40",
    row: "border-l-2 border-l-[hsl(var(--chart-5))]",
    bar: "bg-[hsl(var(--chart-5))]",
  },
  medium: {
    label: "中等风险",
    pill: "bg-[hsl(var(--chart-4))]/15 text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4))]/40",
    row: "",
    bar: "bg-[hsl(var(--chart-4))]",
  },
  low: {
    label: "低风险",
    pill: "bg-muted text-muted-foreground border-border",
    row: "",
    bar: "bg-[hsl(var(--chart-2))]",
  },
};

export default function Merchants() {
  const { data: merchants = [], isLoading } = useQuery<Merchant[]>({
    queryKey: ["/api/merchants"],
  });

  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");

  const sorted = useMemo(
    () =>
      [...merchants].sort(
        (a, b) => (b.churnRiskScore ?? 0) - (a.churnRiskScore ?? 0)
      ),
    [merchants]
  );

  const filtered = sorted.filter(
    (m) =>
      (regionFilter === "all" || m.merchantRegion === regionFilter) &&
      (tierFilter === "all" || m.riskTier === tierFilter)
  );

  // 全局指标
  const totalTickets = merchants.reduce((s, m) => s + (m.ticketCount || 0), 0);
  const criticalCount = merchants.filter((m) => m.riskTier === "critical").length;
  const highCount = merchants.filter((m) => m.riskTier === "high").length;
  const avgRisk =
    merchants.length === 0
      ? 0
      : merchants.reduce((s, m) => s + (m.churnRiskScore || 0), 0) / merchants.length;
  const top20 = sorted.slice(0, 20);

  const regions = Array.from(new Set(merchants.map((m) => m.merchantRegion)));

  return (
    <AppLayout>
      <PageHeader
        title="商家画像"
        subtitle="按流失风险排序的商家全景视图 · 由 LLM 聚合多条工单生成风险叙事与下一步动作建议"
      />
      <div className="px-8 py-6 space-y-6">
        {/* KPI 行 */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            icon={ShieldAlert}
            label="活跃商家"
            value={merchants.length.toString()}
            sub={`累计 ${totalTickets} 通工单`}
          />
          <KpiCard
            icon={Flame}
            label="极高风险"
            value={criticalCount.toString()}
            sub="≥ 0.75 churn 分"
            tone="destructive"
          />
          <KpiCard
            icon={AlertTriangle}
            label="高风险"
            value={highCount.toString()}
            sub="0.5 – 0.75"
            tone="warning"
          />
          <KpiCard
            icon={TrendingDown}
            label="平均流失分"
            value={avgRisk.toFixed(2)}
            sub="0 = 低风险 · 1 = 高风险"
          />
        </div>

        {/* Top 20 风险榜 */}
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-destructive" />
              <span className="text-[13px] font-medium">Top 20 流失风险榜</span>
              <span className="text-[11px] text-muted-foreground">
                按 churn_risk_score 倒序
              </span>
            </div>
            <span className="text-[10.5px] text-muted-foreground">
              点击行查看商家详情
            </span>
          </div>
          <div className="divide-y divide-border">
            {isLoading ? (
              <div className="px-5 py-8 text-center text-muted-foreground text-[13px]">
                加载中…
              </div>
            ) : top20.length === 0 ? (
              <div className="px-5 py-8 text-center text-muted-foreground text-[13px]">
                暂无商家数据
              </div>
            ) : (
              top20.map((m, idx) => {
                const tier = TIER_STYLE[m.riskTier] || TIER_STYLE.low;
                const riskPct = Math.round((m.churnRiskScore ?? 0) * 100);
                return (
                  <Link
                    key={m.merchantId}
                    href={`/merchants/${m.merchantId}`}
                  >
                    <a
                      data-testid={`merchant-row-${m.merchantId}`}
                      className={`flex items-center gap-4 px-5 py-3 hover:bg-muted/40 transition-colors cursor-pointer ${tier.row}`}
                    >
                      <div className="w-6 text-[11px] tabular-nums text-muted-foreground text-right font-mono">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-mono">
                            {m.merchantId}
                          </span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded border uppercase tracking-wider ${tier.pill}`}
                          >
                            {tier.label}
                          </span>
                          <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            {REGION_LABEL[m.merchantRegion] || m.merchantRegion}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-muted-foreground mt-1 truncate">
                          {m.riskNarrative || "尚未生成画像"}
                        </div>
                      </div>
                      <div className="w-56 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                          <div
                            className={`h-full ${tier.bar}`}
                            style={{ width: `${riskPct}%` }}
                          />
                        </div>
                        <span className="text-[11px] tabular-nums w-9 text-right">
                          {riskPct}
                        </span>
                      </div>
                      <div className="w-24 text-[11px] text-muted-foreground tabular-nums">
                        <div className="flex justify-between">
                          <span>工单</span>
                          <span className="text-foreground">{m.ticketCount}</span>
                        </div>
                        <div className="flex justify-between mt-0.5">
                          <span>升级</span>
                          <span className="text-foreground">
                            {m.escalatedCount}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </a>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* 过滤区 + 完整列表 */}
        <div className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">区域:</span>
              {[{ v: "all", l: "全部" }, ...regions.map((r) => ({ v: r, l: REGION_LABEL[r] || r }))].map(
                (o) => (
                  <button
                    key={o.v}
                    data-testid={`region-${o.v}`}
                    onClick={() => setRegionFilter(o.v)}
                    className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                      regionFilter === o.v
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {o.l}
                  </button>
                )
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">风险层级:</span>
              {[
                { v: "all", l: "全部" },
                { v: "critical", l: "极高" },
                { v: "high", l: "高" },
                { v: "medium", l: "中" },
                { v: "low", l: "低" },
              ].map((o) => (
                <button
                  key={o.v}
                  data-testid={`tier-${o.v}`}
                  onClick={() => setTierFilter(o.v)}
                  className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                    tierFilter === o.v
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <span className="text-[10.5px] text-muted-foreground ml-auto">
              {filtered.length} / {merchants.length} 商家
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {filtered.map((m) => {
              const tier = TIER_STYLE[m.riskTier] || TIER_STYLE.low;
              const cats = safeParseArr(m.topCategories);
              const fts = safeParseArr(m.topFailureTypes);
              return (
                <Link key={m.merchantId} href={`/merchants/${m.merchantId}`}>
                  <a
                    data-testid={`merchant-card-${m.merchantId}`}
                    className={`block bg-card border border-card-border rounded-lg p-4 hover:border-foreground/20 transition-colors ${tier.row}`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-mono">
                            {m.merchantId}
                          </span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded border uppercase tracking-wider ${tier.pill}`}
                          >
                            {tier.label}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-muted-foreground mt-1">
                          {REGION_LABEL[m.merchantRegion] || m.merchantRegion} ·{" "}
                          {m.ticketCount} 工单 · 升级 {m.escalatedCount} · 未解决{" "}
                          {m.unresolvedCount}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          流失分
                        </div>
                        <div className="text-[18px] font-semibold tabular-nums leading-none mt-0.5">
                          {(m.churnRiskScore ?? 0).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <p className="text-[12px] text-muted-foreground mt-3 leading-relaxed line-clamp-3">
                      {m.riskNarrative || "暂无 LLM 风险叙事"}
                    </p>

                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {cats.slice(0, 3).map((c: any, i: number) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          {c.category} ×{c.count}
                        </span>
                      ))}
                      {fts.slice(0, 2).map((f: any, i: number) => (
                        <span
                          key={`f${i}`}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground"
                        >
                          {FAILURE_LABEL[f.type] || f.type}
                        </span>
                      ))}
                    </div>
                  </a>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

const FAILURE_LABEL: Record<string, string> = {
  knowledge_gap: "知识缺口",
  routing_error: "路由错误",
  policy_limit: "政策限制",
  merchant_misunderstanding: "商家理解偏差",
  systemic_unsolvable: "系统性无解",
};

function safeParseArr(s: string | null | undefined): any[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "destructive" | "warning";
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
    </div>
  );
}
