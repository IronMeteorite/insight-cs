/**
 * 把 183 个一次性工单重新映射到 ~20 个"主力商家"
 *
 * 现有 seed 数据每条工单一个独立 merchantId,无法体现"商家关系"。
 * 这个脚本按"区域 + 主要业务"建立 20 个虚拟商家 persona,
 * 然后把现有工单按业务场景哈希分配过去,模拟真实多工单场景。
 *
 * 用法: tsx scripts/remap-merchants.ts
 */
import Database from "better-sqlite3";

const PERSONAS = [
  // 中国大陆 - 主力商家(高工单量)
  { id: "M-CN-001", name: "深圳3C旗舰", region: "CN", weights: { 商品合规: 3, 物流时效: 3, 广告投放: 2, 提现结算: 2, 招商入驻: 1 } },
  { id: "M-CN-002", name: "义乌小商品批发", region: "CN", weights: { 招商入驻: 3, 店铺运营: 3, 商品合规: 2, 政策申诉: 2 } },
  { id: "M-CN-003", name: "广州女装快反", region: "CN", weights: { 售后纠纷: 3, 订单履约: 3, 物流时效: 2, 店铺运营: 2 } },
  { id: "M-CN-004", name: "杭州美妆DTC", region: "CN", weights: { 广告投放: 3, 商品合规: 2, 提现结算: 2, 政策申诉: 2 } },
  { id: "M-CN-005", name: "东莞家居供应链", region: "CN", weights: { 订单履约: 3, 物流时效: 3, 售后纠纷: 2 } },
  { id: "M-CN-006", name: "上海跨境母婴", region: "CN", weights: { 商品合规: 3, 招商入驻: 2, 账号风控: 2, 政策申诉: 2 } },
  { id: "M-CN-007", name: "厦门保健品", region: "CN", weights: { 商品合规: 3, 政策申诉: 3, 账号风控: 2 } },
  { id: "M-CN-008", name: "宁波运动户外", region: "CN", weights: { 店铺运营: 3, 广告投放: 3, 物流时效: 2 } },
  { id: "M-CN-009", name: "成都数码配件", region: "CN", weights: { 广告投放: 3, 商品合规: 2, 售后纠纷: 2 } },
  { id: "M-CN-010", name: "佛山家电出海", region: "CN", weights: { 物流时效: 3, 售后纠纷: 3, 提现结算: 2 } },

  // 美国 - 头部商家
  { id: "M-US-001", name: "LA Streetwear Studio", region: "US", weights: { 招商入驻: 3, 店铺运营: 2, 商品合规: 2 } },
  { id: "M-US-002", name: "NYC Beauty Indie", region: "US", weights: { 广告投放: 3, 商品合规: 2, 售后纠纷: 2 } },
  { id: "M-US-003", name: "Texas Outdoor Gear", region: "US", weights: { 订单履约: 3, 物流时效: 3 } },
  { id: "M-US-004", name: "Miami Wellness Brand", region: "US", weights: { 商品合规: 3, 政策申诉: 2, 账号风控: 2 } },

  // 欧洲
  { id: "M-EU-001", name: "Berlin Sustainable", region: "EU", weights: { 商品合规: 3, 招商入驻: 2 } },
  { id: "M-EU-002", name: "London Fashion Tech", region: "EU", weights: { 广告投放: 2, 店铺运营: 2, 商品合规: 2 } },

  // 东南亚 / 拉美 / 中东
  { id: "M-SEA-001", name: "Jakarta Halal Foods", region: "SEA", weights: { 招商入驻: 3, 商品合规: 3 } },
  { id: "M-SEA-002", name: "Bangkok Mobile Accessories", region: "SEA", weights: { 物流时效: 3, 售后纠纷: 2 } },
  { id: "M-LATAM-001", name: "Mexico City Electronics", region: "LATAM", weights: { 物流时效: 3, 售后纠纷: 2, 政策申诉: 2 } },
  { id: "M-MEA-001", name: "Dubai Luxury Retail", region: "MEA", weights: { 招商入驻: 2, 广告投放: 2, 政策申诉: 2 } },
];

// 把工单分配给最匹配的商家:
//  1) 必须同区域
//  2) 在同区域里,按 category 权重做加权随机
function pickMerchant(region: string, category: string): string {
  const eligible = PERSONAS.filter((p) => p.region === region);
  if (eligible.length === 0) {
    return PERSONAS[Math.floor(Math.random() * PERSONAS.length)].id;
  }
  // 加权打分
  const scored = eligible.map((p) => ({
    id: p.id,
    score: (p.weights as Record<string, number>)[category] || 1,
  }));
  const total = scored.reduce((s, x) => s + x.score, 0);
  let r = Math.random() * total;
  for (const s of scored) {
    r -= s.score;
    if (r <= 0) return s.id;
  }
  return scored[0].id;
}

export function runRemap() {
  const db = new Database("data.db");
  db.pragma("journal_mode = WAL");

  // 读所有 conversations,按区域+category 分配到 personas
  const rows = db
    .prepare("SELECT id, merchant_region, category FROM conversations")
    .all() as { id: number; merchant_region: string; category: string }[];

  console.log(`[remap] ${rows.length} conversations to remap`);

  const updateStmt = db.prepare(
    "UPDATE conversations SET merchant_id = ? WHERE id = ?"
  );
  const tx = db.transaction((items: { id: number; merchant_region: string; category: string }[]) => {
    for (const r of items) {
      const newId = pickMerchant(r.merchant_region, r.category);
      updateStmt.run(newId, r.id);
    }
  });
  tx(rows);

  // 统计分布
  const dist = db
    .prepare("SELECT merchant_id, COUNT(*) as cnt FROM conversations GROUP BY merchant_id ORDER BY cnt DESC")
    .all() as { merchant_id: string; cnt: number }[];

  console.log(`[remap] new merchant distribution (${dist.length} merchants):`);
  dist.forEach((d) => console.log(`  ${d.merchant_id}: ${d.cnt} tickets`));

  db.close();
  console.log("[remap] done");
}

// CLI 直接跱时走 main
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /remap-merchants/.test(process.argv[1]);

if (isDirectRun) {
  runRemap();
  console.log("now run: npx tsx scripts/aggregate-merchants.ts");
}
