import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { apiRequest, queryClient, API_BASE } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Upload,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Wand2,
  Check,
  Loader2,
  FileText,
  X as XIcon,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Link } from "wouter";

const SAMPLES = [
  {
    label: "示例：资质审核进度焦虑",
    text: `商家: 我提交入驻资质已经五天了，为什么还是"审核中"？这个月的活动报名快截止了。
机器人: 您好，审核周期为 3-7 个工作日，请耐心等待。
商家: 请问我上传的 BR 复照是不是有问题？只要告诉我哪个环节卡住。
机器人: 抱歉，本助手无法查询资质详情。
商家: 转人工。
人工: 我看一下…已加急。`,
  },
  {
    label: "示例：买家恶意退款申诉",
    text: `商家: 买家申请退款不退货，但他给的图是别的品牌。这是恶意退款。
机器人: 请提供订单号与证据，平台会复核。
商家: 证据已上传三次，退款却被自动通过了，货款被扣。
机器人: 根据政策，推荐商品恶意退款制胜率低，请准备更多证据。
商家: 这个回复没意义，我要赔付。`,
  },
  {
    label: "Example: Ads balance frozen (EN)",
    text: `merchant: My ads balance shows $0 but I topped up $500 yesterday. Campaigns are paused.
bot: Funds typically reflect within 2 hours.
merchant: It's been 18 hours. Order ID PAY-99213. Please escalate.
bot: Please contact finance@platform.com.
merchant: This is the third escalation. I'm losing peak-season traffic.`,
  },
];

// 三个预置 demo（不写入数据库,只走 SSE 流式展示）
const TRY_PRESETS = [
  {
    key: "qualification",
    title: "资质审核停滞 5 天",
    summary: "商家追问 BR 上传问题，机器人多轮模板回复",
    text: `商家: 我提交入驻资质已经五天了，为什么还是"审核中"？这个月的活动报名快截止了。
机器人: 您好，审核周期为 3-7 个工作日，请耐心等待。
商家: 请问我上传的 BR 复照是不是有问题？只要告诉我哪个环节卡住。
机器人: 抱歉，本助手无法查询资质详情。
商家: 转人工。`,
  },
  {
    key: "ads-frozen",
    title: "广告余额冻结 (EN)",
    summary: "海外商家英文工单，三次升级仍未解决",
    text: `merchant: My ads balance shows $0 but I topped up $500 yesterday. Campaigns are paused.
bot: Funds typically reflect within 2 hours.
merchant: It's been 18 hours. Order ID PAY-99213. Please escalate.
bot: Please contact finance@platform.com.
merchant: This is the third escalation. I'm losing peak-season traffic.`,
  },
  {
    key: "malicious-refund",
    title: "买家恶意退款",
    summary: "证据上传三次仍被自动退款，商家诉求赔付",
    text: `商家: 买家申请退款不退货，但他给的图是别的品牌。这是恶意退款。
机器人: 请提供订单号与证据，平台会复核。
商家: 证据已上传三次，退款却被自动通过了，货款被扣。
机器人: 根据政策，推荐商品恶意退款制胜率低，请准备更多证据。
商家: 这个回复没意义，我要赔付。`,
  },
];

type StreamField = {
  key: string;
  label: string;
  value: string | number;
  confidence?: number;
  reason?: string;
  trajectory?: number[];
};

type LLMSysInfo = { provider: string; fast: string; quality: string; hasKey: boolean };

export default function Ingest() {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("seller_center");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // 试试看面板状态
  const [tryOpen, setTryOpen] = useState(true);

  // 批量上传状态
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [streamedFields, setStreamedFields] = useState<StreamField[]>([]);
  const [translations, setTranslations] = useState<{ index: number; original: string; translated: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // 当前 LLM provider 显示
  const { data: llmInfo } = useQuery<LLMSysInfo>({
    queryKey: ["/api/system/llm"],
  });

  const submit = useMutation({
    mutationFn: async () => {
      const lines = text.split("\n").filter(Boolean);
      const transcript = parseLines(lines);
      return apiRequest("POST", "/api/conversations", {
        rawTranscript: JSON.stringify(transcript),
        channel,
      });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({
        title: "已完成 LLM 分析",
        description: `识别意图: ${data.primaryIntent} · 状态: ${data.resolutionStatus}`,
      });
      setLocation(`/conversations/${data.id}`);
    },
    onError: (e: any) => {
      toast({ title: "录入失败", description: e.message, variant: "destructive" });
    },
  });

  function runTryIt(preset: typeof TRY_PRESETS[number]) {
    // 取消上一次
    abortRef.current?.abort();
    setActivePreset(preset.key);
    setStreaming(true);
    setCurrentStep("准备调用 LLM…");
    setStreamedFields([]);
    setTranslations([]);

    const transcript = parseLines(preset.text.split("\n").filter(Boolean));
    const ac = new AbortController();
    abortRef.current = ac;

    // 用 fetch + ReadableStream 解析 SSE（兼容 POST + 自定义 body）
    fetch(`${API_BASE}/api/conversations/try-it`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawTranscript: JSON.stringify(transcript), channel }),
      signal: ac.signal,
    })
      .then(async (res) => {
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
            let data = "";
            for (const ln of lines) {
              if (ln.startsWith("event:")) event = ln.slice(6).trim();
              else if (ln.startsWith("data:")) data += ln.slice(5).trim();
            }
            handleSSE(event, data);
          }
        }
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setCurrentStep(`错误: ${e.message}`);
        setStreaming(false);
      });
  }

  function handleSSE(event: string, dataStr: string) {
    let data: any;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }
    if (event === "step") {
      setCurrentStep(data.message);
    } else if (event === "detected") {
      // 短暂提示
      setCurrentStep(`识别语言: ${data.language === "en" ? "英文" : "中文"}`);
    } else if (event === "field") {
      setStreamedFields((arr) => [
        ...arr,
        {
          key: data.key,
          label: data.label,
          value: data.value,
          confidence: data.confidence,
          reason: data.reason,
          trajectory: data.trajectory,
        },
      ]);
    } else if (event === "translate") {
      setTranslations((arr) => [...arr, data]);
    } else if (event === "done") {
      setCurrentStep("LLM 分析完成");
      setStreaming(false);
    } else if (event === "error") {
      setCurrentStep(`LLM 出错: ${data.message}`);
      setStreaming(false);
    }
  }

  return (
    <AppLayout>
      <PageHeader
        title="工单录入"
        subtitle="粘贴或上传商家↔平台原始对话 · LLM 自动完成诉求、情绪、失效归因与双语翻译"
      />

      <div className="px-8 py-6 space-y-6">
        {/* ====== ✨ 试试看面板 ====== */}
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <button
            data-testid="button-toggle-tryit"
            onClick={() => setTryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              <span className="text-[13px] font-medium">✨ 试试看 — 实时观察 LLM 工单归因</span>
              {llmInfo && (
                <span className="ml-3 text-[10.5px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                  {llmInfo.provider} · {llmInfo.fast}
                </span>
              )}
            </div>
            {tryOpen ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {tryOpen && (
            <div className="px-5 pb-5 border-t border-card-border">
              <div className="mt-4 grid grid-cols-3 gap-3">
                {TRY_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    data-testid={`button-trypreset-${p.key}`}
                    disabled={streaming}
                    onClick={() => runTryIt(p)}
                    className={`text-left px-4 py-3 rounded-md border transition-all ${
                      activePreset === p.key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <div className="text-[12.5px] font-medium mb-1">{p.title}</div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      {p.summary}
                    </div>
                  </button>
                ))}
              </div>

              {activePreset && (
                <div className="mt-4 grid grid-cols-[1fr_1fr] gap-4">
                  {/* 原文 */}
                  <div className="bg-background border border-border rounded-md p-3 text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground max-h-80 overflow-auto">
                    {TRY_PRESETS.find((x) => x.key === activePreset)?.text}
                  </div>

                  {/* 流式归因结果 */}
                  <div className="bg-background border border-border rounded-md p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2">
                      {streaming ? (
                        <Loader2 className="w-3 h-3 animate-spin text-primary" />
                      ) : (
                        <Check className="w-3 h-3 text-success" />
                      )}
                      <span>{currentStep || "等待开始…"}</span>
                    </div>
                    <div className="space-y-1.5">
                      {streamedFields.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-start justify-between gap-3 text-[11.5px] animate-in fade-in slide-in-from-bottom-1 duration-300"
                        >
                          <span className="text-muted-foreground shrink-0">{f.label}</span>
                          <span className="text-right break-words font-medium">
                            {String(f.value || "—")}
                            {typeof f.confidence === "number" && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {(f.confidence * 100).toFixed(0)}%
                              </span>
                            )}
                            {f.reason && (
                              <div className="text-[10.5px] text-muted-foreground font-normal mt-0.5">
                                {f.reason}
                              </div>
                            )}
                          </span>
                        </div>
                      ))}
                      {translations.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            中文翻译
                          </div>
                          {translations.map((t, i) => (
                            <div
                              key={i}
                              className="text-[11px] leading-relaxed animate-in fade-in duration-300"
                            >
                              <span className="text-muted-foreground">{t.original.slice(0, 40)}…</span>
                              <br />
                              <span className="text-foreground">→ {t.translated}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!activePreset && (
                <div className="mt-4 text-[11.5px] text-muted-foreground leading-relaxed">
                  点击上方任意一通预置对话，将通过 SSE 流式调用 LLM，逐字段动态展示归因过程（语言识别 → 场景 → 诉求 → 情绪 → 失效根因 → CSAT → 翻译）。不会写入数据库。
                </div>
              )}
            </div>
          )}
        </div>

        {/* ====== 原有完整录入区 ====== */}
        <div className="grid grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                  商家↔平台对话原文
                </div>
                <select
                  data-testid="select-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="bg-background border border-input rounded-md px-2 py-1 text-[11.5px]"
                >
                  <option value="seller_center">渠道: 卖家中心</option>
                  <option value="email">渠道: 邮件</option>
                  <option value="ticket">渠道: 工单系统</option>
                  <option value="im">渠道: 在线 IM</option>
                </select>
              </div>
              <textarea
                data-testid="textarea-transcript"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  "格式示例（中/英文均可）：\n商家: 我提交的资质为什么还在审核\n机器人: 周期 3-7 天\n商家: 货代沟通有问题，转人工\n人工: 我看一下\nmerchant: My VAT submission is still pending\nbot: Standard review is 5 business days\n…"
                }
                rows={16}
                className="w-full bg-background border border-input rounded-md p-3 text-[13px] font-mono leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">
                  {text
                    ? `${text.length} 字符 · ${text.split("\n").filter(Boolean).length} 行`
                    : "等待输入…"}
                </div>
                <button
                  data-testid="button-analyze"
                  disabled={!text || submit.isPending}
                  onClick={() => submit.mutate()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] rounded-md bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {submit.isPending ? (
                    <>
                      <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                      LLM 分析中…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      运行 LLM 分析
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>

            <BatchUpload
              rows={batchRows}
              setRows={setBatchRows}
              running={batchRunning}
              setRunning={setBatchRunning}
              channel={channel}
              fileInputRef={fileInputRef}
            />
          </div>

          <aside className="space-y-4">
            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
                快速示例
              </div>
              <div className="space-y-2">
                {SAMPLES.map((s, i) => (
                  <button
                    key={i}
                    data-testid={`button-sample-${i}`}
                    onClick={() => setText(s.text)}
                    className="w-full text-left px-3 py-2 text-[12px] rounded-md border border-border hover:border-primary/50 hover:bg-muted/40 transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-lg p-5">
              <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
                LLM 提取字段
              </div>
              <ul className="space-y-1.5 text-[12px] text-muted-foreground">
                <li>· 语言检测（中/英）+ 自动翻译</li>
                <li>· 商家诉求 + 置信度</li>
                <li>· 场景分类（资质 / 商品 / 广告…）</li>
                <li>· 情绪起点 / 终点 + 轨迹</li>
                <li>· 解决状态判定</li>
                <li>· 失效根因 + 证据</li>
                <li>· CSAT 推断</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}

// ============================================================
// 批量上传组件
// ============================================================

type BatchRow = {
  id: string;
  fileName: string;
  externalId?: string;
  status: "queued" | "running" | "done" | "error";
  conversationId?: number;
  intent?: string;
  resolution?: string;
  error?: string;
  rawTranscript: string; // JSON 字符串
  channel: string;
  merchantId?: string;
};

function BatchUpload({
  rows,
  setRows,
  running,
  setRunning,
  channel,
  fileInputRef,
}: {
  rows: BatchRow[];
  setRows: React.Dispatch<React.SetStateAction<BatchRow[]>>;
  running: boolean;
  setRunning: React.Dispatch<React.SetStateAction<boolean>>;
  channel: string;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
}) {
  const { toast } = useToast();
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const errors: string[] = [];
    const parsed: BatchRow[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const items = parseUploadedFile(file.name, text);
        if (items.length === 0) {
          errors.push(`${file.name}: 未解析出任何对话`);
          continue;
        }
        items.forEach((it, i) => {
          parsed.push({
            id: `${file.name}#${i}#${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fileName: file.name + (items.length > 1 ? ` [#${i + 1}]` : ""),
            externalId: it.externalId,
            merchantId: it.merchantId,
            channel: it.channel || channel,
            rawTranscript: it.rawTranscript,
            status: "queued",
          });
        });
      } catch (e: any) {
        errors.push(`${file.name}: ${e.message || "读取失败"}`);
      }
    }
    setParseErrors(errors);
    setRows((prev) => [...prev, ...parsed]);
    if (parsed.length > 0) {
      toast({
        title: `已加载 ${parsed.length} 通对话`,
        description: errors.length ? `${errors.length} 个文件解析失败` : "点击「启动分析」调用 LLM",
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function runBatch() {
    if (running) return;
    setRunning(true);
    // 串行 2 并发调用，避免 LLM rate limit
    const concurrency = 2;
    const queue = rows.filter((r) => r.status === "queued").map((r) => r.id);
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const myId = queue[cursor++];
        const row = rows.find((r) => r.id === myId);
        if (!row) continue;
        setRows((prev) =>
          prev.map((r) => (r.id === myId ? { ...r, status: "running" } : r))
        );
        try {
          const res = await apiRequest("POST", "/api/conversations", {
            rawTranscript: row.rawTranscript,
            channel: row.channel,
            externalId: row.externalId,
            merchantId: row.merchantId,
          });
          const data = await res.json();
          setRows((prev) =>
            prev.map((r) =>
              r.id === myId
                ? {
                    ...r,
                    status: "done",
                    conversationId: data.id,
                    intent: data.primaryIntent,
                    resolution: data.resolutionStatus,
                  }
                : r
            )
          );
        } catch (e: any) {
          setRows((prev) =>
            prev.map((r) =>
              r.id === myId
                ? { ...r, status: "error", error: e?.message || "失败" }
                : r
            )
          );
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/merchants"] });
    setRunning(false);
    toast({ title: "批量分析完成" });
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function clearAll() {
    setRows([]);
    setParseErrors([]);
  }

  const queuedCount = rows.filter((r) => r.status === "queued").length;
  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const runningCount = rows.filter((r) => r.status === "running").length;

  return (
    <div className="bg-card border border-card-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Upload className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
            批量上传聊天记录
          </div>
          {rows.length > 0 && (
            <span className="text-[10.5px] text-muted-foreground">
              · 共 {rows.length} · 完成 {doneCount}
              {errorCount ? ` · 失败 ${errorCount}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              data-testid="button-batch-clear"
              onClick={clearAll}
              disabled={running}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              清空
            </button>
          )}
          <button
            data-testid="button-batch-pick"
            onClick={() => fileInputRef.current?.click()}
            disabled={running}
            className="px-3 py-1.5 text-[11.5px] rounded-md border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-3 h-3" />
            选择文件…
          </button>
          <button
            data-testid="button-batch-run"
            onClick={runBatch}
            disabled={queuedCount === 0 || running}
            className="px-3 py-1.5 text-[11.5px] rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                分析中 ({runningCount + doneCount + errorCount}/{rows.length})
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3" />
                启动分析 ({queuedCount})
              </>
            )}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.json,.jsonl,.csv,.log"
        multiple
        onChange={(e) => onFiles(e.target.files)}
        className="hidden"
        data-testid="input-batch-files"
      />

      {rows.length === 0 ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="border border-dashed border-border rounded-md px-4 py-8 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors"
        >
          <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
          <div className="text-[12.5px] font-medium">点击或拖拽上传聊天记录</div>
          <div className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
            支持 .txt · .json · .jsonl · .csv · .log
            <br />
            上传后逐条调用 LLM 分析，结果实时回写到商家工单列表。
          </div>
          <div className="text-[10.5px] text-muted-foreground mt-3">
            文本格式：每行 <code className="font-mono">商家: ...</code> /{" "}
            <code className="font-mono">机器人: ...</code> /{" "}
            <code className="font-mono">merchant: ...</code> /{" "}
            <code className="font-mono">bot: ...</code>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
          className="border border-border rounded-md divide-y divide-border max-h-96 overflow-auto"
        >
          {rows.map((r) => (
            <BatchRowItem key={r.id} row={r} onRemove={removeRow} disabled={running} />
          ))}
        </div>
      )}

      {parseErrors.length > 0 && (
        <div className="mt-3 space-y-1">
          {parseErrors.map((e, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 text-[11px] text-destructive"
            >
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{e}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchRowItem({
  row,
  onRemove,
  disabled,
}: {
  row: BatchRow;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const statusBadge = (() => {
    switch (row.status) {
      case "queued":
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground uppercase tracking-wider">
            待分析
          </span>
        );
      case "running":
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary uppercase tracking-wider inline-flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            分析中
          </span>
        );
      case "done":
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--chart-2))]/10 border border-[hsl(var(--chart-2))]/30 text-[hsl(var(--chart-2))] uppercase tracking-wider inline-flex items-center gap-1">
            <Check className="w-2.5 h-2.5" />
            完成
          </span>
        );
      case "error":
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 border border-destructive/30 text-destructive uppercase tracking-wider">
            失败
          </span>
        );
    }
  })();

  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] truncate flex items-center gap-2">
          <span>{row.fileName}</span>
          {row.externalId && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {row.externalId}
            </span>
          )}
        </div>
        <div className="text-[10.5px] text-muted-foreground truncate">
          {row.status === "done" && row.intent
            ? `意图: ${row.intent} · 状态: ${row.resolution}`
            : row.status === "error"
            ? row.error
            : `渠道: ${row.channel}${row.merchantId ? ` · 商家: ${row.merchantId}` : ""}`}
        </div>
      </div>
      {statusBadge}
      {row.status === "done" && row.conversationId && (
        <Link href={`/conversations/${row.conversationId}`}>
          <a
            data-testid={`link-conv-${row.conversationId}`}
            className="text-[10.5px] text-primary hover:underline inline-flex items-center gap-0.5"
          >
            查看
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </Link>
      )}
      <button
        onClick={() => onRemove(row.id)}
        disabled={disabled && row.status === "running"}
        className="text-muted-foreground hover:text-destructive disabled:opacity-30"
        data-testid={`button-batch-remove-${row.id}`}
      >
        <XIcon className="w-3 h-3" />
      </button>
    </div>
  );
}

// 解析单个文件为 1+ 通对话
function parseUploadedFile(
  fileName: string,
  raw: string
): Array<{ rawTranscript: string; channel?: string; externalId?: string; merchantId?: string }> {
  const lower = fileName.toLowerCase();
  // JSONL
  if (lower.endsWith(".jsonl")) {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    return lines.map((ln, i) => normalizeRecord(JSON.parse(ln), fileName, i));
  }
  // JSON
  if (lower.endsWith(".json")) {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) {
      return v.map((it, i) => normalizeRecord(it, fileName, i));
    }
    return [normalizeRecord(v, fileName, 0)];
  }
  // CSV: 需要 columns include transcript 或 raw_transcript
  if (lower.endsWith(".csv")) {
    return parseCsv(raw);
  }
  // 默认: 纯文本，整个文件一通对话
  const transcript = parseLines(raw.split(/\r?\n/).filter((l) => l.trim()));
  if (transcript.length === 0) return [];
  return [
    {
      rawTranscript: JSON.stringify(transcript),
      externalId: fileName.replace(/\.[^.]+$/, ""),
    },
  ];
}

function normalizeRecord(
  v: any,
  fileName: string,
  idx: number
): { rawTranscript: string; channel?: string; externalId?: string; merchantId?: string } {
  let rawTranscript: string;
  if (typeof v.rawTranscript === "string") {
    rawTranscript = v.rawTranscript;
  } else if (Array.isArray(v.transcript)) {
    // transcript: [{role, content, ts?}]
    rawTranscript = JSON.stringify(
      v.transcript.map((m: any, i: number) => ({
        role: normalizeRole(m.role),
        content: String(m.content ?? m.text ?? ""),
        ts: m.ts || `00:${(i * 12).toString().padStart(2, "0")}`,
      }))
    );
  } else if (Array.isArray(v.messages)) {
    rawTranscript = JSON.stringify(
      v.messages.map((m: any, i: number) => ({
        role: normalizeRole(m.role),
        content: String(m.content ?? m.text ?? ""),
        ts: m.ts || `00:${(i * 12).toString().padStart(2, "0")}`,
      }))
    );
  } else if (typeof v.transcript === "string") {
    rawTranscript = JSON.stringify(
      parseLines(v.transcript.split(/\r?\n/).filter((l: string) => l.trim()))
    );
  } else if (typeof v.text === "string") {
    rawTranscript = JSON.stringify(
      parseLines(v.text.split(/\r?\n/).filter((l: string) => l.trim()))
    );
  } else {
    throw new Error("记录缺少 transcript/messages/rawTranscript 字段");
  }
  return {
    rawTranscript,
    channel: v.channel,
    externalId: v.externalId || v.external_id || `${fileName.replace(/\.[^.]+$/, "")}-${idx + 1}`,
    merchantId: v.merchantId || v.merchant_id,
  };
}

function normalizeRole(r: any): string {
  const s = String(r || "").toLowerCase();
  if (["merchant", "seller", "user", "商家", "用户"].includes(s)) return "merchant";
  if (["bot", "assistant", "机器人"].includes(s)) return "bot";
  if (["agent", "human", "support", "人工", "客服"].includes(s)) return "human";
  return "merchant";
}

function parseCsv(
  raw: string
): Array<{ rawTranscript: string; channel?: string; externalId?: string; merchantId?: string }> {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const tIdx = headers.findIndex((h) =>
    ["transcript", "raw_transcript", "text", "content"].includes(h)
  );
  const eIdx = headers.findIndex((h) => ["external_id", "externalid", "ticket_id", "id"].includes(h));
  const mIdx = headers.findIndex((h) => ["merchant_id", "merchantid"].includes(h));
  const cIdx = headers.findIndex((h) => ["channel"].includes(h));
  if (tIdx < 0) throw new Error("CSV 需要 transcript / text / content 列");
  const out: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const text = cells[tIdx] || "";
    if (!text.trim()) continue;
    const transcript = parseLines(text.split(/\\n|\r?\n/).filter((l) => l.trim()));
    out.push({
      rawTranscript: JSON.stringify(transcript),
      externalId: eIdx >= 0 ? cells[eIdx] : undefined,
      merchantId: mIdx >= 0 ? cells[mIdx] : undefined,
      channel: cIdx >= 0 ? cells[cIdx] : undefined,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQ = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

// 共享解析逻辑
function parseLines(lines: string[]) {
  return lines.map((line, i) => {
    const mZh = line.match(/^(商家|用户|机器人|人工)[：:]\s*(.*)$/);
    const mEn = line.match(/^(merchant|seller|bot|agent|human)\s*[:：]\s*(.*)$/i);
    if (mZh) {
      const tag = mZh[1];
      const role = tag === "机器人" ? "bot" : tag === "人工" ? "human" : "merchant";
      return { role, content: mZh[2], ts: `00:${(i * 12).toString().padStart(2, "0")}` };
    }
    if (mEn) {
      const tag = mEn[1].toLowerCase();
      const role = tag === "bot" ? "bot" : tag === "agent" || tag === "human" ? "human" : "merchant";
      return { role, content: mEn[2], ts: `00:${(i * 12).toString().padStart(2, "0")}` };
    }
    return { role: "merchant", content: line, ts: `00:${(i * 12).toString().padStart(2, "0")}` };
  });
}
