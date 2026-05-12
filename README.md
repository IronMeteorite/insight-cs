# Insight CS

> 跨境电商商家客服对话的智能分析平台 — 自动归类诉求、识别失效根因、追踪情绪轨迹、闭环优化建议。

基于 **React 18 + Express 4 + SQLite + DeepSeek** 构建,单仓 monorepo,一份 bundle 跑前后端。

---

## 核心能力

- **工单智能归档** — LLM 一次推理产出主意图、失效根因、解决状态、情绪轨迹、CSAT 推断、双语翻译
- **实时副驾(Copilot)** — SSE 流式分析,每轮对话增量更新情绪温度 & 升级风险
- **商家画像** — 自动聚合 180+ 工单到 ~30 商家,Top 20 风险榜
- **优化建议闭环** — 状态机(suggested → in_progress → done),后端实时算 baseline → effect
- **批量上传** — 支持 `.txt / .json / .jsonl / .csv / .log`,并发 2 调 LLM,实时显示分析进度
- **分析周报** — 失效根因分布、Bad Case 率、情绪演化曲线

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 · Vite · Wouter(hash routing)· TanStack Query v5 · Tailwind CSS · shadcn/ui · Recharts |
| 后端 | Express 4 · Drizzle ORM · better-sqlite3(同步驱动)· SSE |
| 数据 | SQLite(`data.db`)· 8 张核心表 |
| LLM | DeepSeek / Qwen / Doubao / Claude(`LLM_PROVIDER` 切换) |
| 构建 | tsx · esbuild |

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 LLM key
cp .env.example .env
# 编辑 .env,填入 DEEPSEEK_API_KEY 或其他 provider 的 key

# 3. 开发模式(同进程跑前后端,默认 5000 端口)
npm run dev

# 4. 生产构建
npm run build
npm start
```

打开 [http://localhost:5000](http://localhost:5000) 即可。首次启动会自动 seed 演示数据(20 商家 / 180+ 工单)。

---

## 项目结构

```
insight-cs/
├── client/              # 前端 (Vite + React)
│   └── src/
│       ├── pages/       # 9 个业务页面
│       ├── components/  # AppLayout + shadcn/ui
│       └── lib/         # queryClient(__PORT_5000__ 哨兵)
├── server/              # 后端 (Express)
│   ├── routes.ts        # REST + SSE 入口
│   ├── storage.ts       # Drizzle CRUD
│   ├── llm/             # 多 provider 抽象
│   ├── seed.ts          # 演示数据生成
│   └── report.ts        # 周报聚合
├── shared/
│   └── schema.ts        # Drizzle 表定义 + Zod 校验(前后端共享)
├── scripts/             # 一次性脚本(商家聚合、ID 重映射)
└── script/build.ts      # 构建脚本(前端 Vite + 后端 esbuild)
```

---

## 页面路由

| 路径 | 功能 |
|---|---|
| `/` | 总览 Dashboard — KPI + 失效根因分布 + 情绪曲线 |
| `/copilot` | 实时副驾 — SSE 流式分析面板 |
| `/conversations` | 工单列表 + 详情(情绪轨迹 0~1 坐标系) |
| `/merchants` | 商家中心 + Top 20 风险榜 |
| `/recommendations` | 优化建议闭环 |
| `/report` | 分析周报 |
| `/business` | 商业叙事页 |
| `/ingest` | 工单录入 — 单条粘贴 + 批量上传 |
| `/products` | 产品 & 商业说明 |

---

## LLM Provider 切换

支持 4 个 provider,改环境变量即可切换。详见 [LLM_PROVIDER_SETUP.md](./LLM_PROVIDER_SETUP.md)。

| Provider | 价格(¥/M token) | 适用场景 |
|---|---|---|
| **DeepSeek** | 2 / 8 | 演示 · 个人项目 · 默认推荐 |
| **Qwen** | 0.3~30 | 电商语料训练充足 · 跨境合规话术 |
| **Doubao** | 3 / 9 | 高并发批处理 |
| **Claude** | — | 沙箱平台默认 · 质量最佳 |

---

## 关键技术决策

1. **LLM 单次调用产出多字段** — 不拆成多步链,一个 prompt 一次返回结构化 JSON,延迟降到 1/3,token 成本降一半
2. **SSE 而非 WebSocket** — 单向流够用,部署侧无需反向代理特殊配置
3. **批量上传走前端解析 + 单条 API** — 前端按格式解析成单条,并发 2 调既有接口,避免 rate limit
4. **推荐 effect 实时算** — 状态切换时后端拉切换前后窗口数据,算 baseline → current 的变化率
5. **情绪坐标系统一 0~1** — 0=愤怒 / 0.5=中性 / 1=满意

---

## 部署

项目本身是标准 Node + 静态文件部署,任意 PaaS / VPS 都能跑。

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

`dist/public/` 是静态资源,`dist/index.cjs` 是后端 bundle。Express 同进程 serve 前端文件 + API + SSE。

---

## License

MIT
