import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// 商家↔平台对话主表（跨境电商场景）
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(), // 平台工单/会话ID
  merchantId: text("merchant_id").notNull(), // 商家ID
  merchantRegion: text("merchant_region").notNull(), // CN / US / EU / SEA / LATAM / MEA
  channel: text("channel").notNull(), // seller_center / email / ticket / im
  language: text("language").notNull().default("zh"), // zh / en
  category: text("category").notNull(), // 招商入驻 / 店铺运营 / 商品合规 / 订单履约 / 物流时效 / 售后纠纷 / 广告投放 / 提现结算 / 政策申诉 / 账号风控
  startedAt: text("started_at").notNull(),
  durationSec: integer("duration_sec").notNull(),
  turns: integer("turns").notNull(), // 对话轮次
  rawTranscript: text("raw_transcript").notNull(), // JSON: [{role, content, ts}] 原文（可能为英文）
  translatedTranscript: text("translated_transcript"), // JSON: [{role, content, ts}] 中文翻译版（非中文对话必填）
  // LLM 分析结果
  primaryIntent: text("primary_intent").notNull(),
  intentConfidence: real("intent_confidence").notNull(),
  emotionStart: text("emotion_start").notNull(), // 中性/焦虑/愤怒/失望/满意
  emotionEnd: text("emotion_end").notNull(),
  emotionTrajectory: text("emotion_trajectory").notNull(), // JSON: [{turn, score}]
  resolutionStatus: text("resolution_status").notNull(), // resolved / unresolved / escalated / abandoned
  failureType: text("failure_type"), // knowledge_gap / routing_error / policy_limit / merchant_misunderstanding / systemic_unsolvable / null
  failureReason: text("failure_reason"), // LLM 解释
  satisfactionScore: real("satisfaction_score"), // 0-5
  merchantKeyQuote: text("merchant_key_quote"), // LLM 挑选的最具代表性商家原声金句
  tags: text("tags").notNull(), // JSON 字符串数组
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

// 知识库优化建议（已扩展为推荐闭环：状态 + 效果追踪）
export const recommendations = sqliteTable("recommendations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // knowledge_base / routing / policy
  title: text("title").notNull(),
  description: text("description").notNull(),
  affectedCount: integer("affected_count").notNull(), // 受影响的对话数
  failurePattern: text("failure_pattern").notNull(),
  priority: text("priority").notNull(), // high / medium / low
  status: text("status").notNull().default("pending"), // pending / accepted / in_progress / done / dismissed
  evidenceConversationIds: text("evidence_conversation_ids").notNull(), // JSON 数组
  createdAt: text("created_at").notNull(),
  // —— 闭环追踪字段 ——
  targetMetric: text("target_metric"), // bad_case_rate / escalation_rate / avg_csat
  targetCategory: text("target_category"), // 关联的业务场景（用于过滤效果计算）
  targetFailureType: text("target_failure_type"), // 关联的失败类型
  baselineValue: real("baseline_value"), // 实施前 7 天的指标基线
  baselineWindowDays: integer("baseline_window_days").default(7),
  implementedAt: text("implemented_at"), // 状态切换到 in_progress 的时刻
  owner: text("owner"), // 负责人
});

export const insertRecommendationSchema = createInsertSchema(recommendations).omit({
  id: true,
});
export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type Recommendation = typeof recommendations.$inferSelect;

// 商家画像（从 conversations 聚合而来）
export const merchants = sqliteTable("merchants", {
  merchantId: text("merchant_id").primaryKey(),
  merchantRegion: text("merchant_region").notNull(),
  ticketCount: integer("ticket_count").notNull(),
  unresolvedCount: integer("unresolved_count").notNull(),
  escalatedCount: integer("escalated_count").notNull(),
  avgSatisfaction: real("avg_satisfaction").notNull(),
  avgEmotionEnd: real("avg_emotion_end").notNull(),
  badCaseRate: real("bad_case_rate").notNull(),
  churnRiskScore: real("churn_risk_score").notNull(), // 0~1
  riskTier: text("risk_tier").notNull(), // critical / high / medium / low
  topCategories: text("top_categories").notNull(), // JSON [{ category, count }]
  topFailureTypes: text("top_failure_types").notNull(), // JSON [{ type, count }]
  keyQuotes: text("key_quotes").notNull(), // JSON [{ quote, ticketId, emotion }]
  riskNarrative: text("risk_narrative"), // LLM 生成的画像总结（一段话）
  recommendedAction: text("recommended_action"), // LLM 生成的下一步动作建议
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertMerchantSchema = createInsertSchema(merchants);
export type InsertMerchant = z.infer<typeof insertMerchantSchema>;
export type Merchant = typeof merchants.$inferSelect;

// 商家事件流（轨迹时间线用）
export const merchantEvents = sqliteTable("merchant_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  merchantId: text("merchant_id").notNull(),
  ticketExternalId: text("ticket_external_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  eventType: text("event_type").notNull(), // complaint / escalation / resolution / churn_signal
  category: text("category").notNull(),
  emotionEnd: text("emotion_end").notNull(),
  emotionScore: real("emotion_score").notNull(),
  resolutionStatus: text("resolution_status").notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const insertMerchantEventSchema = createInsertSchema(merchantEvents).omit({ id: true });
export type InsertMerchantEvent = z.infer<typeof insertMerchantEventSchema>;
export type MerchantEvent = typeof merchantEvents.$inferSelect;
