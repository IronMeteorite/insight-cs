import { storage, resetAllData } from "./storage";
import type { InsertConversation, InsertRecommendation } from "@shared/schema";

// ====== 跨境电商商家↔平台 对话语境定义 ======

const CATEGORIES = [
  "招商入驻",
  "店铺运营",
  "商品合规",
  "订单履约",
  "物流时效",
  "售后纠纷",
  "广告投放",
  "提现结算",
  "政策申诉",
  "账号风控",
];

const CHANNELS = ["seller_center", "email", "ticket", "im"];
const REGIONS = ["CN", "US", "EU", "SEA", "LATAM", "MEA"];

const INTENTS: Record<string, string[]> = {
  招商入驻: ["资质审核进度", "类目准入申请", "保证金减免", "VAT 资料提交", "店铺类型变更"],
  店铺运营: ["店铺评分异常", "限时活动报名", "类目变更申请", "店铺装修审核", "运营指标解读"],
  商品合规: ["商品下架申诉", "品牌授权审核", "认证材料补正", "商品标题违规", "禁售品类申诉"],
  订单履约: ["大批量发货异常", "订单取消纠纷", "履约时效考核", "订单数据导出失败", "异常订单拦截"],
  物流时效: ["头程清关延误", "尾程派送丢件", "海外仓 SLA 异常", "物流追踪号失效", "物流时效申诉"],
  售后纠纷: ["买家恶意退款", "差评申诉", "纠纷举证驳回", "强制退款扣款", "假货举报申诉"],
  广告投放: ["广告账户余额异常", "竞价点击异常", "推广位审核驳回", "ROI 数据延迟", "广告权限被冻结"],
  提现结算: ["结算延迟", "汇率扣损争议", "提现失败", "账期变更", "税费代扣明细"],
  政策申诉: ["违规扣分申诉", "政策更新解读", "处罚减免申请", "申诉材料补交", "申诉超期"],
  账号风控: ["账号被风控", "二次验证失败", "关联账号申诉", "登录IP异常", "员工账号权限"],
};

// 每个 intent 对应一段商家原声（中/英两份，结构对齐）
type DialogueTemplate = {
  zh: { open: string; mid: string; escalation?: string };
  en: { open: string; mid: string; escalation?: string };
};

const DIALOGUE: Record<string, DialogueTemplate> = {
  资质审核进度: {
    zh: {
      open: "你好，我们公司 7 天前提交了入驻资质，审核状态一直是「待审核」，能帮我催一下吗?销售旺季快到了。",
      mid: "我已经把营业执照、品牌授权书都上传齐了,客服每次都说在排队,我们这边对接的供应商都在催。",
      escalation: "如果再不审核完,我们这一季的订单全要黄了。这边能不能给个明确时间?",
    },
    en: {
      open: "Hi team, our shop registration has been stuck on 'Pending Review' for 7 days. Peak season is coming, can you please escalate?",
      mid: "All my documents are uploaded — business license, brand authorization, all of them. Every time I ask I get the same 'in queue' response.",
      escalation: "If this drags on any longer we will miss the whole launch window. Can you commit to a concrete date?",
    },
  },
  商品下架申诉: {
    zh: {
      open: "我有 23 个 SKU 今天凌晨被批量下架,理由是「图片含违规元素」,但这些图我们用了大半年了。",
      mid: "申诉通道里只能选「申请复审」,没有任何途径上传补充材料,系统给的回复也是模板,根本没人看。",
      escalation: "这一批商品占我们 GMV 的 40%,每多挂一天就是几万美金的损失,请人工介入。",
    },
    en: {
      open: "23 SKUs were taken down overnight for 'image contains non-compliant elements'. These images have been live for 6+ months.",
      mid: "The appeal portal only offers a single 'Request Re-review' button, no way to attach evidence, and replies are template-only.",
      escalation: "These products are 40% of my GMV. Every day offline costs us tens of thousands of dollars. I need a human reviewer.",
    },
  },
  头程清关延误: {
    zh: {
      open: "我们 4 月 28 号发的头程货柜,现在还卡在目的港海关,平台的物流追踪一直显示「在途」。",
      mid: "我联系了货代,他说是平台对接的清关行资料不全,但平台说应该问货代。两边踢皮球。",
      escalation: "我的海外仓库存已经断货 4 天,买家下单后无法发货,店铺评分一直在掉,这种情况能不能减免考核?",
    },
    en: {
      open: "Our first-mile container shipped on April 28 is still stuck at destination customs. Platform tracking still shows 'In Transit'.",
      mid: "My forwarder says the platform's customs broker filed incomplete docs. The platform says ask the forwarder. Nobody owns this.",
      escalation: "Overseas warehouse has been out of stock 4 days. Buyers can't be shipped. Store rating is dropping. Can the SLA penalty be waived?",
    },
  },
  买家恶意退款: {
    zh: {
      open: "有个买家收货 28 天后申请仅退款,理由是「商品有异味」,但物流显示已签收,他从来没有联系过我们。",
      mid: "我提交了开箱视频、第三方检测报告作为举证,平台 4 小时就驳回了,说证据不足。",
      escalation: "这种「先收货,再仅退款,不退货」的恶意操作我这个月遇到 6 次了,平台为什么不保护商家?",
    },
    en: {
      open: "A buyer requested a refund-only 28 days after delivery, claiming 'product has odor'. Tracking shows delivered. He never contacted us first.",
      mid: "I submitted unboxing video plus a third-party inspection report. The platform rejected it in 4 hours citing 'insufficient evidence'.",
      escalation: "This 'keep the goods, get a refund' fraud happened 6 times this month. Why is there no seller protection?",
    },
  },
  广告账户余额异常: {
    zh: {
      open: "我昨晚 23 点充值了 5000 美金到广告账户,到现在还没到账,广告全停了。",
      mid: "银行那边显示已经扣款,流水号我都提供了,但平台系统一直显示「处理中」。",
      escalation: "我现在所有的广告计划都暂停了,Q2 大促预热全卡住,损失能不能赔?",
    },
    en: {
      open: "I topped up $5,000 to my ad account at 11pm last night. Still not credited. All campaigns are paused.",
      mid: "Bank confirms the charge went through and I provided the transaction ID, but your system still says 'Processing'.",
      escalation: "Every campaign is dark right now and we lost the Q2 pre-launch window. Will the platform compensate?",
    },
  },
  结算延迟: {
    zh: {
      open: "本周应该结算的 12,400 美金到现在没打款,账期已经过了 3 天。",
      mid: "财务那边一直催,我看后台显示「结算待处理」,但没有任何说明为什么延迟。",
      escalation: "我们供应商付款全靠这笔回款,再不到账下个月备货都成问题。",
    },
    en: {
      open: "This week's $12,400 settlement still hasn't been paid out. The cycle date passed 3 days ago.",
      mid: "Finance is pressing me. Dashboard shows 'Settlement Pending' but no reason given.",
      escalation: "Our supplier payments depend on this. If it doesn't land, next month's restocking is at risk.",
    },
  },
  违规扣分申诉: {
    zh: {
      open: "我的店铺上周被扣了 6 分,理由是「虚假发货」,但实际是物流商揽收后没及时上传扫描信息。",
      mid: "我提供了物流商的官方证明信,系统申诉两次都被驳回,理由都是「材料不足」,但根本没说缺哪些材料。",
      escalation: "扣 6 分会直接限制我下一季活动报名,这个责任不在我,请人工复核。",
    },
    en: {
      open: "My store was penalized 6 points last week for 'fake shipment'. Truth is the carrier picked up but uploaded scans late.",
      mid: "I submitted the carrier's official statement, appealed twice — both rejected with 'insufficient material' and no specifics.",
      escalation: "6 points blocks me from next-season campaign registration. The fault is not mine. I need human review.",
    },
  },
  账号被风控: {
    zh: {
      open: "今天早上登录卖家中心提示「账号已被风控,功能受限」,但我没收到任何通知。",
      mid: "客服回复说是「检测到异常登录」,但我们一直是在同一个 IP 登录,设备也没换。",
      escalation: "现在所有发货、客服回复都做不了,买家不停催,这种情况能不能先解封,后核查?",
    },
    en: {
      open: "This morning Seller Center says 'Account under risk control, features restricted'. I got zero notification.",
      mid: "Your team says 'abnormal login detected', but we log in from the same office IP every day, same devices.",
      escalation: "I can't ship orders or reply to buyers. Can you lift restrictions first and investigate after?",
    },
  },
  限时活动报名: {
    zh: {
      open: "我们想报名下周的母亲节大促,提交了 3 次都被驳回,但驳回原因写的是「不符合品类要求」,我们就是美妆品类。",
      mid: "看了活动规则也没说哪条不符,客服回复也是模板,没法定位问题。",
    },
    en: {
      open: "We tried to register for next week's Mother's Day campaign three times — rejected every time with 'category mismatch'. We are beauty, which is on the allowed list.",
      mid: "The rules page doesn't say which clause we fail. Your support reply is template. I can't even debug this.",
    },
  },
  VAT资料提交: {
    zh: {
      open: "欧盟 VAT 资料我已经按指引上传了,但状态一直是「待审核」,影响我开店。",
      mid: "上传的是德国税号证明和申报回执,格式都是官方的 PDF。",
    },
    en: {
      open: "I uploaded my EU VAT documents as instructed but the status is stuck at 'Pending Review'. Blocks my onboarding.",
      mid: "I uploaded the German tax number certificate and the filing receipt — both official PDFs.",
    },
  },
};

// 默认 fallback dialogue for intents without explicit template
const DEFAULT_DIALOGUE: DialogueTemplate = {
  zh: {
    open: "你好,我想咨询「{intent}」相关的问题,这边已经影响到我们正常经营了,麻烦帮忙处理一下。",
    mid: "我之前已经按指引操作过,但系统反馈一直是模板回复,没人真正看我的工单。",
    escalation: "这件事再拖下去,我们这个月的目标都要受影响,请尽快人工介入。",
  },
  en: {
    open: "Hi, I need help with a '{intent}' issue. This is already affecting our daily operations.",
    mid: "I followed the instructions, but the system keeps replying with templates and no one actually reads the ticket.",
    escalation: "If this drags on it will hit this month's targets. Please escalate to a human.",
  },
};

// 失败类型库 — 商家场景
const FAILURE_TYPES = [
  {
    type: "knowledge_gap",
    reason: "活动报名规则未结构化入库,机器人重复返回模板答复,商家无法定位具体不符的条款。",
    reasonEn: "Campaign eligibility rules are not in the KB. Bot returns templates only — merchant cannot locate the failing clause.",
  },
  {
    type: "knowledge_gap",
    reason: "海外仓 SLA 与跨境物流细则缺乏 FAQ,机器人对清关延误场景给出泛化回答。",
    reasonEn: "Overseas warehouse SLA & customs rules are absent from KB. Bot answers customs-delay queries with generic copy.",
  },
  {
    type: "routing_error",
    reason: "涉及结算/财务的工单被错误路由至运营组,响应时长超 24 小时。",
    reasonEn: "Settlement tickets are mis-routed to the operations team, response time exceeds 24h.",
  },
  {
    type: "routing_error",
    reason: "海外商家的英文工单被识别为低优先级,默认进入机器人队列,未直转双语人工。",
    reasonEn: "English tickets from overseas merchants are flagged low-priority and stay in the bot queue instead of bilingual human agents.",
  },
  {
    type: "policy_limit",
    reason: "买家恶意退款举证规则只允许提交 3 类材料,商家的开箱视频+第三方检测被系统判定「材料不足」。",
    reasonEn: "The fraudulent-refund policy only accepts 3 evidence types — unboxing video + third-party inspection are auto-classified as 'insufficient'.",
  },
  {
    type: "policy_limit",
    reason: "违规扣分申诉超过 7 天窗口直接拒绝,未考虑物流商上传延迟等非商家过失情形。",
    reasonEn: "Penalty appeals past the 7-day window are auto-rejected, ignoring no-fault cases like carrier upload lag.",
  },
  {
    type: "merchant_misunderstanding",
    reason: "商家把头程货代延误的责任归到平台,实际归属于第三方,但平台未在前置提示中区分。",
    reasonEn: "Merchant attributes first-mile delays to the platform, while the actual owner is the 3PL — platform UI doesn't disambiguate.",
  },
  {
    type: "systemic_unsolvable",
    reason: "广告余额同步依赖银行通道,T+1 才回写,平台侧无法实时回复商家。",
    reasonEn: "Ad balance sync relies on bank rails (T+1). The platform has no real-time visibility to reply with.",
  },
  {
    type: "systemic_unsolvable",
    reason: "结算延迟根源在外部支付通道排队,平台只能等回写,无法给出具体到账时间。",
    reasonEn: "Settlement delay roots in the external payment rail queue. The platform can only wait, no ETA available.",
  },
];

const EMOTIONS_NEG = ["焦虑", "失望", "愤怒"];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function platformReplyZh(intent: string, escalated: boolean): string {
  if (escalated) {
    return "您好,我是商家支持高级顾问,已加急,会在 4 小时内回复您处理结果。";
  }
  const replies = [
    `您好,您提到的「${intent}」问题已记录,系统会在 48 小时内反馈,请关注站内信。`,
    `感谢反馈,根据当前规则,您的情况属于「待审核」状态,请耐心等待。`,
    `我已为您查到相关工单,目前在排队处理中,完成后会同步至您注册邮箱。`,
    `这是平台通用流程,建议您参考帮助中心《商家自助指引》操作,如仍有问题再联系我们。`,
  ];
  return rand(replies);
}

function platformReplyEn(intent: string, escalated: boolean): string {
  if (escalated) {
    return "Hi, this is a senior seller support specialist. Your case has been escalated and you will get an update within 4 hours.";
  }
  const replies = [
    `Hello, your '${intent}' issue has been logged. The system will reply within 48 hours — please monitor your seller inbox.`,
    `Thanks for the report. Per current policy your case is 'Pending Review'. Please bear with us.`,
    `I located your ticket. It is currently in the processing queue. The outcome will be sent to your registered email.`,
    `This is a standard platform flow. Please refer to the Help Center 'Seller Self-Service Guide'. Contact us again if it persists.`,
  ];
  return rand(replies);
}

// 中文翻译版的英文平台回复
function platformReplyEnTranslated(intent: string, escalated: boolean): string {
  if (escalated) {
    return "您好,我是商家支持高级顾问,您的工单已升级,4 小时内会同步处理结果。";
  }
  const replies = [
    `您好,您的「${intent}」问题已登记。系统将在 48 小时内回复,请留意卖家邮箱。`,
    `感谢反馈。按现行政策您的工单状态为「待审核」,请耐心等待。`,
    `已找到您的工单,目前在处理队列中。结果会发送到您注册的邮箱。`,
    `这是平台标准流程。请参考帮助中心《商家自助指引》。如仍有问题请再联系我们。`,
  ];
  return rand(replies);
}

type Turn = { role: string; content: string; ts: string };

function buildTranscriptZh(intent: string, turns: number, resolved: boolean, escalated: boolean): Turn[] {
  const t = DIALOGUE[intent]?.zh ?? DEFAULT_DIALOGUE.zh;
  const opener = t.open.replace("{intent}", intent);
  const mid = t.mid.replace("{intent}", intent);
  const esc = (t.escalation || DEFAULT_DIALOGUE.zh.escalation!).replace("{intent}", intent);

  const out: Turn[] = [
    { role: "merchant", content: opener, ts: "00:00" },
    { role: "bot", content: platformReplyZh(intent, false), ts: "00:08" },
  ];
  if (turns >= 4) {
    out.push({ role: "merchant", content: mid, ts: "00:30" });
    out.push({ role: "bot", content: platformReplyZh(intent, false), ts: "00:45" });
  }
  if (turns >= 6) {
    out.push({ role: "merchant", content: esc, ts: "01:15" });
    out.push({
      role: escalated || resolved ? "human" : "bot",
      content:
        resolved || escalated
          ? platformReplyZh(intent, true)
          : "非常抱歉,目前没有额外信息可提供,建议您稍后再次联系我们。",
      ts: "01:35",
    });
  }
  if (turns >= 8 && !resolved && !escalated) {
    out.push({ role: "merchant", content: "每次都是模板,请直接告诉我具体卡在哪个环节?", ts: "02:10" });
    out.push({ role: "bot", content: "已记录您的反馈,会有专员后续跟进。", ts: "02:25" });
  }
  return out;
}

function buildTranscriptEn(intent: string, turns: number, resolved: boolean, escalated: boolean): { en: Turn[]; zh: Turn[] } {
  const tEn = DIALOGUE[intent]?.en ?? DEFAULT_DIALOGUE.en;
  const tZh = DIALOGUE[intent]?.zh ?? DEFAULT_DIALOGUE.zh;
  const openerEn = tEn.open.replace("{intent}", intent);
  const openerZh = tZh.open.replace("{intent}", intent);
  const midEn = tEn.mid.replace("{intent}", intent);
  const midZh = tZh.mid.replace("{intent}", intent);
  const escEn = (tEn.escalation || DEFAULT_DIALOGUE.en.escalation!).replace("{intent}", intent);
  const escZh = (tZh.escalation || DEFAULT_DIALOGUE.zh.escalation!).replace("{intent}", intent);

  const en: Turn[] = [
    { role: "merchant", content: openerEn, ts: "00:00" },
    { role: "bot", content: platformReplyEn(intent, false), ts: "00:08" },
  ];
  const zh: Turn[] = [
    { role: "merchant", content: openerZh, ts: "00:00" },
    { role: "bot", content: platformReplyEnTranslated(intent, false), ts: "00:08" },
  ];

  if (turns >= 4) {
    en.push({ role: "merchant", content: midEn, ts: "00:30" });
    en.push({ role: "bot", content: platformReplyEn(intent, false), ts: "00:45" });
    zh.push({ role: "merchant", content: midZh, ts: "00:30" });
    zh.push({ role: "bot", content: platformReplyEnTranslated(intent, false), ts: "00:45" });
  }
  if (turns >= 6) {
    en.push({ role: "merchant", content: escEn, ts: "01:15" });
    zh.push({ role: "merchant", content: escZh, ts: "01:15" });
    if (resolved || escalated) {
      en.push({ role: "human", content: platformReplyEn(intent, true), ts: "01:35" });
      zh.push({ role: "human", content: platformReplyEnTranslated(intent, true), ts: "01:35" });
    } else {
      en.push({
        role: "bot",
        content: "Apologies, no additional info is available right now. Please contact us again later.",
        ts: "01:35",
      });
      zh.push({
        role: "bot",
        content: "非常抱歉,目前没有额外信息可以提供,建议您稍后再次联系我们。",
        ts: "01:35",
      });
    }
  }
  if (turns >= 8 && !resolved && !escalated) {
    en.push({
      role: "merchant",
      content: "Every reply is a template. Tell me exactly which step is blocking us.",
      ts: "02:10",
    });
    en.push({ role: "bot", content: "Your feedback has been logged. A specialist will follow up.", ts: "02:25" });
    zh.push({ role: "merchant", content: "每次回复都是模板,请告诉我究竟卡在哪一步?", ts: "02:10" });
    zh.push({ role: "bot", content: "您的反馈已记录,会有专员跟进。", ts: "02:25" });
  }
  return { en, zh };
}

function buildTrajectory(start: string, end: string, turns: number) {
  const scoreMap: Record<string, number> = {
    满意: 0.8,
    中性: 0.5,
    焦虑: 0.3,
    失望: 0.2,
    愤怒: 0.05,
  };
  const s = scoreMap[start];
  const e = scoreMap[end];
  return Array.from({ length: turns }, (_, i) => ({
    turn: i + 1,
    score: +(s + ((e - s) * i) / Math.max(turns - 1, 1) + (Math.random() - 0.5) * 0.08).toFixed(2),
  }));
}

export async function runSeed() {
  const existing = await storage.listConversations();
  // 幂等保护:完整 seed 为 180 条。若存量 < 150 视为不完整 / 趟旧数据,清空后重新 seed。
  if (existing.length >= 150) {
    console.log(`已存在 ${existing.length} 条对话,跳过种子。`);
    return;
  }
  if (existing.length > 0) {
    console.log(`[seed] 检测到不完整数据 (${existing.length} 条,< 150),执行 reset 后重新 seed...`);
    resetAllData();
  }

  const now = new Date("2026-05-11T20:00:00+08:00");
  const total = 180;
  for (let i = 0; i < total; i++) {
    const category = rand(CATEGORIES);
    const intent = rand(INTENTS[category]);
    const channel = rand(CHANNELS);
    // ~25% 英文
    const isEnglish = Math.random() < 0.25;
    const language = isEnglish ? "en" : "zh";
    const region = isEnglish ? rand(["US", "EU", "SEA", "LATAM", "MEA"]) : rand(["CN", "SEA"]);
    const turns = randInt(3, 12);
    const duration = turns * randInt(20, 80);

    // 大约 50% 未解决
    const r = Math.random();
    let resolutionStatus: string;
    let failure: typeof FAILURE_TYPES[number] | null = null;
    if (r < 0.4) {
      resolutionStatus = "resolved";
    } else if (r < 0.68) {
      resolutionStatus = "unresolved";
      failure = rand(FAILURE_TYPES);
    } else if (r < 0.9) {
      resolutionStatus = "escalated";
      failure = rand(FAILURE_TYPES);
    } else {
      resolutionStatus = "abandoned";
      failure = rand(FAILURE_TYPES);
    }

    const emotionStart = rand(["中性", "焦虑", "失望"]);
    const emotionEnd =
      resolutionStatus === "resolved"
        ? rand(["满意", "中性"])
        : rand(EMOTIONS_NEG);

    const startedDate = new Date(now.getTime() - randInt(0, 14 * 24 * 60) * 60 * 1000);

    let rawTranscript: Turn[];
    let translatedTranscript: Turn[] | null = null;

    if (isEnglish) {
      const built = buildTranscriptEn(
        intent,
        turns,
        resolutionStatus === "resolved",
        resolutionStatus === "escalated"
      );
      rawTranscript = built.en;
      translatedTranscript = built.zh;
    } else {
      rawTranscript = buildTranscriptZh(
        intent,
        turns,
        resolutionStatus === "resolved",
        resolutionStatus === "escalated"
      );
    }

    const conv: InsertConversation = {
      externalId: `TKT-${100000 + i}`,
      merchantId: `M${randInt(10000, 99999)}`,
      merchantRegion: region,
      channel,
      language,
      category,
      startedAt: startedDate.toISOString(),
      durationSec: duration,
      turns,
      rawTranscript: JSON.stringify(rawTranscript),
      translatedTranscript: translatedTranscript ? JSON.stringify(translatedTranscript) : null,
      primaryIntent: intent,
      intentConfidence: +(0.72 + Math.random() * 0.27).toFixed(2),
      emotionStart,
      emotionEnd,
      emotionTrajectory: JSON.stringify(buildTrajectory(emotionStart, emotionEnd, turns)),
      resolutionStatus,
      failureType: failure?.type ?? null,
      failureReason: failure?.reason ?? null,
      satisfactionScore:
        resolutionStatus === "resolved"
          ? +(3.5 + Math.random() * 1.5).toFixed(1)
          : +(1 + Math.random() * 2).toFixed(1),
      tags: JSON.stringify([category, intent, channel, region, language]),
    };
    await storage.createConversation(conv);
  }

  // 种子优化建议 — 商家场景
  const recs: InsertRecommendation[] = [
    {
      type: "knowledge_base",
      title: "结构化「活动报名驳回理由」知识,精确到条款",
      description:
        "近 14 天有 21 通对话集中在「限时活动报名被驳回但不知具体条款」上,机器人全部返回「不符合品类要求」模板。建议改造活动驳回链路,系统返回时直接命中具体规则条款 ID,并在知识库挂 8 条原子 FAQ 解释每条条款。",
      affectedCount: 21,
      failurePattern: "knowledge_gap · 活动报名规则",
      priority: "high",
      status: "pending",
      evidenceConversationIds: "[1,5,12,18,24]",
      createdAt: new Date().toISOString(),
    },
    {
      type: "routing",
      title: "英文工单首轮直转双语人工",
      description:
        "海外商家英文工单平均轮次 7.8,机器人解决率仅 19%,且情绪指数下滑 0.32。建议将语言识别为 en/non-zh 的工单首轮即进入双语人工队列,跳过机器人尝试。",
      affectedCount: 33,
      failurePattern: "routing_error · 英文工单路由",
      priority: "high",
      status: "pending",
      evidenceConversationIds: "[3,7,22,33]",
      createdAt: new Date().toISOString(),
    },
    {
      type: "policy",
      title: "扩充买家恶意退款举证材料类型",
      description:
        "现行政策仅接受 3 类举证,商家提交的「开箱视频+第三方检测报告」被系统判定材料不足。建议把这 2 类纳入合规举证清单,并在前置 UI 中明示。",
      affectedCount: 17,
      failurePattern: "policy_limit · 恶意退款举证",
      priority: "medium",
      status: "pending",
      evidenceConversationIds: "[9,15,28]",
      createdAt: new Date().toISOString(),
    },
    {
      type: "knowledge_base",
      title: "补齐海外仓 SLA 与清关延误 FAQ",
      description:
        "商家高频询问头程清关、海外仓 SLA 异常归属,但相关 FAQ 仅有 4 条,且未区分平台/3PL/货代责任。建议联动物流中台拉齐 12 条结构化 FAQ。",
      affectedCount: 14,
      failurePattern: "knowledge_gap · 物流责任归属",
      priority: "medium",
      status: "pending",
      evidenceConversationIds: "[4,11]",
      createdAt: new Date().toISOString(),
    },
  ];
  for (const r of recs) await storage.createRecommendation(r);

  console.log(`已种子 ${total} 通对话、${recs.length} 条建议。`);
}

// 不再自启动；由 server/index.ts 显式 await runSeed() 调用，保证 seed -> aggregate 的顺序
