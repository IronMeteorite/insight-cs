import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useMemo } from "react";
import type { Conversation } from "@shared/schema";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

const FAILURE_LABEL: Record<string, string> = {
  knowledge_gap: "知识库缺失",
  routing_error: "路由错误",
  policy_limit: "政策限制",
  systemic_unsolvable: "系统性不可解",
  merchant_misunderstanding: "商家预期偏差",
};

function KpiCard({
  label,
  value,
  delta,
  hint,
  testid,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  testid?: string;
}) {
  const positive = delta !== undefined && delta > 0;
  const negative = delta !== undefined && delta < 0;
  return (
    <div className="bg-card border border-card-border rounded-lg p-5" data-testid={testid}>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <div className="text-[28px] font-semibold tracking-tight leading-none font-sans tabular-nums">
          {value}
        </div>
        {delta !== undefined && (
          <div
            className={`flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
              positive
                ? "text-[hsl(var(--chart-1))]"
                : negative
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {positive ? (
              <ArrowUpRight className="w-3 h-3" />
            ) : negative ? (
              <ArrowDownRight className="w-3 h-3" />
            ) : (
              <Minus className="w-3 h-3" />
            )}
            {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-2">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data: convs = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });

  const stats = useMemo(() => {
    const total = convs.length;
    const resolved = convs.filter((c) => c.resolutionStatus === "resolved").length;
    const unresolved = total - resolved;
    const resolutionRate = total ? (resolved / total) * 100 : 0;
    const avgSatisfaction =
      total === 0
        ? 0
        : convs.reduce((s, c) => s + (c.satisfactionScore || 0), 0) / total;
    const avgDuration =
      total === 0 ? 0 : convs.reduce((s, c) => s + c.durationSec, 0) / total / 60;

    // 按类别失效分布
    const byCategory: Record<string, { total: number; failed: number }> = {};
    for (const c of convs) {
      byCategory[c.category] = byCategory[c.category] || { total: 0, failed: 0 };
      byCategory[c.category].total += 1;
      if (c.resolutionStatus !== "resolved") byCategory[c.category].failed += 1;
    }
    const categoryData = Object.entries(byCategory).map(([k, v]) => ({
      category: k,
      已解决: v.total - v.failed,
      未解决: v.failed,
    }));

    // 失效类型分布
    const failureCounts: Record<string, number> = {};
    for (const c of convs) {
      if (c.failureType) failureCounts[c.failureType] = (failureCounts[c.failureType] || 0) + 1;
    }
    const failureData = Object.entries(failureCounts).map(([k, v]) => ({
      name: FAILURE_LABEL[k] || k,
      value: v,
    }));

    // 7 天趋势
    const days: Record<string, { date: string; resolved: number; failed: number }> = {};
    for (const c of convs) {
      const d = c.startedAt.slice(5, 10);
      days[d] = days[d] || { date: d, resolved: 0, failed: 0 };
      if (c.resolutionStatus === "resolved") days[d].resolved += 1;
      else days[d].failed += 1;
    }
    const trendData = Object.values(days)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);

    // 平均情绪轨迹
    const avgTraj: number[] = [];
    const traj = convs
      .map((c) => {
        try {
          return JSON.parse(c.emotionTrajectory) as { turn: number; score: number }[];
        } catch {
          return [];
        }
      })
      .filter((t) => t.length > 0);
    const maxT = 10;
    for (let i = 0; i < maxT; i++) {
      const vals = traj.map((t) => t[i]?.score).filter((s) => typeof s === "number");
      avgTraj.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN);
    }
    const emotionData = avgTraj
      .map((s, i) => ({ turn: `T${i + 1}`, 情绪指数: isNaN(s) ? null : +s.toFixed(3) }))
      .filter((d) => d.情绪指数 !== null);

    const enCount = convs.filter((c) => c.language === "en").length;
    const enRatio = total ? (enCount / total) * 100 : 0;

    return {
      total,
      resolved,
      unresolved,
      resolutionRate,
      avgSatisfaction,
      avgDuration,
      enRatio,
      categoryData,
      failureData,
      trendData,
      emotionData,
    };
  }, [convs]);

  return (
    <AppLayout>
      <PageHeader
        title="跨境电商商家工单总览"
        subtitle="过去 14 天 · 商家↔平台 LLM 理解 · 场景 bad case 与优化指引"
      />
      <div className="px-8 py-6 space-y-6">
        {/* KPI 行 */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="工单总量"
            value={isLoading ? "—" : stats.total.toLocaleString()}
            delta={8.2}
            hint="近 14 天累计"
            testid="kpi-total"
          />
          <KpiCard
            label="一次性解决率"
            value={isLoading ? "—" : `${stats.resolutionRate.toFixed(1)}%`}
            delta={-3.4}
            hint={`未解决 ${stats.unresolved} 通`}
            testid="kpi-resolution"
          />
          <KpiCard
            label="商家 CSAT"
            value={isLoading ? "—" : stats.avgSatisfaction.toFixed(2)}
            delta={-1.8}
            hint="5 分制"
            testid="kpi-satisfaction"
          />
          <KpiCard
            label="英文工单占比"
            value={isLoading ? "—" : `${stats.enRatio.toFixed(1)}%`}
            delta={undefined}
            hint="需翻译介入"
            testid="kpi-en-ratio"
          />
        </div>

        {/* 图表 2x2 */}
        <div className="grid grid-cols-2 gap-4">
          <ChartCard title="按类别 · 已解决 vs 未解决" subtitle="找出系统性失效集中区域">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.categoryData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="category" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="已解决" stackId="a" fill="hsl(var(--chart-1))" radius={[0, 0, 0, 0]} />
                <Bar dataKey="未解决" stackId="a" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="失效归因分布" subtitle="LLM 对未解决工单的根因分类">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={stats.failureData}
                  cx="42%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={88}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {stats.failureData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={`hsl(var(--chart-${(i % 5) + 1}))`}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  wrapperStyle={{ fontSize: 11, paddingLeft: 16 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="每日工单态势" subtitle="近 7 天解决/失效分布">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="resolved" name="已解决" fill="hsl(var(--chart-1))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="failed" name="未解决" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="情绪演化曲线"
            subtitle="平均情绪指数随对话轮次变化（1 = 满意、0.5 = 中性、0 = 愤怒）"
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={stats.emotionData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="turn" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={[0, 1]}
                  ticks={[0, 0.25, 0.5, 0.75, 1]}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="情绪指数"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "hsl(var(--chart-1))", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* 入口 */}
        <div className="bg-card border border-card-border rounded-lg p-5 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">深入分析具体工单</div>
            <div className="text-[12px] text-muted-foreground mt-1">
              查看 LLM 的诉求识别、情绪轨迹、双语原文与失效归因
            </div>
          </div>
          <Link
            href="/conversations"
            data-testid="link-go-conversations"
            className="px-3.5 py-1.5 text-[12px] rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            打开工单列表 →
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-5">
      <div className="mb-4">
        <div className="text-[13px] font-medium">{title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground mt-1">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
