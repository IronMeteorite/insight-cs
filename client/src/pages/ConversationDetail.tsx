import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import type { Conversation } from "@shared/schema";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  ArrowLeft,
  Bot,
  Store,
  Headphones,
  AlertTriangle,
  Lightbulb,
  Tag,
  Languages,
  Globe,
} from "lucide-react";

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
  merchant_misunderstanding: "商家预期偏差",
  systemic_unsolvable: "系统性不可解",
};
const FAILURE_HINT: Record<string, string> = {
  knowledge_gap: "建议:补充该意图相关原子知识到商家帮助中心",
  routing_error: "建议:调整该意图的路由策略,英文/复杂场景直转双语人工",
  policy_limit: "建议:评估现有政策弹性,引入灰度处理通道",
  merchant_misunderstanding: "建议:机器人首轮主动澄清责任归属",
  systemic_unsolvable: "建议:推动与上游系统(银行/3PL/海关)实时数据互通",
};
const REGION_LABEL: Record<string, string> = {
  CN: "中国",
  US: "北美",
  EU: "欧洲",
  SEA: "东南亚",
  LATAM: "拉美",
  MEA: "中东/非洲",
};

type Turn = { role: string; content: string; ts: string };

export default function ConversationDetail() {
  const [, params] = useRoute("/conversations/:id");
  const id = params?.id;
  const [showTranslated, setShowTranslated] = useState(true);

  const { data: c, isLoading } = useQuery<Conversation>({
    queryKey: ["/api/conversations", id],
    enabled: !!id,
  });

  if (isLoading || !c) {
    return (
      <AppLayout>
        <PageHeader title="工单详情" />
        <div className="px-8 py-12 text-muted-foreground text-[13px]">加载中…</div>
      </AppLayout>
    );
  }

  const transcript: Turn[] =
    typeof c.rawTranscript === "string"
      ? safeParse(c.rawTranscript)
      : (c.rawTranscript as any) || [];
  const translated: Turn[] = c.translatedTranscript ? safeParse(c.translatedTranscript) : [];
  const trajectory = safeParse(c.emotionTrajectory).map((t: any) => ({
    turn: t.turn,
    情绪指数: +Number(t.score).toFixed(3),
  }));
  const tags: string[] = safeParse(c.tags);

  const isEnglish = c.language === "en";

  return (
    <AppLayout>
      <PageHeader
        title={`工单 ${c.externalId}`}
        subtitle={`${c.category} · ${c.primaryIntent} · ${c.turns} 轮 · ${Math.round(
          c.durationSec / 60
        )} 分钟 · ${REGION_LABEL[c.merchantRegion] || c.merchantRegion}商家${
          isEnglish ? " · 🇬🇧 英文工单" : ""
        }`}
        actions={
          <Link
            href="/conversations"
            data-testid="link-back"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted/40 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> 返回列表
          </Link>
        }
      />

      <div className="px-8 py-6 grid grid-cols-[1fr_360px] gap-6">
        {/* 主区:转录 */}
        <div className="space-y-4">
          <Section
            title="工单对话"
            extra={
              isEnglish && translated.length > 0 ? (
                <button
                  onClick={() => setShowTranslated((v) => !v)}
                  data-testid="button-toggle-translation"
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <Languages className="w-3 h-3" />
                  {showTranslated ? "隐藏中文翻译" : "显示中文翻译"}
                </button>
              ) : null
            }
          >
            {isEnglish && (
              <div className="mb-3 flex items-center gap-1.5 text-[11px] text-muted-foreground bg-primary/5 border border-primary/15 rounded px-2.5 py-1.5">
                <Globe className="w-3 h-3 text-primary" />
                外语工单已自动翻译为中文。如需查看原文,可关闭翻译。
              </div>
            )}
            <div className="space-y-3">
              {transcript.map((m, i) => (
                <Bubble
                  key={i}
                  message={m}
                  translation={isEnglish && showTranslated ? translated[i]?.content : undefined}
                />
              ))}
            </div>
          </Section>

          <Section title="情绪轨迹">
            <div className="text-[11px] text-muted-foreground mb-2">
              LLM 推断的逐轮情绪指数(1 = 满意,0.5 = 中性,0 = 愤怒)
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trajectory as any} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="turn"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
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
                <ReferenceLine y={0.5} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="情绪指数"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "hsl(var(--chart-1))", strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Section>
        </div>

        {/* 侧栏:LLM 分析 */}
        <aside className="space-y-4">
          <Section title="LLM 分析摘要" testid="section-llm">
            <Row label="状态">
              <span className="text-[12px] font-medium">{STATUS_LABEL[c.resolutionStatus]}</span>
            </Row>
            <Row label="商家ID">
              <span className="text-[12px] font-mono">{c.merchantId}</span>
            </Row>
            <Row label="区域">
              <span className="text-[12px]">
                {REGION_LABEL[c.merchantRegion] || c.merchantRegion}
              </span>
            </Row>
            <Row label="语言">
              <span className="text-[12px] inline-flex items-center gap-1">
                {isEnglish ? "🇬🇧 英文" : "🇨🇳 中文"}
              </span>
            </Row>
            <Row label="主要意图">
              <span className="text-[12px]">{c.primaryIntent}</span>
            </Row>
            <Row label="意图置信度">
              <span className="text-[12px] tabular-nums font-mono">
                {(c.intentConfidence * 100).toFixed(0)}%
              </span>
            </Row>
            <Row label="情绪起 → 终">
              <span className="text-[12px]">
                {c.emotionStart} → <span className="font-medium">{c.emotionEnd}</span>
              </span>
            </Row>
            <Row label="满意度">
              <span className="text-[12px] tabular-nums font-mono">
                {c.satisfactionScore?.toFixed(1) ?? "—"} / 5.0
              </span>
            </Row>
            <Row label="渠道">
              <span className="text-[12px] text-muted-foreground">
                {c.channel.replace("_", " ")}
              </span>
            </Row>
          </Section>

          {c.failureType && (
            <Section title="失效归因" testid="section-failure">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--chart-4))] mt-0.5" />
                <div>
                  <div className="text-[12px] font-medium">{FAILURE_LABEL[c.failureType]}</div>
                  <div className="text-[11.5px] text-muted-foreground mt-1 leading-relaxed">
                    {c.failureReason}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 pt-3 border-t border-border">
                <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5" />
                <div className="text-[11.5px] text-muted-foreground leading-relaxed">
                  {FAILURE_HINT[c.failureType]}
                </div>
              </div>
            </Section>
          )}

          <Section title="标签">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] bg-muted border border-border rounded text-muted-foreground"
                >
                  <Tag className="w-2.5 h-2.5" />
                  {t}
                </span>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </AppLayout>
  );
}

function Section({
  title,
  children,
  testid,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  testid?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-5" data-testid={testid}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-b-0">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Bubble({
  message,
  translation,
}: {
  message: Turn;
  translation?: string;
}) {
  const isMerchant = message.role === "merchant" || message.role === "user";
  const isHuman = message.role === "human";
  const Icon = isMerchant ? Store : isHuman ? Headphones : Bot;
  const roleLabel = isMerchant ? "商家" : isHuman ? "平台(人工)" : "平台(机器人)";
  return (
    <div className={`flex gap-3 ${isMerchant ? "flex-row-reverse" : ""}`}>
      <div className="flex-shrink-0 w-7 h-7 rounded-md bg-muted border border-border flex items-center justify-center">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className={`flex-1 max-w-[78%] ${isMerchant ? "text-right" : ""}`}>
        <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground mb-1">
          <span className={isMerchant ? "order-last" : ""}>{roleLabel}</span>
          <span className="font-mono">{message.ts}</span>
        </div>
        <div
          className={`inline-block text-left text-[13px] px-3.5 py-2.5 rounded-lg ${
            isMerchant
              ? "bg-primary/10 border border-primary/20 text-foreground"
              : isHuman
              ? "bg-[hsl(var(--chart-4))]/10 border border-[hsl(var(--chart-4))]/20 text-foreground"
              : "bg-muted border border-border text-foreground"
          }`}
        >
          <div>{message.content}</div>
          {translation && (
            <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[11.5px] text-muted-foreground leading-relaxed flex gap-1.5 items-start">
              <Languages className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary" />
              <span>{translation}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}
