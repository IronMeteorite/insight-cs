import { useQuery } from "@tanstack/react-query";
import type { Merchant, Recommendation, Conversation } from "@shared/schema";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Link } from "wouter";
import {
  Target,
  Layers,
  Cpu,
  TrendingUp,
  Compass,
  Flame,
  CheckCircle2,
  ArrowRight,
  Lightbulb,
  Workflow,
  Database,
  Sparkles,
  Eye,
  AlertTriangle,
  Globe,
} from "lucide-react";

export default function Business() {
  const { data: merchants = [] } = useQuery<Merchant[]>({
    queryKey: ["/api/merchants"],
  });
  const { data: recs = [] } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
  });
  const { data: convs = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });

  // 计算"今天能讲什么故事"
  const totalTickets = convs.length;
  const badCount = convs.filter((c) => c.resolutionStatus !== "resolved").length;
  const badRate = totalTickets === 0 ? 0 : badCount / totalTickets;
  const escalatedCount = convs.filter((c) => c.resolutionStatus === "escalated").length;
  const escalationRate = totalTickets === 0 ? 0 : escalatedCount / totalTickets;
  const criticalMerchants = merchants.filter((m) => m.riskTier === "critical").length;
  const highMerchants = merchants.filter((m) => m.riskTier === "high").length;
  const recImpl = recs.filter((r) => r.status === "implemented" || r.status === "in_progress").length;

  return (
    <AppLayout>
      <PageHeader
        title="产品 & 商业"
        subtitle="一页讲清楚 Insight CS 是什么、为谁解决了什么问题、技术与商业飞轮怎么转"
      />
      <div className="px-8 py-6 space-y-10">
        {/* —— Hero —— */}
        <section className="relative overflow-hidden rounded-xl border border-card-border bg-gradient-to-br from-[hsl(var(--chart-1))]/10 via-card to-[hsl(var(--chart-4))]/10 p-8">
          <div className="absolute top-0 right-0 w-72 h-72 bg-[hsl(var(--chart-1))]/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10.5px] uppercase tracking-wider">
              <Sparkles className="w-3 h-3" />
              跨境商家体验智能中台
            </div>
            <h2 className="text-[28px] leading-tight font-semibold mt-3 max-w-3xl">
              把 <span className="text-primary">跨境商家的客服对话</span>,变成
              <br />
              可量化、可追溯、可闭环的 <span className="text-[hsl(var(--chart-1))]">商业增长资产</span>。
            </h2>
            <p className="text-[14px] text-muted-foreground mt-4 max-w-3xl leading-relaxed">
              Insight CS 是一个面向<strong>跨境电商平台</strong>商家体验团队的客服洞察 Copilot
              ——它实时分析商家↔平台的对话,识别情绪与失效模式,聚合成商家画像与流失风险榜,
              并把每条建议变成"<strong>baseline → 实施 → 效果对比</strong>"的闭环。
            </p>

            <div className="grid grid-cols-4 gap-3 mt-6">
              <HeroMetric label="覆盖工单" value={totalTickets.toString()} sub="累计入库" />
              <HeroMetric
                label="活跃商家"
                value={merchants.length.toString()}
                sub={`极高风险 ${criticalMerchants} · 高 ${highMerchants}`}
              />
              <HeroMetric
                label="坏单率 bad_case_rate"
                value={`${(badRate * 100).toFixed(1)}%`}
                sub={`升级率 ${(escalationRate * 100).toFixed(1)}%`}
                tone={badRate > 0.3 ? "warning" : undefined}
              />
              <HeroMetric
                label="LLM 推荐闭环"
                value={`${recImpl}/${recs.length}`}
                sub="进入实施 / 总建议"
              />
            </div>

            <div className="flex items-center gap-2 mt-6">
              <Link href="/">
                <a
                  data-testid="hero-cta-dashboard"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-[12.5px] hover:opacity-90"
                >
                  进入实时仪表盘 <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </Link>
              <Link href="/copilot">
                <a
                  data-testid="hero-cta-copilot"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-border text-[12.5px] hover:bg-muted/40"
                >
                  体验 Copilot 实时副驾
                </a>
              </Link>
              <Link href="/merchants">
                <a
                  data-testid="hero-cta-merchants"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-border text-[12.5px] hover:bg-muted/40"
                >
                  查看 Top 风险商家
                </a>
              </Link>
            </div>
          </div>
        </section>

        {/* —— 问题与机会 —— */}
        <Section
          icon={Target}
          eyebrow="01 问题"
          title="跨境商家体验团队每天都在做什么?"
          subtitle="把堆积的工单变成可解释的洞察,是体验团队最难、最贵、最容易做错的事情。"
        >
          <div className="grid grid-cols-3 gap-4">
            <Pain
              icon={AlertTriangle}
              title="一天几千通对话,人工只看 5%"
              body="头部跨境电商每天产生数千通商家工单,QA 团队抽检 ≤ 5%,绝大多数失败模式被埋在长尾里,直到商家流失才被看见。"
            />
            <Pain
              icon={Workflow}
              title="知识库/路由/政策的反馈通路是断的"
              body="每一条工单都暗藏一个修复信号——是知识缺口、路由错误,还是政策限制?现有工具不把它结构化,优化决策只能靠经验拍脑袋。"
            />
            <Pain
              icon={Eye}
              title="商家流失发生在情绪转折点,而非 NPS 调研"
              body={`商家不会等季度问卷再表达不满。情绪从“焦虑”滑向“愤怒”那一通对话,就是流失的真正起点——但很少有平台把它捕捉下来。`}
            />
          </div>
        </Section>

        {/* —— 三层产品架构 —— */}
        <Section
          icon={Layers}
          eyebrow="02 产品"
          title="三层架构:从单通对话到商业决策"
          subtitle="每一层都对应一个具体角色的工作流,层与层之间的数据是闭环的。"
        >
          <div className="grid grid-cols-3 gap-4">
            <Layer
              num="L1"
              tag="客服坐席"
              title="实时副驾 Copilot"
              body={`多轮对话中实时给出情绪指数、升级风险、预测失效类型、可采纳话术——把 AI 助理从“事后总结”前置到“对话进行中”。`}
              cta={{ href: "/copilot", label: "打开 Copilot" }}
              color="from-[hsl(var(--chart-1))]/15 to-transparent border-l-[hsl(var(--chart-1))]"
            />
            <Layer
              num="L2"
              tag="商家体验经理"
              title="商家画像 + 风险榜"
              body={`把多通工单聚合成单个商家的风险叙事 + 推荐动作 + 原声金句 + 事件时间线。Top 20 风险榜让“今天该联系谁”一目了然。`}
              cta={{ href: "/merchants", label: "查看商家中心" }}
              color="from-[hsl(var(--chart-4))]/15 to-transparent border-l-[hsl(var(--chart-4))]"
            />
            <Layer
              num="L3"
              tag="产品 / 知识库 / 政策负责人"
              title="推荐闭环 + 效果追踪"
              body="LLM 把高频失效模式提炼成知识库/路由/政策建议,采纳即记录基线、实施后自动对比 baseline,delta% 实时可见。"
              cta={{ href: "/recommendations", label: "进入优化建议" }}
              color="from-[hsl(var(--chart-5))]/15 to-transparent border-l-[hsl(var(--chart-5))]"
            />
          </div>
        </Section>

        {/* —— 技术亮点 —— */}
        <Section
          icon={Cpu}
          eyebrow="03 技术"
          title="不止 LLM 包一层皮"
          subtitle="把 AI 真正塞到生产工作流里,需要把模型、Schema、数据闭环、UX 都同步设计。"
        >
          <div className="grid grid-cols-2 gap-4">
            <Tech
              icon={Database}
              title="结构化抽取 × 双语原文留痕"
              body="每通对话:意图、情绪起止、情绪轨迹(0~1)、失效模式分类、商家原声金句——全部由 LLM 抽取并落库;非中文对话同时保留原文与中文翻译,便于上下文复核。"
            />
            <Tech
              icon={Workflow}
              title={`SSE 流式 Copilot,首响 < 1s`}
              body="POST /api/copilot/turn 走 Server-Sent Events,分阶段推送:步骤提示 → 完整结构化分析 → 完成。前端逐 chunk 渲染,坐席无需等模型一次性吐完。"
            />
            <Tech
              icon={TrendingUp}
              title="推荐闭环 = baseline + 实施时间 + 效果窗"
              body={`状态切到“实施中”自动按 targetCategory + targetFailureType 圈选近 7 天工单,计算 bad_case_rate / escalation_rate / avg_csat 作为基线;之后任何时刻可拉取 delta、deltaPct、isImprovement。`}
            />
            <Tech
              icon={Flame}
              title="商家画像由 LLM 直接叙述"
              body={`不只是 SQL group by:把每个商家的多通工单 + 失效模式 + 金句喂给 DeepSeek,生成可直接发给体验经理的中文风险叙事和“下一步动作”建议——一个商家一段话。`}
            />
          </div>
        </Section>

        {/* —— 商业模式 —— */}
        <Section
          icon={Compass}
          eyebrow="04 商业"
          title="谁付费、为什么付、如何复利"
          subtitle="目标客户是 ≥ 10 万跨境商家、≥ 500 万年工单的电商平台体验团队 / Trust&Safety 团队。"
        >
          <div className="grid grid-cols-2 gap-4">
            <BizPanel title="客户价值锚点">
              <ValueLine
                label="坏单率 ↓"
                detail="LLM 闭环 + Copilot 干预,目标 -5pp / 季度"
              />
              <ValueLine
                label="高价值商家流失 ↓"
                detail="Top 20 风险榜 + 主动外联,挽回率提升"
              />
              <ValueLine
                label="QA 人力 ↓"
                detail="覆盖率从 ≤5% 抽检到 100% 自动结构化"
              />
              <ValueLine
                label="政策迭代速度 ↑"
                detail="高频失效模式自动归因到知识库 / 路由 / 政策"
              />
            </BizPanel>
            <BizPanel title="定价 & 部署形态">
              <ValueLine
                label="SaaS 订阅"
                detail="按平台年工单量分档,起步 $50k/年"
              />
              <ValueLine
                label="私有化 / 专有云"
                detail="模型可替换(DeepSeek / OpenAI / Claude / 自训),数据不出环境"
              />
              <ValueLine
                label="增值:行业基准报告"
                detail="跨平台脱敏数据池,出版年度跨境商家体验白皮书"
              />
              <ValueLine
                label="增值:专项咨询"
                detail="针对特定地区(LATAM / MEA)或类目深度对接"
              />
            </BizPanel>
          </div>
        </Section>

        {/* —— 竞品 —— */}
        <Section
          icon={Globe}
          eyebrow="05 竞品差异"
          title="为什么不是 Salesforce / Zendesk / 自建 BI?"
        >
          <div className="bg-card border border-card-border rounded-lg overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/40 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">维度</th>
                  <th className="px-4 py-2 text-left">通用客服平台</th>
                  <th className="px-4 py-2 text-left">自建 BI / 报表</th>
                  <th className="px-4 py-2 text-left text-primary">Insight CS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <CompareRow
                  dim="分析单元"
                  a="工单数 / 平均时长"
                  b="维度透视表"
                  c="情绪轨迹 + 失效模式 + 商家原声"
                />
                <CompareRow
                  dim="可执行性"
                  a="生成报告 → 人工再消化"
                  b="看完图表自己想方案"
                  c="LLM 直接给出动作 + 自动追踪效果"
                />
                <CompareRow
                  dim="商家维度"
                  a="客户档案是 CRM 字段"
                  b="按商家 group by 看数字"
                  c="每个商家有一段 LLM 风险叙事"
                />
                <CompareRow
                  dim="冷启动"
                  a="重 SLA / 工单流"
                  b="重数据治理"
                  c="把现有工单灌进来即可开跑"
                />
                <CompareRow
                  dim="跨境多语言"
                  a="多坐席多语种"
                  b="不擅长非结构化文本"
                  c="LLM 原生多语种 + 双语留痕"
                />
              </tbody>
            </table>
          </div>
        </Section>

        {/* —— 路线图 —— */}
        <Section
          icon={Lightbulb}
          eyebrow="06 路线图"
          title="接下来,我们会继续做什么"
        >
          <div className="grid grid-cols-3 gap-4">
            <Roadmap
              phase="近期 · 1 个月"
              items={[
                "知识库/路由/政策的 webhook 写回(自动下发,无需手动改文档)",
                "商家关怀剧本生成器:基于风险叙事自动产出外联文案",
                "Copilot 内嵌客服后台 iframe 模式",
              ]}
            />
            <Roadmap
              phase="中期 · 1 个季度"
              items={[
                "多模态:把电话/语音工单纳入同一情绪轨迹",
                "Agent 评估闭环:对客服机器人答复打分并反馈训练",
                "跨平台脱敏对标:行业基准与匿名横向对比",
              ]}
            />
            <Roadmap
              phase="远期 · 1 年"
              items={[
                "商家体验白皮书发布(年度 / 跨平台)",
                "Trust & Safety 协同模块:把欺诈/合规信号融入同一画像",
                "Public API + Marketplace 上架(Shopify / Lazada / Mercado 等)",
              ]}
            />
          </div>
        </Section>

        {/* —— Footer CTA —— */}
        <section className="rounded-xl border border-card-border bg-card p-6 flex items-center justify-between">
          <div>
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider">
              想看一遍完整链路?
            </div>
            <div className="text-[15px] font-medium mt-1">
              Dashboard → Copilot → 商家中心 → 推荐闭环,4 步走完。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/">
              <a
                data-testid="footer-cta-dashboard"
                className="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-[12.5px] hover:opacity-90"
              >
                从仪表盘开始
              </a>
            </Link>
            <Link href="/recommendations">
              <a
                data-testid="footer-cta-recs"
                className="px-3.5 py-1.5 rounded-md border border-border text-[12.5px] hover:bg-muted/40"
              >
                看推荐闭环
              </a>
            </Link>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

// ============================================================
// 小组件
// ============================================================

function HeroMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warning";
}) {
  const tint = tone === "warning" ? "text-[hsl(var(--chart-5))]" : "text-foreground";
  return (
    <div className="bg-background/60 backdrop-blur border border-border rounded-lg p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-[22px] font-semibold tabular-nums mt-1 ${tint}`}>
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  icon: any;
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground uppercase tracking-wider">
            <Icon className="w-3 h-3" />
            {eyebrow}
          </div>
          <h3 className="text-[20px] font-semibold mt-1 leading-tight">{title}</h3>
          {subtitle && (
            <p className="text-[12.5px] text-muted-foreground mt-1 max-w-3xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function Pain({
  icon: Icon,
  title,
  body,
}: {
  icon: any;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-5">
      <div className="w-7 h-7 rounded-md border border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-center">
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="text-[13.5px] font-medium mt-3">{title}</div>
      <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function Layer({
  num,
  tag,
  title,
  body,
  cta,
  color,
}: {
  num: string;
  tag: string;
  title: string;
  body: string;
  cta: { href: string; label: string };
  color: string;
}) {
  return (
    <div
      className={`rounded-lg border-l-2 border border-card-border bg-gradient-to-br ${color} p-5 flex flex-col`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-mono text-muted-foreground">{num}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/60 border border-border text-muted-foreground uppercase tracking-wider">
          {tag}
        </span>
      </div>
      <div className="text-[14.5px] font-medium mt-3">{title}</div>
      <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed flex-1">
        {body}
      </p>
      <Link href={cta.href}>
        <a
          data-testid={`layer-cta-${num}`}
          className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline mt-3"
        >
          {cta.label} <ArrowRight className="w-3 h-3" />
        </a>
      </Link>
    </div>
  );
}

function Tech({
  icon: Icon,
  title,
  body,
}: {
  icon: any;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-5 flex gap-3">
      <div className="w-7 h-7 rounded-md border border-primary/30 bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function BizPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-5">
      <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ValueLine({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--chart-2))] shrink-0 mt-0.5" />
      <div>
        <span className="text-[12.5px] font-medium">{label}</span>
        <span className="text-[12px] text-muted-foreground"> · {detail}</span>
      </div>
    </div>
  );
}

function CompareRow({
  dim,
  a,
  b,
  c,
}: {
  dim: string;
  a: string;
  b: string;
  c: string;
}) {
  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-3 text-[11.5px] text-muted-foreground uppercase tracking-wider">
        {dim}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{a}</td>
      <td className="px-4 py-3 text-muted-foreground">{b}</td>
      <td className="px-4 py-3 text-foreground font-medium">{c}</td>
    </tr>
  );
}

function Roadmap({ phase, items }: { phase: string; items: string[] }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-5">
      <div className="text-[10.5px] text-primary uppercase tracking-wider">{phase}</div>
      <ul className="mt-3 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed">
            <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
