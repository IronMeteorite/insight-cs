import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import type { Conversation } from "@shared/schema";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Search, ArrowUpDown } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  resolved: "bg-[hsl(var(--chart-1))]/15 text-[hsl(var(--chart-1))] border-[hsl(var(--chart-1))]/30",
  unresolved: "bg-[hsl(var(--chart-2))]/15 text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2))]/30",
  escalated: "bg-[hsl(var(--chart-4))]/15 text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4))]/30",
  abandoned: "bg-destructive/15 text-destructive border-destructive/30",
};
const STATUS_LABEL: Record<string, string> = {
  resolved: "已解决",
  unresolved: "未解决",
  escalated: "已升级",
  abandoned: "商家放弃",
};
const FAILURE_LABEL: Record<string, string> = {
  knowledge_gap: "知识库缺失",
  routing_error: "路由错误",
  policy_limit: "政策限制",
  systemic_unsolvable: "系统性不可解",
  merchant_misunderstanding: "商家预期偏差",
};
const REGION_LABEL: Record<string, string> = {
  CN: "🇨🇳 中国",
  US: "🇺🇸 美国",
  EU: "🇪🇺 欧洲",
  SEA: "🌏 东南亚",
  LATAM: "🌎 拉美",
  MEA: "🌍 中东非洲",
};

const EMOTION_COLORS: Record<string, string> = {
  满意: "text-[hsl(var(--chart-1))]",
  中性: "text-muted-foreground",
  焦虑: "text-[hsl(var(--chart-4))]",
  失望: "text-[hsl(var(--chart-2))]",
  愤怒: "text-destructive",
};

export default function Conversations() {
  const { data: convs = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [failureFilter, setFailureFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return convs.filter((c) => {
      if (statusFilter !== "all" && c.resolutionStatus !== statusFilter) return false;
      if (failureFilter !== "all" && c.failureType !== failureFilter) return false;
      if (q) {
        const s = q.toLowerCase();
        const match =
          c.externalId.toLowerCase().includes(s) ||
          c.primaryIntent.toLowerCase().includes(s) ||
          c.category.toLowerCase().includes(s) ||
          (c.failureReason || "").toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [convs, q, statusFilter, failureFilter]);

  return (
    <AppLayout>
      <PageHeader
        title="商家工单分析"
        subtitle={`${filtered.length} / ${convs.length} 通工单 · 点击查看 LLM 详细归因`}
      />
      <div className="px-8 py-6 space-y-4">
        {/* 筛选条 */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              data-testid="input-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索 ID / 意图 / 失效原因…"
              className="w-full bg-card border border-input rounded-md pl-9 pr-3 py-1.5 text-[12px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <FilterPill
            label="状态"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "全部状态" },
              { value: "resolved", label: "已解决" },
              { value: "unresolved", label: "未解决" },
              { value: "escalated", label: "已升级" },
              { value: "abandoned", label: "商家放弃" },
            ]}
          />
          <FilterPill
            label="失效类型"
            value={failureFilter}
            onChange={setFailureFilter}
            options={[
              { value: "all", label: "全部失效" },
              { value: "knowledge_gap", label: "知识库缺失" },
              { value: "routing_error", label: "路由错误" },
              { value: "policy_limit", label: "政策限制" },
              { value: "systemic_unsolvable", label: "系统性不可解" },
              { value: "merchant_misunderstanding", label: "商家预期偏差" },
            ]}
          />
        </div>

        {/* 表格 */}
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/40 border-b border-border">
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">
                  <span className="inline-flex items-center gap-1">
                    ID <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="px-4 py-2.5 font-medium">场景</th>
                <th className="px-4 py-2.5 font-medium">主要诉求</th>
                <th className="px-4 py-2.5 font-medium">区域 / 语言</th>
                <th className="px-4 py-2.5 font-medium">情绪</th>
                <th className="px-4 py-2.5 font-medium text-right">轮次</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">失效归因</th>
                <th className="px-4 py-2.5 font-medium text-right">满意度</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    加载中…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    没有符合条件的工单
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 100).map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      <Link
                        href={`/conversations/${c.id}`}
                        data-testid={`link-conv-${c.id}`}
                        className="text-foreground hover:text-primary"
                      >
                        {c.externalId}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{c.category}</td>
                    <td className="px-4 py-3 max-w-[180px] truncate">{c.primaryIntent}</td>
                    <td className="px-4 py-3 text-[11.5px] text-muted-foreground">
                      <div>{REGION_LABEL[c.merchantRegion] || c.merchantRegion || "—"}</div>
                      <div className="text-[10.5px]">
                        {c.language === "en" ? "EN · 英文" : "ZH · 中文"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={EMOTION_COLORS[c.emotionStart] || ""}>{c.emotionStart}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className={EMOTION_COLORS[c.emotionEnd] || ""}>{c.emotionEnd}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {c.turns}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 text-[10.5px] rounded border ${
                          STATUS_STYLE[c.resolutionStatus]
                        }`}
                      >
                        {STATUS_LABEL[c.resolutionStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.failureType ? FAILURE_LABEL[c.failureType] || c.failureType : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.satisfactionScore?.toFixed(1) ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div className="px-4 py-3 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
              显示前 100 条 · 共 {filtered.length} 条匹配
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function FilterPill({
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-card border border-input rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
