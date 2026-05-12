import { useState, useMemo, useRef, useEffect } from "react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { API_BASE } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Download,
  Copy,
  Sparkles,
  FileText,
  BarChart3,
  AlertTriangle,
  Check,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

type CategoryBadCase = {
  category: string;
  total: number;
  bad: number;
  escalated: number;
  badRate: number;
};
type RootCauseShare = { type: string; count: number; share: number };
type LanguageMix = { lang: string; count: number; share: number };

type ReportResponse = {
  markdown: string;
  meta: { from: string; to: string; count: number; prevCount: number };
  aggregates: {
    categoryBadCase: CategoryBadCase[];
    rootCauseShare: RootCauseShare[];
    languageMix: LanguageMix[];
  };
};

const FAILURE_LABEL: Record<string, string> = {
  knowledge_gap: "知识缺失",
  routing_error: "路由错误",
  policy_limit: "政策限制",
  merchant_misunderstanding: "商家预期偏差",
  systemic_unsolvable: "系统不可解",
};

const LANG_LABEL: Record<string, string> = { zh: "中文", en: "英文" };

// 与全站调色一致 — 主色 + 数据可视化拓展色
const CHART_COLORS = ["#20808D", "#A84B2F", "#1B474D", "#BCE2E7", "#944454", "#FFC553", "#848456", "#6E522B"];

const PRESETS = [
  { label: "近 7 天", days: 7 },
  { label: "近 14 天", days: 14 },
  { label: "近 30 天", days: 30 },
];

function toLocalDateInput(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type ProgressStage = { stage: string; pct: number; done: boolean };

export default function Report() {
  const { toast } = useToast();
  const now = useMemo(() => new Date("2026-05-11T20:00:00+08:00"), []);
  const [from, setFrom] = useState(() => toLocalDateInput(new Date(now.getTime() - 7 * 86400_000)));
  const [to, setTo] = useState(() => toLocalDateInput(now));
  const [triggered, setTriggered] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [progress, setProgress] = useState<ProgressStage[]>([]);
  const [pct, setPct] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async () => {
    if (isFetching) return;
    setTriggered(true);
    setData(null);
    setProgress([]);
    setPct(0);
    setErrMsg(null);
    setIsFetching(true);

    const fromIso = new Date(from + "T00:00:00").toISOString();
    const toIso = new Date(to + "T23:59:59").toISOString();
    const url = `${API_BASE}/api/report/stream?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.body) throw new Error("无 SSE 响应体");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = raw.split("\n");
          let event = "message";
          let dataStr = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) event = ln.slice(6).trim();
            else if (ln.startsWith("data:")) dataStr += ln.slice(5).trim();
          }
          handleSSE(event, dataStr);
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setErrMsg(e.message || "生成失败");
        setIsFetching(false);
      }
    }
  };

  function handleSSE(event: string, dataStr: string) {
    let payload: any;
    try {
      payload = JSON.parse(dataStr);
    } catch {
      return;
    }
    if (event === "progress") {
      setProgress((arr) => {
        // mark previous stages done
        const marked = arr.map((s) => ({ ...s, done: true }));
        return [...marked, { stage: payload.stage, pct: payload.pct, done: false }];
      });
      setPct(payload.pct);
    } else if (event === "done") {
      setProgress((arr) => arr.map((s) => ({ ...s, done: true })));
      setPct(100);
      setData({
        markdown: payload.markdown,
        meta: payload.meta,
        aggregates: payload.aggregates,
      });
      setIsFetching(false);
    } else if (event === "error") {
      setErrMsg(payload.message || "生成失败");
      setIsFetching(false);
    }
  }

  const applyPreset = (days: number) => {
    const end = now;
    const start = new Date(end.getTime() - days * 86400_000);
    setFrom(toLocalDateInput(start));
    setTo(toLocalDateInput(end));
  };

  const download = () => {
    if (!data?.markdown) return;
    const blob = new Blob([data.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `跨境电商商家工单分析周报_${from}_${to}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "已导出 Markdown", description: a.download });
  };

  const copy = async () => {
    if (!data?.markdown) return;
    try {
      await navigator.clipboard.writeText(data.markdown);
      toast({ title: "已复制到剪贴板" });
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <PageHeader
        title="分析周报"
        subtitle="跨境电商商家↔平台工单 · 系统性总结 + 可视化 + 商家原声"
      />
      <div className="px-8 py-6 grid grid-cols-[320px_1fr] gap-6">
        {/* 左侧:筛选 + 操作 */}
        <aside className="space-y-4">
          <div className="bg-card border border-card-border rounded-lg p-5">
            <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
              时间范围
            </div>
            <div className="space-y-2.5">
              <div>
                <label className="text-[11px] text-muted-foreground">起始日期</label>
                <div className="relative mt-1">
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    data-testid="input-from"
                    className="w-full bg-background border border-input rounded-md pl-8 pr-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">结束日期</label>
                <div className="relative mt-1">
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    data-testid="input-to"
                    className="w-full bg-background border border-input rounded-md pl-8 pr-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-[11px] text-muted-foreground mb-2">快速选择</div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.days}
                    data-testid={`preset-${p.days}`}
                    onClick={() => applyPreset(p.days)}
                    className="px-2.5 py-1 text-[11.5px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              data-testid="button-generate"
              onClick={generate}
              disabled={isFetching}
              className="mt-4 w-full flex items-center justify-center gap-1.5 px-3.5 py-2 text-[12.5px] rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {isFetching ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                  生成中…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  生成周报
                </>
              )}
            </button>
          </div>

          {data && (
            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
                本次报告
              </div>
              <Row label="周期">
                <span className="text-[11.5px] font-mono">
                  {data.meta.from.slice(0, 10)} ~ {data.meta.to.slice(0, 10)}
                </span>
              </Row>
              <Row label="样本量">
                <span className="text-[11.5px] tabular-nums">{data.meta.count} 通</span>
              </Row>
              <Row label="环比基线">
                <span className="text-[11.5px] tabular-nums text-muted-foreground">
                  {data.meta.prevCount} 通
                </span>
              </Row>

              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <button
                  data-testid="button-download"
                  onClick={download}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出 Markdown
                </button>
                <button
                  data-testid="button-copy"
                  onClick={copy}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  复制为 Markdown
                </button>
              </div>
            </div>
          )}

          <div className="bg-card border border-card-border rounded-lg p-5">
            <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
              报告结构
            </div>
            <ol className="space-y-1.5 text-[12px] text-muted-foreground list-decimal list-inside">
              <li>系统性总结 Executive Snapshot</li>
              <li>本周整体概览 Summary</li>
              <li>Top 系统性问题</li>
              <li>失败模式归类</li>
              <li>根因分析</li>
              <li>可执行优化建议 P0/P1/P2</li>
              <li>代表性对话(完整原声 + 双语)</li>
            </ol>
          </div>
        </aside>

        {/* 右侧:报告预览 */}
        <div className="bg-card border border-card-border rounded-lg min-h-[600px]">
          {!triggered ? (
            <EmptyState />
          ) : isFetching && !data ? (
            <StreamingProgress progress={progress} pct={pct} errMsg={errMsg} />
          ) : data ? (
            <ReportPreview data={data} />
          ) : errMsg ? (
            <ErrorState message={errMsg} onRetry={generate} />
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-b-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[600px] flex flex-col items-center justify-center text-center px-8 py-12">
      <div className="w-12 h-12 rounded-lg bg-muted border border-border flex items-center justify-center mb-4">
        <FileText className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="text-[14px] font-medium">尚未生成报告</div>
      <div className="text-[12px] text-muted-foreground mt-1.5 max-w-xs">
        选定时间范围后点击「生成周报」。系统会自动归类失败模式、聚类根因、按场景显示 bad case 率,并附上商家原声。
      </div>
    </div>
  );
}

function StreamingProgress({
  progress,
  pct,
  errMsg,
}: {
  progress: ProgressStage[];
  pct: number;
  errMsg: string | null;
}) {
  return (
    <div className="h-full min-h-[600px] flex flex-col items-center justify-center px-8 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" />
          <div className="text-[13.5px] font-medium">LLM 生成中…</div>
          <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ol className="mt-5 space-y-2">
          {progress.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-2.5 text-[12.5px] animate-in fade-in slide-in-from-left-1 duration-300"
            >
              {s.done ? (
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
              )}
              <span className={s.done ? "text-foreground/80" : "text-foreground font-medium"}>
                {s.stage}
              </span>
            </li>
          ))}
        </ol>
        {errMsg && (
          <div className="mt-4 text-[12px] text-[#A12C7B]">错误: {errMsg}</div>
        )}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-full min-h-[600px] flex flex-col items-center justify-center text-center px-8 py-12">
      <div className="w-12 h-12 rounded-lg bg-[#A12C7B]/10 border border-[#A12C7B]/30 flex items-center justify-center mb-4">
        <AlertTriangle className="w-5 h-5 text-[#A12C7B]" />
      </div>
      <div className="text-[14px] font-medium">生成失败</div>
      <div className="text-[12px] text-muted-foreground mt-1.5 max-w-md">{message}</div>
      <button
        onClick={onRetry}
        className="mt-4 px-3.5 py-1.5 text-[12px] rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
      >
        重试
      </button>
    </div>
  );
}

function ReportPreview({ data }: { data: ReportResponse }) {
  return (
    <div className="p-8 max-w-4xl mx-auto animate-in fade-in duration-500">
      <ChartPanel aggregates={data.aggregates} count={data.meta.count} />
      <article className="prose-report" data-testid="report-content">
        {renderMarkdownStaggered(data.markdown)}
      </article>
    </div>
  );
}

// ============================
// 图表面板
// ============================
function ChartPanel({
  aggregates,
  count,
}: {
  aggregates: ReportResponse["aggregates"];
  count: number;
}) {
  const { categoryBadCase, rootCauseShare, languageMix } = aggregates;
  return (
    <section className="mb-8 space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary" />
        <h2 className="text-[15px] font-semibold tracking-tight">可视化分析</h2>
        <span className="text-[11px] text-muted-foreground ml-1">{count} 通工单</span>
      </div>

      {/* 场景 Bad Case 率柱图 */}
      <div className="bg-background/50 border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 text-[#A84B2F]" />
          <div className="text-[13px] font-medium">各业务场景 Bad Case 率</div>
        </div>
        <div className="text-[11px] text-muted-foreground mb-3">
          Bad Case = 未解决 + 转人工 + 流失。颜色深浅与失效严重度正相关
        </div>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryBadCase} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="category"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                interval={0}
                angle={-18}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `${v}%`}
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
                formatter={(value: any, name: string, props: any) => {
                  if (name === "badRate") {
                    return [`${value}% (${props.payload.bad}/${props.payload.total})`, "Bad Case 率"];
                  }
                  return [value, name];
                }}
              />
              <Bar dataKey="badRate" radius={[4, 4, 0, 0]}>
                {categoryBadCase.map((row, i) => {
                  const color =
                    row.badRate >= 70 ? "#A84B2F" : row.badRate >= 50 ? "#FFC553" : "#20808D";
                  return <Cell key={i} fill={color} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-4 mt-2 text-[10.5px] text-muted-foreground">
          <Legend2 color="#20808D" text="健康 < 50%" />
          <Legend2 color="#FFC553" text="关注 50-70%" />
          <Legend2 color="#A84B2F" text="告警 ≥ 70%" />
        </div>
      </div>

      {/* 根因占比 + 语言占比 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-background/50 border border-border rounded-lg p-4">
          <div className="text-[13px] font-medium mb-1">根因占比</div>
          <div className="text-[11px] text-muted-foreground mb-3">五维度失败归因分布</div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rootCauseShare.map((r) => ({
                    name: FAILURE_LABEL[r.type] || r.type,
                    value: r.count,
                    share: r.share,
                  }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {rootCauseShare.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                  }}
                  formatter={(value: any, name: any, props: any) => [
                    `${value} 通 (${props.payload.share}%)`,
                    name,
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  iconSize={8}
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-background/50 border border-border rounded-lg p-4">
          <div className="text-[13px] font-medium mb-1">语言分布</div>
          <div className="text-[11px] text-muted-foreground mb-3">
            英文工单需直转双语人工承接
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={languageMix.map((l) => ({
                    name: LANG_LABEL[l.lang] || l.lang.toUpperCase(),
                    value: l.count,
                    share: l.share,
                  }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {languageMix.map((l, i) => (
                    <Cell key={i} fill={l.lang === "en" ? "#A84B2F" : "#20808D"} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                  }}
                  formatter={(value: any, name: any, props: any) => [
                    `${value} 通 (${props.payload.share}%)`,
                    name,
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  iconSize={8}
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

function Legend2({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span>{text}</span>
    </div>
  );
}

// ============================
// 分段 fade-in 渲染:按 ## 二级标题分段,每段递增 stagger 动画
// ============================
function renderMarkdownStaggered(md: string): React.ReactNode {
  // 切分: 顶部 H1 单独一段,之后按 ## 分段
  const lines = md.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const ln of lines) {
    if (ln.startsWith("## ") && current.length > 0) {
      sections.push(current.join("\n"));
      current = [ln];
    } else {
      current.push(ln);
    }
  }
  if (current.length > 0) sections.push(current.join("\n"));

  return sections.map((sec, i) => (
    <div
      key={i}
      className="animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
      style={{ animationDelay: `${i * 90}ms` }}
    >
      {renderMarkdown(sec)}
    </div>
  ));
}

// ============================
// 轻量 Markdown 渲染
// 支持 # / ## / ### / #### / 列表(- )/ 表格 / **bold** / *italic* / --- / > 引用
// ============================
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let rest = text;
    let k = 0;
    while (rest.length > 0) {
      // **bold**
      const boldMatch = rest.match(/\*\*([^*]+)\*\*/);
      // *italic*
      const italicMatch = rest.match(/\*([^*]+)\*/);
      // `code`
      const codeMatch = rest.match(/`([^`]+)`/);
      const candidates = [boldMatch, italicMatch, codeMatch]
        .map((m, idx) => ({ m, idx }))
        .filter((x) => x.m && x.m.index !== undefined) as Array<{ m: RegExpMatchArray; idx: number }>;
      if (candidates.length === 0) {
        parts.push(rest);
        break;
      }
      candidates.sort((a, b) => (a.m.index! - b.m.index!));
      const first = candidates[0];
      const idx = first.m.index!;
      if (idx > 0) parts.push(rest.slice(0, idx));
      if (first.idx === 0) {
        parts.push(
          <strong key={k++} className="font-semibold text-foreground">
            {first.m[1]}
          </strong>
        );
      } else if (first.idx === 1) {
        parts.push(
          <em key={k++} className="text-muted-foreground italic">
            {first.m[1]}
          </em>
        );
      } else {
        parts.push(
          <code
            key={k++}
            className="px-1 py-0.5 rounded bg-muted text-[12px] font-mono text-foreground"
          >
            {first.m[1]}
          </code>
        );
      }
      rest = rest.slice(idx + first.m[0].length);
    }
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];
    // 表格
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[\s\-:|]+\|$/)) {
      const headerCells = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i += 1;
      }
      out.push(
        <div key={key++} className="my-4 overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                {headerCells.map((c, j) => (
                  <th
                    key={j}
                    className="text-left px-3 py-2 font-medium text-muted-foreground text-[11px] uppercase tracking-wider"
                  >
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-b-0">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top text-foreground">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 引用块 > 
    if (line.startsWith("> ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(
        <blockquote
          key={key++}
          className="my-2 pl-3 border-l-2 border-primary/60 bg-primary/5 py-2 pr-3 rounded-r"
        >
          {items.map((it, idx) => (
            <div key={idx} className="text-[12.5px] leading-relaxed text-foreground">
              {inline(it)}
            </div>
          ))}
        </blockquote>
      );
      continue;
    }

    if (line.startsWith("#### ")) {
      out.push(
        <h4
          key={key++}
          className="text-[13px] font-medium mt-4 mb-1.5 text-foreground/90"
        >
          {inline(line.slice(5))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(
        <h3 key={key++} className="text-[14px] font-medium mt-4 mb-2 text-foreground">
          {inline(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(
        <h2
          key={key++}
          className="text-[16px] font-semibold tracking-tight mt-6 mb-2 text-foreground"
        >
          {inline(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(
        <h1
          key={key++}
          className="text-[22px] font-semibold tracking-tight mt-6 first:mt-0 mb-3 text-foreground"
        >
          {inline(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }
    if (line.trim() === "---") {
      out.push(<hr key={key++} className="my-5 border-border" />);
      i++;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(
        <ul
          key={key++}
          className="my-2 space-y-1 list-disc list-outside pl-5 text-[13px] leading-relaxed text-foreground"
        >
          {items.map((it, idx) => (
            <li key={idx}>{inline(it)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    out.push(
      <p key={key++} className="my-2 text-[13px] leading-relaxed text-foreground">
        {inline(line)}
      </p>
    );
    i++;
  }
  return out;
}
