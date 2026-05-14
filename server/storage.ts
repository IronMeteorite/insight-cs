import { conversations, recommendations, merchants, merchantEvents } from "@shared/schema";
import type {
  Conversation,
  InsertConversation,
  Recommendation,
  InsertRecommendation,
  Merchant,
  InsertMerchant,
  MerchantEvent,
  InsertMerchantEvent,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// 建表（首次启动）
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    merchant_region TEXT NOT NULL,
    channel TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'zh',
    category TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    turns INTEGER NOT NULL,
    raw_transcript TEXT NOT NULL,
    translated_transcript TEXT,
    primary_intent TEXT NOT NULL,
    intent_confidence REAL NOT NULL,
    emotion_start TEXT NOT NULL,
    emotion_end TEXT NOT NULL,
    emotion_trajectory TEXT NOT NULL,
    resolution_status TEXT NOT NULL,
    failure_type TEXT,
    failure_reason TEXT,
    satisfaction_score REAL,
    merchant_key_quote TEXT,
    tags TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    affected_count INTEGER NOT NULL,
    failure_pattern TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    evidence_conversation_ids TEXT NOT NULL,
    created_at TEXT NOT NULL,
    target_metric TEXT,
    target_category TEXT,
    target_failure_type TEXT,
    baseline_value REAL,
    baseline_window_days INTEGER DEFAULT 7,
    implemented_at TEXT,
    owner TEXT
  );
  CREATE TABLE IF NOT EXISTS merchants (
    merchant_id TEXT PRIMARY KEY,
    merchant_region TEXT NOT NULL,
    ticket_count INTEGER NOT NULL,
    unresolved_count INTEGER NOT NULL,
    escalated_count INTEGER NOT NULL,
    avg_satisfaction REAL NOT NULL,
    avg_emotion_end REAL NOT NULL,
    bad_case_rate REAL NOT NULL,
    churn_risk_score REAL NOT NULL,
    risk_tier TEXT NOT NULL,
    top_categories TEXT NOT NULL,
    top_failure_types TEXT NOT NULL,
    key_quotes TEXT NOT NULL,
    risk_narrative TEXT,
    recommended_action TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id TEXT NOT NULL,
    ticket_external_id TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    category TEXT NOT NULL,
    emotion_end TEXT NOT NULL,
    emotion_score REAL NOT NULL,
    resolution_status TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );
`);

// 兼容已有库：补齐新增列（IF NOT EXISTS 在 ALTER TABLE 上 SQLite 不支持，所以用 try）
function tryAddColumn(table: string, col: string, type: string) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  } catch {
    /* already exists */
  }
}
tryAddColumn("recommendations", "target_metric", "TEXT");
tryAddColumn("recommendations", "target_category", "TEXT");
tryAddColumn("recommendations", "target_failure_type", "TEXT");
tryAddColumn("recommendations", "baseline_value", "REAL");
tryAddColumn("recommendations", "baseline_window_days", "INTEGER DEFAULT 7");
tryAddColumn("recommendations", "implemented_at", "TEXT");
tryAddColumn("recommendations", "owner", "TEXT");

export const db = drizzle(sqlite);

// 只清空商家画像相关表（保留 conversations 和 recommendations）
export function resetMerchantData() {
  sqlite.exec(`
    DELETE FROM merchant_events;
    DELETE FROM merchants;
    DELETE FROM sqlite_sequence WHERE name = 'merchant_events';
  `);
  console.log("[storage] resetMerchantData: cleared merchants/merchant_events");
}

// 紧急复位:清空所有业务数据(保留表结构)。仅在启动检测到不完整/趟旧数据时调用。
export function resetAllData() {
  sqlite.exec(`
    DELETE FROM merchant_events;
    DELETE FROM merchants;
    DELETE FROM recommendations;
    DELETE FROM conversations;
    DELETE FROM sqlite_sequence WHERE name IN ('conversations','recommendations','merchant_events');
  `);
  console.log("[storage] resetAllData: cleared conversations/recommendations/merchants/merchant_events");
}

export interface IStorage {
  listConversations(): Promise<Conversation[]>;
  getConversation(id: number): Promise<Conversation | undefined>;
  createConversation(c: InsertConversation): Promise<Conversation>;
  listRecommendations(): Promise<Recommendation[]>;
  getRecommendation(id: number): Promise<Recommendation | undefined>;
  createRecommendation(r: InsertRecommendation): Promise<Recommendation>;
  updateRecommendation(id: number, patch: Partial<Recommendation>): Promise<Recommendation | undefined>;
  updateRecommendationStatus(id: number, status: string): Promise<Recommendation | undefined>;
  listMerchants(): Promise<Merchant[]>;
  getMerchant(id: string): Promise<Merchant | undefined>;
  upsertMerchant(m: InsertMerchant): Promise<Merchant>;
  listMerchantEvents(merchantId: string): Promise<MerchantEvent[]>;
  createMerchantEvent(e: InsertMerchantEvent): Promise<MerchantEvent>;
  replaceMerchantEvents(merchantId: string, events: InsertMerchantEvent[]): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async listConversations(): Promise<Conversation[]> {
    return db.select().from(conversations).orderBy(desc(conversations.startedAt)).all();
  }
  async getConversation(id: number): Promise<Conversation | undefined> {
    return db.select().from(conversations).where(eq(conversations.id, id)).get();
  }
  async createConversation(c: InsertConversation): Promise<Conversation> {
    return db.insert(conversations).values(c).returning().get();
  }
  async listRecommendations(): Promise<Recommendation[]> {
    return db.select().from(recommendations).orderBy(desc(recommendations.id)).all();
  }
  async createRecommendation(r: InsertRecommendation): Promise<Recommendation> {
    return db.insert(recommendations).values(r).returning().get();
  }
  async getRecommendation(id: number): Promise<Recommendation | undefined> {
    return db.select().from(recommendations).where(eq(recommendations.id, id)).get();
  }
  async updateRecommendation(id: number, patch: Partial<Recommendation>) {
    return db
      .update(recommendations)
      .set(patch)
      .where(eq(recommendations.id, id))
      .returning()
      .get();
  }
  async updateRecommendationStatus(id: number, status: string) {
    return db
      .update(recommendations)
      .set({ status })
      .where(eq(recommendations.id, id))
      .returning()
      .get();
  }
  async listMerchants(): Promise<Merchant[]> {
    return db.select().from(merchants).orderBy(desc(merchants.churnRiskScore)).all();
  }
  async getMerchant(id: string): Promise<Merchant | undefined> {
    return db.select().from(merchants).where(eq(merchants.merchantId, id)).get();
  }
  async upsertMerchant(m: InsertMerchant): Promise<Merchant> {
    const existing = await this.getMerchant(m.merchantId);
    if (existing) {
      return db
        .update(merchants)
        .set(m)
        .where(eq(merchants.merchantId, m.merchantId))
        .returning()
        .get();
    }
    return db.insert(merchants).values(m).returning().get();
  }
  async listMerchantEvents(merchantId: string): Promise<MerchantEvent[]> {
    return db
      .select()
      .from(merchantEvents)
      .where(eq(merchantEvents.merchantId, merchantId))
      .orderBy(desc(merchantEvents.occurredAt))
      .all();
  }
  async createMerchantEvent(e: InsertMerchantEvent): Promise<MerchantEvent> {
    return db.insert(merchantEvents).values(e).returning().get();
  }
  async replaceMerchantEvents(merchantId: string, events: InsertMerchantEvent[]): Promise<void> {
    db.delete(merchantEvents).where(eq(merchantEvents.merchantId, merchantId)).run();
    if (events.length === 0) return;
    db.insert(merchantEvents).values(events).run();
  }
}

export const storage = new DatabaseStorage();
