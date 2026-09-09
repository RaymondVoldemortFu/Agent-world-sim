# 原野 · Agent World

一个本地运行的 LLM 社会模拟 MVP：64×64 网格、20 位初始居民、每天 3 个按 ID 顺序结算的微回合，空间独立的角色并行请求模型。引擎维护物理事实，角色通过局部观察、交流和记忆形成自己的理解。

## 启动

需要 Node.js 22/24 LTS、npm 和 uv。在项目根目录执行：

```bash
npm install
uv sync --project backend
npm run dev
```

打开 [本地观察界面](http://127.0.0.1:5173)。已有 `.env` 会由 Python 后端读取；新环境可从 `.env.example` 创建配置：

```dotenv
DEEPSEEK_API_KEY=你的密钥
BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
```

模型请求使用 `thinking: {"type":"disabled"}` 和 JSON 输出模式。模型名及这些参数已通过真实接口验证。修改 `.env` 后重启后端；前端不会读取密钥。服务默认仅监听本机。

## 界面操作

1. 点击「生成世界」，或通过右上角设置调整 seed、人数、实验天数与预算。
2. 点击「开始演化」连续运行；「单步」执行一个角色决策或一次日末结算。暂停会等待当前并行批次提交；并发菜单可调整下一批的请求上限。
3. 滚轮缩放、拖动地图、点击地块。居民面板显示身体、库存、性格与已知配方；认知面板显示该角色的私有记忆和主张。
4. 点击事件查看当时提供给模型的上下文、原始响应和校验记录。统计详情列出真实行为次数、错误和 token 用量。
5. 暂停后拖动历史滑块回放；「返回当前」回到最新状态。「导出记录」保存完整 JSON，其他浏览器可导入。
6. 「预算」可调整当前运行的调用、token、时长、人口和费用阈值；修改本身会写入历史。
7. 「实验档案」读取 `artifacts/` 中的命令行实验。此模式只观察正在运行的世界；导出后导入浏览器即可完整回放。

浏览器运行使用 Web Worker 和 IndexedDB。刷新后从最后一次完整提交恢复；关闭页面会停止这个浏览器世界。不同标签页通过 Web Locks 防止同时推进同一世界。命令行实验可在浏览器关闭后继续运行。

## 命令行实验

以下命令复用界面的同一个 TypeScript 模拟引擎。真实实验需要后端已运行，会使用已配置的模型额度。

```bash
# 无模型费用：验证完整物理循环
npm run simulate -- --mode scripted --population 20 --days 100 --out artifacts/scripted-run

# 真实模型接入与小规模验证
npm run simulate -- --mode llm --population 1 --days 3 --out artifacts/model-smoke
npm run simulate -- --mode llm --population 5 --days 10 --out artifacts/model-small

# 正式规模
npm run simulate -- --mode llm --population 20 --days 100 --out artifacts/llm-baseline

# Ctrl+C 会在完整提交边界暂停；从该目录继续
npm run simulate -- --mode llm --out artifacts/llm-baseline --resume

# 校验日志、快照和最终状态的一致性
npm run verify:run -- artifacts/llm-baseline

# 检查保存的模型上下文是否符合每次行动前的世界状态
npx tsx scripts/audit-contexts.ts artifacts/llm-baseline
```

命令行 `--seed` 可指定地图种子，`--api` 可指定本地代理地址，`--concurrency` 可调整并发上限（默认 6）。每个输出目录只允许一个进程写入。恢复时沿用 checkpoint 中的初始配置；重新生成到已有目录需要显式加 `--overwrite`，这会替换该目录的实验记录。

每轮输出：

| 文件                   | 内容                                        |
| ---------------------- | ------------------------------------------- |
| `checkpoint.json`      | 最新完整提交状态和运行时长                  |
| `pending/*.json`       | 尚未完成提交的模型请求/响应；正常提交后移除 |
| `events.jsonl`         | 物理及私有状态的增量事件                    |
| `decisions.jsonl`      | 模型输入、全部尝试、输出、用量与版本        |
| `snapshots.jsonl`      | 初始状态、每 5 天快照和最终快照             |
| `implementation.jsonl` | 每次启动/恢复时的源文件 SHA-256 与事件边界  |
| `run.json`             | 可导入浏览器的完整记录；流式生成            |
| `summary.json`         | 运行结果、计数、用量与最终状态 hash         |
| `verification.json`    | `verify:run` 的验证结果                     |
| `context-audit.json`   | 决策上下文与行动前观察的一致性检查           |

数据文件默认不进入 Git。读取实验档案和下载记录通过本机后端完成，不向模型发送这些全局记录。

## 验证

```bash
npm test
npm run test:backend
npm run build
npx playwright install chromium
npm run test:e2e

# 可选：额外执行一次使用真实模型的浏览器 Worker 测试
LIVE_MODEL_TEST=1 npm run test:e2e
```

单元测试覆盖规则、信息边界、共同繁衍、生产、知识传授、模型失败与回放。浏览器测试覆盖创建、查看、导出/导入、刷新恢复、移动端、预算调整、多标签页互斥、配置故障恢复和实验档案。测试会自动生成独立的脚本记录。

## 当前规则与实现边界

- 成年角色每日 3 AP；幼年角色每日 1 AP。行动按空间依赖分批并行请求、按 ID 顺序提交，完整 20 人×100 天需要数千次调用，实际数据见实验记录。
- 妊娠 5 天、出生后 20 天成年是可配置的游戏化时间尺度。繁衍要求双方聊天提议/接受，并分别执行共同动作；父母知识通过交流和子代实验验证传承。
- 初版包含 3 条隐藏配方、农田、棚屋、基础生存和攻击。未知配方由引擎验证；社会产权与承诺不会成为系统强制权限。
- 当前上下文检索使用最多 200 条活跃记忆和 40 条主张；被移出活跃窗口的记录仍保存在历史事件中，可供观察者追溯。每次注入最多 8 条相关记忆；每 5 天在主行动之后、日末之前整理经历。
- 原始模型输出会受到 schema 和物理规则校验。合法格式中的无效行动消耗 AP 并产生失败事件；模型不会直接修改世界状态。
- LLM 具有预训练先验；子代的独立记忆不能等同于现实婴儿的零知识状态。社会是否形成、形成何种秩序，应根据实际事件分析。

更多设计见 [原始项目文档](PROJECT_DOC.md)、[MVP 实施方案](MVP_IMPLEMENTATION_PLAN.md)；已执行的验证与观察见 [实验报告](docs/MVP_RUN_REPORT.md)。

并行策略与实测耗时见 [空间依赖并行调度](docs/PARALLEL_SCHEDULING.md)。
