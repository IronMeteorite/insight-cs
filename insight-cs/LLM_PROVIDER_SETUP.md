# LLM Provider 切换说明

本项目支持四个 LLM Provider，零代码切换。当前线上默认走 **沙箱平台**（Claude Haiku 4.5 + Sonnet 4.6）。如需切到国内 API key，按下面配置即可。

## 自动选择规则

`server/llm/client.ts` 启动时按顺序检测环境变量：

```
1. DEEPSEEK_API_KEY  → provider=deepseek（默认 fast=deepseek-chat, quality=deepseek-chat）
2. DASHSCOPE_API_KEY → provider=qwen     (fast=qwen-turbo,    quality=qwen-max)
3. ARK_API_KEY       → provider=doubao   (fast=doubao-1-5-pro-32k, quality=doubao-1-5-pro-256k)
4. 沙箱平台 ANTHROPIC_API_KEY → provider=platform（fast=claude_haiku_4_5, quality=claude_sonnet_4_6）
```

也可用 `LLM_PROVIDER` 强制指定（`deepseek` / `qwen` / `doubao` / `platform`）。

---

## 一、DeepSeek（推荐 · 最高性价比）

- **官方**：[platform.deepseek.com](https://platform.deepseek.com)
- **价格**：¥2 / M 输入 token，¥8 / M 输出 token（V3.2，2026-05 数据）
- **OpenAI 兼容**：是
- **中文 + 推理表现**：本项目场景下与 Claude Sonnet 接近，但成本约 1/8

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# 可选：默认就是这两个
export LLM_FAST_MODEL=deepseek-chat
export LLM_QUALITY_MODEL=deepseek-chat
```

## 二、阿里通义千问 Qwen（电商场景词汇最强）

- **官方**：[bailian.console.aliyun.com](https://bailian.console.aliyun.com)
- **价格**：Qwen3-Max ¥10/¥30 per M tokens；Qwen-Turbo ¥0.3/¥0.6
- **OpenAI 兼容模式 baseURL**：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- **强在**：本土电商术语、跨境合规话术、政策申诉表达

```bash
export DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export LLM_FAST_MODEL=qwen-turbo        # 快速场景（工单录入）
export LLM_QUALITY_MODEL=qwen-max       # 深度分析（周报）
```

## 三、字节豆包 Doubao（速度最快、批量便宜）

- **官方**：[volcengine.com/product/doubao](https://www.volcengine.com/product/doubao)
- **价格**：Doubao 1.6 Pro 32K ¥3/¥9 per M tokens
- **OpenAI 兼容 baseURL**：`https://ark.cn-beijing.volces.com/api/v3`
- **强在**：吞吐量高，适合 ingest 大批量回填

```bash
export ARK_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export LLM_FAST_MODEL=doubao-1-5-pro-32k
export LLM_QUALITY_MODEL=doubao-1-5-pro-256k
```

---

## 切换后重启服务

```bash
cd insight-cs
npm run build
NODE_ENV=production node dist/index.cjs
```

启动后日志会打印当前 provider，确认切换成功：

```
[llm] provider=deepseek fast=deepseek-chat quality=deepseek-chat hasKey=true
```

---

## Provider 推荐组合

| 场景         | Provider    | 理由                              |
| ---------- | ----------- | ------------------------------- |
| 个人项目跑通     | 沙箱平台         | 零成本，Claude 质量                   |
| 演示/Demo 上线 | DeepSeek    | 性价比之王，¥2/M token                |
| 生产 · 跨境电商  | Qwen-Max    | 电商语料训练充足，金句抽取最精准                |
| 生产 · 高并发批处理 | Doubao      | 吞吐量与稳定性最佳                       |
| 生产 · 多语言   | Qwen-Max    | 中英混合识别 + 翻译质量优于 DeepSeek        |

---

## 限流与重试

`client.ts` 内置：
- 30s 超时
- JSON 解析失败时自动重试 1 次（强制 `response_format=json_object`）
- 单段调用失败不影响其他段（周报内部用 `Promise.allSettled` 并发）

如遇频繁限流，将 `server/routes.ts` 的并发段调用降级为串行，或购买更高档位。
