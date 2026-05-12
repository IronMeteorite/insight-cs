import { useState, useRef, useEffect } from "react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { API_BASE } from "@/lib/queryClient";
import {
  Sparkles,
  AlertTriangle,
  ArrowRight,
  Play,
  Loader2,
  Flame,
  ShieldAlert,
  MessageCircle,
  CheckCircle2,
  Send,
  User,
  Bot,
  Headset,
} from "lucide-react";

// ============ 演示场景 ============
type ScenarioTurn = { role: "merchant" | "bot" | "human"; content: string };
type Scenario = {
  id: string;
  title: string;
  summary: string;
  tag: string;
  turns: ScenarioTurn[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "logistics-delay",
    title: "物流时效投诉",
    tag: "中度焦虑",
    summary: "头程清关延误 12 天,商家担心错过促销窗口",
    turns: [
      {
        role: "merchant",
        content: "我的货 11 月 1 号就发出去了,到现在还在清关,这都 12 天了!",
      },
      {
        role: "bot",
        content:
          "您好,跨境头程通常需要 7-14 个工作日,请耐心等待。",
      },
      {
        role: "merchant",
        content:
          "我赶不上 11.11 大促了!这批货砸我手里了,平台能不能给个补偿?",
      },
      {
        role: "bot",
        content:
          "您可以在卖家中心提交申诉,客服会在 48 小时内回复。",
      },
      {
        role: "merchant",
        content:
          "48 小时?活动都结束了!你们到底有没有人能解决问题?",
      },
    ],
  },
  {
    id: "ads-frozen",
    title: "广告账户冻结",
    tag: "高升级风险",
    summary: "充值 $500 显示余额为 0,投诉三次未果",
    turns: [
      {
        role: "merchant",
        content:
          "My ads balance shows $0 but I topped up $500 yesterday. Campaigns are paused.",
      },
      {
        role: "bot",
        content: "Funds typically reflect within 2 hours. Please be patient.",
      },
      {
        role: "merchant",
        content:
          "It's been 18 hours. Order ID PAY-99213. This is the third escalation.",
      },
      {
        role: "bot",
        content:
          "Please contact finance@platform.com for further assistance.",
      },
      {
        role: "merchant",
        content:
          "I'm losing peak-season traffic. If this isn't resolved today I'll dispute via my bank and post on Twitter.",
      },
    ],
  },
  {
    id: "happy-onboarding",
    title: "招商入驻顺利收尾",
    tag: "满意基线",
    summary: "新商家完成资质审核,对客服服务表示感谢",
    turns: [
      {
        role: "merchant",
        content: "你好,我提交的入驻资质已经审核通过了,谢谢!",
      },
      {
        role: "bot",
        content:
          "恭喜您完成入驻!您可以在卖家中心开始上架商品,如有问题随时联系。",
      },
      {
        role: "merchant",
        content: "好的,客服态度很好,后续装修有问题再来问你们。",
      },
    ],
  },
];

const ROLE_META: Record<
  string,
  { label: string; Icon: typeof User; cls: string; bubble: string }
> = {
  merchant: {
    label: "商家",
    Icon: User,
    cls: "text-foreground",
    bubble:
      "bg-secondary border border-border self-start mr-12 rounded-r-lg rounded-bl-lg",
  },
  bot: {
    label: "机器人",
    Icon: Bot,
    cls: "text-muted-foreground",
    bubble:
      "bg-card border border-border self-end ml-12 rounded-l-lg rounded-br-lg",
  },
  human: {
    label: "人工",
    Icon: Headset,
    cls: "text-primary",
    bubble:
      "bg-primary/8 border border-primary/30 self-end ml-12 rounded-l-lg rounded-br-lg",
  },
};

// ============ Copilot Analysis 类型 ============
type Analysis = {
  emotion: number;
  emotionLabel: string;
  escalationRisk: number;
  predictedFailureTypes: { type: string; confidence: number }[];
  suggestedReplies: { text: string; rationale: string }[];
  redFlags: string[];
};

type AnalysisHistory = {
  atTurnIndex: number; // 分析时已展示的对话长度(turns array length)
  analysis: Analysis;
};

const FAILURE_TYPE_LABEL: Record<string, string> = {
  knowledge_gap: "知识缺口",
  routing_error: "路由错误",
  policy_limit: "政策限制",
  merchant_misunderstanding: "商家理解偏差",
  systemic_unsolvable: "系统性无解",
};

export default function Copilot() {
  const [activeScenario, setActiveScenario] = useState<Scenario>(SCENARIOS[0]);
  const [shownTurns, setShownTurns] = useState<ScenarioTurn[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<AnalysisHistory[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [adoptedReplies, setAdoptedReplies] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 切换场景时重置状态
  useEffect(() => {
    setShownTurns([]);
    setAnalysis(null);
    setHistory([]);
    setAdoptedReplies(new Set());
    setError(null);
    setIsPlaying(false);
  }, [activeScenario.id]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [shownTurns.length]);

  async function analyzeTurns(turns: ScenarioTurn[]) {
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/copilot/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() || "";
        for (const block of blocks) {
          const evMatch = block.match(/^event:\s*(.+)$/m);
          const dataMatch = block.match(/^data:\s*(.+)$/m);
          if (!evMatch || !dataMatch) continue;
          const event = evMatch[1].trim();
          const data = JSON.parse(dataMatch[1]);
          if (event === "analysis") {
            setAnalysis(data as Analysis);
            setHistory((h) => [
              ...h,
              { atTurnIndex: turns.length, analysis: data as Analysis },
            ]);
          } else if (event === "error") {
            setError(data.message);
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function playNext() {
    if (shownTurns.length >= activeScenario.turns.length) return;
    const nextTurns = activeScenario.turns.slice(0, shownTurns.length + 1);
    setShownTurns(nextTurns);
    // 商家说话后立即分析
    if (nextTurns[nextTurns.length - 1].role === "merchant") {
      await analyzeTurns(nextTurns);
    }
  }

  async function playAll() {
    if (isPlaying) return;
    setIsPlaying(true);
    setShownTurns([]);
    setAnalysis(null);
    setHistory([]);
    setAdoptedReplies(new Set());
    for (let i = 0; i < activeScenario.turns.length; i++) {
      const next = activeScenario.turns.slice(0, i + 1);
      setShownTurns(next);
      // 等待 UI 更新
      await new Promise((r) => setTimeout(r, 500));
      if (activeScenario.turns[i].role === "merchant") {
        await analyzeTurns(next);
        await new Promise((r) => setTimeout(r, 600));
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    setIsPlaying(false);
  }

  function resetScenario() {
    setShownTurns([]);
    setAnalysis(null);
    setHistory([]);
    setAdoptedReplies(new Set());
    setError(null);
  }

  const emotionPct = analysis ? Math.round(analysis.emotion * 100) : 50;
  const riskPct = analysis ? Math.round(analysis.escalationRisk * 100) : 0;
  const riskColor =
    riskPct >= 70
      ? "text-destructive bg-destructive/10 border-destructive/40"
      : riskPct >= 40
      ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/40"
      : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/40";

  return (
    <AppLayout>
      <PageHeader
        title="实时副驾 Copilot"
        subtitle="客服对话时实时预测情绪、升级风险并生成话术建议"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={resetScenario}
              data-testid="button-reset-copilot"
              className="text-[12px] px-3 py-1.5 rounded-md border border-border hover:bg-secondary transition-colors"
            >
              重置
            </button>
            <button
              onClick={playAll}
              disabled={isPlaying}
              data-testid="button-play-all"
              className="text-[12px] px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {isPlaying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {isPlaying ? "播放中" : "一键播放"}
            </button>
          </div>
        }
      />

      <div className="p-8 max-w-[1400px]">
        {/* 场景选择 */}
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            选择演示场景
          </div>
          <div className="grid grid-cols-3 gap-3">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveScenario(s)}
                data-testid={`button-scenario-${s.id}`}
                className={`text-left p-3 rounded-md border transition-all ${
                  activeScenario.id === s.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary/50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[13px] font-medium">{s.title}</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                    {s.tag}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  {s.summary}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 双栏:对话 | Copilot 面板 */}
        <div className="grid grid-cols-[1fr_440px] gap-5">
          {/* 左:对话区 */}
          <div className="border border-border rounded-lg bg-card flex flex-col h-[640px]">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-muted-foreground" />
                <div className="text-[13px] font-medium">客服会话</div>
                <span className="text-[11px] text-muted-foreground">
                  {shownTurns.length} / {activeScenario.turns.length} 轮
                </span>
              </div>
              <button
                onClick={playNext}
                disabled={
                  isPlaying ||
                  shownTurns.length >= activeScenario.turns.length
                }
                data-testid="button-play-next"
                className="text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-secondary disabled:opacity-40 flex items-center gap-1"
              >
                下一轮 <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col"
            >
              {shownTurns.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-center text-[12px] text-muted-foreground">
                  点击「一键播放」或「下一轮」开始演示
                </div>
              ) : (
                shownTurns.map((t, i) => {
                  const meta = ROLE_META[t.role];
                  const Icon = meta.Icon;
                  return (
                    <div
                      key={i}
                      className={`max-w-[80%] px-3 py-2 ${meta.bubble} text-[13px] leading-relaxed`}
                      data-testid={`turn-${i}-${t.role}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className={`w-3 h-3 ${meta.cls}`} />
                        <span
                          className={`text-[10px] font-medium uppercase tracking-wide ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div className="text-foreground">{t.content}</div>
                    </div>
                  );
                })
              )}
              {isAnalyzing && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 self-center mt-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Copilot 分析中...
                </div>
              )}
            </div>
          </div>

          {/* 右:Copilot 面板 */}
          <div className="border border-border rounded-lg bg-card h-[640px] flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <div className="text-[13px] font-medium">Copilot 分析</div>
              {analysis && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  第 {history.length} 次分析
                </span>
              )}
            </div>

            {!analysis && !isAnalyzing && (
              <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground p-6 text-center">
                Copilot 会在商家发言后自动给出
                <br />
                情绪、升级风险与话术建议
              </div>
            )}

            {(analysis || isAnalyzing) && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 情绪温度计 */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <Flame className="w-3 h-3" />
                      情绪温度
                    </div>
                    <div className="text-[12px] font-medium">
                      {analysis?.emotionLabel || "—"}{" "}
                      <span className="text-muted-foreground">
                        ({(emotionPct / 100).toFixed(2)} / 1.0)
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden relative">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${emotionPct}%`,
                        background:
                          emotionPct < 30
                            ? "linear-gradient(90deg, #dc2626, #f97316)"
                            : emotionPct < 50
                            ? "linear-gradient(90deg, #f97316, #eab308)"
                            : emotionPct < 75
                            ? "linear-gradient(90deg, #84cc16, #22c55e)"
                            : "linear-gradient(90deg, #22c55e, #14b8a6)",
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground/70 mt-1">
                    <span>愤怒</span>
                    <span>中性</span>
                    <span>满意</span>
                  </div>
                </div>

                {/* 升级风险 */}
                <div
                  className={`p-3 rounded-md border ${riskColor} transition-all duration-300`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                      <ShieldAlert className="w-3 h-3" />
                      升级风险
                    </div>
                    <div className="text-[14px] font-semibold tabular-nums">
                      {riskPct}%
                    </div>
                  </div>
                  <div className="h-1.5 bg-current/15 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-current transition-all duration-500"
                      style={{ width: `${riskPct}%` }}
                    />
                  </div>
                  {riskPct >= 70 && (
                    <div className="text-[11px] mt-1.5 leading-snug">
                      ⚠ 强烈建议立即介入人工坐席
                    </div>
                  )}
                </div>

                {/* Red Flags */}
                {analysis && analysis.redFlags.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <AlertTriangle className="w-3 h-3" />
                      警报信号
                    </div>
                    {analysis.redFlags.map((f, i) => (
                      <div
                        key={i}
                        className="text-[12px] px-2.5 py-1.5 rounded bg-destructive/10 border border-destructive/30 text-destructive flex items-start gap-1.5"
                      >
                        <span>•</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 失败预测 */}
                {analysis && analysis.predictedFailureTypes.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      失败模式预测
                    </div>
                    <div className="space-y-1">
                      {analysis.predictedFailureTypes.map((p, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-[12px]"
                        >
                          <span>
                            {FAILURE_TYPE_LABEL[p.type] || p.type}
                          </span>
                          <div className="flex items-center gap-2 w-32">
                            <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{
                                  width: `${Math.round(p.confidence * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">
                              {Math.round(p.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 话术建议 */}
                {analysis && analysis.suggestedReplies.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      话术建议
                    </div>
                    <div className="space-y-2">
                      {analysis.suggestedReplies.map((r, i) => {
                        const adopted = adoptedReplies.has(r.text);
                        return (
                          <div
                            key={i}
                            className={`rounded-md border p-2.5 ${
                              adopted
                                ? "bg-primary/5 border-primary/40"
                                : "bg-secondary/40 border-border"
                            }`}
                          >
                            <div className="text-[12.5px] leading-relaxed mb-1.5">
                              {r.text}
                            </div>
                            <div className="text-[10.5px] text-muted-foreground italic mb-2">
                              理由:{r.rationale}
                            </div>
                            <button
                              onClick={() => {
                                const next = new Set(adoptedReplies);
                                if (adopted) next.delete(r.text);
                                else next.add(r.text);
                                setAdoptedReplies(next);
                              }}
                              data-testid={`button-adopt-${i}`}
                              className={`text-[10.5px] px-2 py-0.5 rounded border ${
                                adopted
                                  ? "bg-primary/15 border-primary/40 text-primary"
                                  : "border-border hover:bg-secondary"
                              } flex items-center gap-1`}
                            >
                              {adopted ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" /> 已采纳
                                </>
                              ) : (
                                <>
                                  <Send className="w-3 h-3" /> 采纳
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded p-2">
                    错误:{error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 分析历史时间线 */}
        {history.length > 0 && (
          <div className="mt-6 border border-border rounded-lg bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">
              情绪 & 风险轨迹(本场对话)
            </div>
            <div className="flex items-end gap-3 h-24">
              {history.map((h, i) => {
                const ePct = Math.round(h.analysis.emotion * 100);
                const rPct = Math.round(h.analysis.escalationRisk * 100);
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center gap-1.5"
                    data-testid={`history-${i}`}
                  >
                    <div className="w-full flex items-end gap-1 h-16">
                      <div
                        className="flex-1 bg-gradient-to-t from-emerald-500/30 to-emerald-500/60 rounded-t"
                        style={{ height: `${ePct}%` }}
                        title={`情绪 ${(ePct / 100).toFixed(2)}`}
                      />
                      <div
                        className="flex-1 bg-gradient-to-t from-destructive/30 to-destructive/60 rounded-t"
                        style={{ height: `${rPct}%` }}
                        title={`风险 ${rPct}`}
                      />
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      第 {h.atTurnIndex} 轮
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-emerald-500/60" />
                情绪
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-destructive/60" />
                升级风险
              </span>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
