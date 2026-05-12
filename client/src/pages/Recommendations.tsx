import { useQuery, useMutation } from "@tanstack/react-query";
import type { Recommendation } from "@shared/schema";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import {
  BookOpen,
  GitBranch,
  Scale,
  Check,
  X,
  Clock,
  ChevronRight,
  PlayCircle,
  TrendingDown,
  TrendingUp,
  Target,
  Sparkles,
} from "lucide-react";

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  knowledge_base: {
    label: "知识库",
    icon: BookOpen,
    color: "text-[hsl(var(--chart-1))] bg-[hsl(var(--chart-1))]/10 border-[hsl(var(--chart-1))]/30",
  },
  routing: {
    label: "路由策略",
    icon: GitBranch,
    color: "text-[hsl(var(--chart-4))] bg-[hsl(var(--chart-4))]/10 border-[hsl(var(--chart-4))]/30",
  },
  policy: {
    label: "政策",
    icon: Scale,
    color: "text-[hsl(var(--chart-5))] bg-[hsl(var(--chart-5))]/10 border-[hsl(var(--chart-5))]/30",
  },
};
const PRIORITY_STYLE: Record<string, string> = {
  high: "text-destructive border-destructive/40 bg-destructive/10",
  medium: "text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4))]/40 bg-[hsl(var(--chart-4))]/10",
  low: "text-muted-foreground border-border bg-muted",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "待评估",
  accepted: "已采纳",
  rejected: "已驳回",
  implemented: "已实施",
  in_progress: "实施中",
  done: "已完成",
  dismissed: "已驳回",
};

const METRIC_LABEL: Record<string, string> = {
  bad_case_rate: "坏单率",
  escalation_rate: "升级率",
  avg_csat: "平均满意度",
};

export default function Recommendations() {
  const { data: recs = [], isLoading } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
  });
  const [filter, setFilter] = useState<string>("all");

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest("PATCH", `/api/recommendations/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const filtered = filter === "all" ? recs : recs.filter((r) => r.status === filter);

  return (
    <AppLayout>
      <PageHeader
        title="优化建议"
        subtitle="LLM 基于商家↔平台失效工单生成的可执行优化项 · 面向跨境商家体验团队"
      />
      <div className="px-8 py-6 space-y-4">
        {/* 过滤 */}
        <div className="flex items-center gap-2">
          {[
            { v: "all", l: "全部" },
            { v: "pending", l: "待评估" },
            { v: "accepted", l: "已采纳" },
            { v: "in_progress", l: "实施中" },
            { v: "done", l: "已完成" },
            { v: "rejected", l: "已驳回" },
          ].map((o) => (
            <button
              key={o.v}
              data-testid={`filter-${o.v}`}
              onClick={() => setFilter(o.v)}
              className={`px-3 py-1.5 text-[12px] rounded-md border transition-colors ${
                filter === o.v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>

        {/* 卡片列表 */}
        <div className="grid grid-cols-2 gap-4">
          {isLoading ? (
            <div className="col-span-2 text-center text-muted-foreground py-12 text-[13px]">
              加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="col-span-2 text-center text-muted-foreground py-12 text-[13px]">
              当前筛选下没有建议
            </div>
          ) : (
            filtered.map((r) => {
              const meta = TYPE_META[r.type] || TYPE_META.knowledge_base;
              const Icon = meta.icon;
              const evidenceIds: number[] = safeParse(r.evidenceConversationIds);
              return (
                <div
                  key={r.id}
                  data-testid={`rec-card-${r.id}`}
                  className="bg-card border border-card-border rounded-lg p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-7 h-7 rounded-md border flex items-center justify-center ${meta.color}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider">
                          {meta.label}
                        </div>
                        <div className="text-[13.5px] font-medium leading-tight mt-0.5">
                          {r.title}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded border uppercase tracking-wider ${
                        PRIORITY_STYLE[r.priority]
                      }`}
                    >
                      {r.priority === "high" ? "高" : r.priority === "medium" ? "中" : "低"}优先级
                    </span>
                  </div>

                  <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                    {r.description}
                  </p>

                  <div className="grid grid-cols-2 gap-3 py-2 border-t border-border/60 mt-1">
                    <Stat label="影响工单">
                      <span className="text-[14px] font-semibold tabular-nums">
                        {r.affectedCount}
                      </span>{" "}
                      <span className="text-[10.5px] text-muted-foreground">通</span>
                    </Stat>
                    <Stat label="失效模式">
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {r.failurePattern}
                      </span>
                    </Stat>
                  </div>

                  <div className="text-[10.5px] text-muted-foreground">
                    证据工单:{" "}
                    <span className="font-mono">
                      {evidenceIds.slice(0, 5).join(", ")}
                      {evidenceIds.length > 5 ? "…" : ""}
                    </span>
                  </div>

                  {/* 闭环目标 · 只在实施后或 accepted 后可见 */}
                  {(r.targetCategory || r.targetFailureType) && (
                    <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] text-muted-foreground">
                      <Target className="w-3 h-3" />
                      <span>闭环目标:</span>
                      <span className="font-medium text-foreground">
                        {METRIC_LABEL[r.targetMetric || "bad_case_rate"] || r.targetMetric}
                      </span>
                      {r.targetCategory && (
                        <span className="px-1.5 py-0.5 rounded bg-muted">
                          {r.targetCategory}
                        </span>
                      )}
                      {r.targetFailureType && (
                        <span className="px-1.5 py-0.5 rounded border border-dashed border-border">
                          {r.targetFailureType}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 实施后 · 拉取效果对比 */}
                  {(r.status === "in_progress" ||
                    r.status === "done" ||
                    r.status === "implemented") &&
                    r.implementedAt && <EffectPanel id={r.id} />}

                  <div className="flex items-center justify-between pt-3 border-t border-border/60 mt-auto">
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {STATUS_LABEL[r.status] || r.status}
                      {r.implementedAt && (
                        <span className="ml-1">
                          · 实施于 {formatDate(r.implementedAt)}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.status === "pending" ? (
                        <>
                          <ActionBtn
                            testid={`reject-${r.id}`}
                            icon={X}
                            onClick={() =>
                              updateStatus.mutate({ id: r.id, status: "rejected" })
                            }
                          >
                            驳回
                          </ActionBtn>
                          <ActionBtn
                            testid={`accept-${r.id}`}
                            icon={Check}
                            primary
                            onClick={() =>
                              updateStatus.mutate({ id: r.id, status: "accepted" })
                            }
                          >
                            采纳
                          </ActionBtn>
                        </>
                      ) : r.status === "accepted" ? (
                        <ActionBtn
                          testid={`implement-${r.id}`}
                          icon={PlayCircle}
                          primary
                          onClick={() =>
                            updateStatus.mutate({ id: r.id, status: "in_progress" })
                          }
                        >
                          启动实施 · 记基线
                        </ActionBtn>
                      ) : r.status === "in_progress" ? (
                        <ActionBtn
                          testid={`done-${r.id}`}
                          icon={Check}
                          primary
                          onClick={() =>
                            updateStatus.mutate({ id: r.id, status: "done" })
                          }
                        >
                          完成验收
                        </ActionBtn>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ActionBtn({
  children,
  icon: Icon,
  onClick,
  primary,
  testid,
}: {
  children: React.ReactNode;
  icon: any;
  onClick: () => void;
  primary?: boolean;
  testid: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`flex items-center gap-1 px-2.5 py-1 text-[11.5px] rounded border transition-colors ${
        primary
          ? "bg-primary text-primary-foreground border-primary hover:opacity-90"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className="w-3 h-3" />
      {children}
    </button>
  );
}

function safeParse(s: string): any[] {
  try {
    return JSON.parse(s);
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

interface EffectResp {
  ready: boolean;
  message?: string;
  metric?: string;
  baseline?: number;
  currentValue?: number;
  delta?: number;
  deltaPct?: number | null;
  isImprovement?: boolean;
  sampleCountPost?: number;
  windowDays?: number;
  elapsedDays?: number;
}

function EffectPanel({ id }: { id: number }) {
  const { data, isLoading } = useQuery<EffectResp>({
    queryKey: [`/api/recommendations/${id}/effect`],
  });
  if (isLoading) {
    return (
      <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-[11px] text-muted-foreground">
        拉取效果指标…
      </div>
    );
  }
  if (!data) return null;
  if (!data.ready) {
    return (
      <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-[11px] text-muted-foreground">
        {data.message || "尚未准备好效果计算。"}
      </div>
    );
  }

  const metric = data.metric || "bad_case_rate";
  const metricLabel = METRIC_LABEL[metric] || metric;
  const isPercent = metric !== "avg_csat";
  const fmt = (v?: number) =>
    v == null
      ? "—"
      : isPercent
      ? `${(v * 100).toFixed(1)}%`
      : v.toFixed(2);

  const Trend = data.isImprovement ? TrendingDown : TrendingUp;
  const tone = data.isImprovement
    ? "text-[hsl(var(--chart-2))]"
    : "text-destructive";
  const tint = data.isImprovement
    ? "bg-[hsl(var(--chart-2))]/10 border-[hsl(var(--chart-2))]/40"
    : "bg-destructive/10 border-destructive/40";

  return (
    <div className={`rounded-md border ${tint} px-3 py-2.5 space-y-1.5`}>
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground uppercase tracking-wider">
          <Sparkles className="w-3 h-3" />
          闭环效果 · {metricLabel}
        </div>
        <span className="text-[10px] text-muted-foreground">
          近 {data.elapsedDays ?? 0} 天 · 样本 {data.sampleCountPost ?? 0}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[12.5px]">
        <div>
          <span className="text-muted-foreground">基线 </span>
          <span className="font-semibold tabular-nums">{fmt(data.baseline)}</span>
        </div>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
        <div>
          <span className="text-muted-foreground">现在 </span>
          <span className="font-semibold tabular-nums">{fmt(data.currentValue)}</span>
        </div>
        <div className={`ml-auto inline-flex items-center gap-1 font-semibold tabular-nums ${tone}`}>
          <Trend className="w-3.5 h-3.5" />
          {data.delta != null && (data.delta > 0 ? "+" : "")}
          {fmt(data.delta)}
          {data.deltaPct != null && (
            <span className="text-[11px]">
              ({data.deltaPct > 0 ? "+" : ""}{data.deltaPct}%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
