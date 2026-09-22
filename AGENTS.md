# Agent World Sim · 开发约定

本文件适用于整个仓库。面向维护代码、排查实验和分析数据的编程 Agent；游戏角色的提示词在业务代码中维护。

## 项目定位与事实来源

- 这是本地运行的 LLM 社会模拟实验。当前主要场景是中世纪领地的连续模拟，使用服务端物理规则、异步 LLM 决策和 Three.js 展示。
- 仓库同时保留早期离散生态/领地引擎及其档案。修改前先确认任务涉及哪种引擎，不把两套动作、时间、坐标或配置混用。
- 当前实现以代码、保存的实验配置和事件记录为准。`README.md`、`PROJECT_DOC.md` 以及早期设计稿包含历史规则，不能直接当作当前连续场景的行为合同。
- 新实验默认值见 `frontend/src/continuous/config.ts`；已有实验使用保存的设置。修改初始化器或初始提示词不会自动更新存量实验。
- 默认一天对应墙钟 120 秒。模拟内部时间单位见 `frontend/src/continuous/types.ts`；UI 第一天从内部时间 0 开始，UI D31 00:00 对应 `30 * DAY`。

## 架构入口

| 范围 | 主要入口与职责 |
| --- | --- |
| 页面与路由 | `frontend/src/ui/App.tsx`；连续模式页面在 `frontend/src/continuous/` |
| 状态与引擎 | `frontend/src/continuous/types.ts`、`engine.ts`：状态、动作推进、事件及回放 |
| 领地场景 | `frontend/src/continuous/manor/`：开局、身份背景、农业税务、战斗、信件、门禁及感知 |
| 三维与空间 | `frontend/src/continuous/game/`、`Scene.tsx`：模型、动画、碰撞、寻路与展示时钟 |
| 连续服务 | `scripts/continuous/server.ts`：世界单写入队列、模型调度、HTTP/SSE |
| 提交与模型计划 | `scripts/continuous/commit.ts`、`plan.ts`：可靠提交、计划解析与校验 |
| 角色观察 | `scripts/continuous/observation.ts`：运行时与离线工具共享的观察构建 |
| 连续后端 | `backend/app/continuous_api.py`：持久化、回放与模型网关 |
| 提示词与记忆 | `backend/app/continuous_manor_prompt.py`、`continuous_planning.py`、`continuous_memory.py` |
| Python 状态合并 | `backend/app/continuous_state.py`：与 TypeScript 回放一致的补丁语义 |
| 经历与新闻 | `backend/app/continuous_history.py`、`continuous_news.py`、`news.py` |
| 独立访谈 | `backend/app/agent_chat.py`、`frontend/src/continuous/ChatPage.tsx` |
| 数据库 | `backend/app/storage.py`；MySQL 为后台实验的事实来源 |
| 离散 API | `backend/app/main.py`；旧命令行实验入口为 `scripts/simulate.ts` |
| 分析报告 | `scripts/reports/`、`reports/` |

按需阅读 `docs/CONTINUOUS_MANOR.md`、`docs/MANOR_HOUSEHOLD_UPGRADE.md`、`docs/GAME_ENGINE_UPGRADE.md`。排障参考 `docs/CONTINUOUS_FORMAT_RELIABILITY.md`、`docs/CONTINUOUS_PERFORMANCE.md`、`docs/AGENT_INTERVIEWS.md`；仍需核对当前代码。

## 环境与常用命令

使用 Node.js >=22、npm、Python >=3.11、uv、MySQL 8+。所有命令从仓库根目录执行。

```sh
# 首次安装
npm install
uv sync --project backend

# 全部本地服务
npm run dev

# 仅连续引擎与其 Python 网关，不启动 Web UI 或离散 API
npm run dev:continuous

# 类型检查及前端生产构建
npm run build

# 定向 TypeScript 测试示例
npx vitest run frontend/tests/continuous-manor.test.ts frontend/tests/manor-household.test.ts

# 定向 Python 测试示例
uv run --project backend python -m unittest backend.tests.test_continuous_state backend.tests.test_continuous_day_rewind -v
```

默认端口：Web UI `5173`、离散 API `8000`、连续世界服务 `8001`、连续持久化/模型网关 `8002`。启动前检查现有监听和进程管理方式，复用正确服务；避免重复启动或终止其他项目的进程。

模型及数据库配置使用 `.env`，示例见 `.env.example`，存储说明见 `docs/MYSQL_REPLAY_STORAGE.md`。密钥仅由后端读取，不写入前端、日志、报告或 Git。读取配置时只输出排查所需的非敏感字段。

## 模拟与异步执行约束

- 世界状态由服务端单写入队列提交，客户端展示已提交事实。模型调用和历史读取放在队列外，不让网络等待阻塞整个世界。
- 同一角色最多一个在途规划请求。回复结算时复核请求标识、计划版本和角色状态；被中断或过期的回复不能覆盖新任务。
- 模型输出是意图，实际动作仍需校验距离、门锁、存量、负重、人物状态及耗时。发言、信件或账簿承诺不等于实物交付。
- 中断移动从真实连续位置继续；中断劳动保留已完成部分；取放粮预留必须在完成、失败和取消路径正确结算或释放。
- 引擎改动须维持资源守恒、事件序号/时间顺序、提交幂等性以及最终回放一致性。持久化失败不得悄悄继续推进未提交世界。
- 新增状态字段或动作时同步检查 TypeScript 类型、解析器、执行器、Python 持久化/回放、观察、提示词和 UI。所有影响后续行为的状态变化都应可回放。
- 注意增量合并：例如 `patch.mail` 的信件更新不能被无关的 `meta.manor` 补丁覆盖。不要把完整历史对象重复塞进每条事件。
- 导航碰撞与渲染共享空间定义；动画不能替代引擎结算。改寻路时覆盖锁门、动态目标、中断和自动 routine 的优先级。

## 角色认知与上下文

- 社会身份、服从、合作和冲突主要由角色提示词与决策形成。不要为了获得预期社会结果，暗中把自愿行动改成强制规则。
- 国王 FSM、王军、财政官报表和管家信件路由等已有特殊机制有明确实现边界；新增例外需在设计及观察中说明。
- 保持局部信息边界：当前可见库存、实际听众、历史记忆和全局观察者数据要区分。普通角色不能通过方便的 API 无意获得全图精确信息。
- 私信、个人账簿及访谈保持权限和会话隔离。访谈使用冻结角色上下文，不把用户访谈直接写回实验决策历史。
- 共享规则放在稳定前缀，个人背景与动态信息靠后；历史增量追加，达到窗口条件才压缩。固定规则和积累的配方知识不随普通历史一起丢弃。
- 修改提示词同时核对真实工具参数、返回值和当前观察。需要影响存量实验时，明确更新路径及兼容方式，保留原有历史记录。
- 连续模式已移除全局规划次数/token 预算与截断性的模型输出上限，不重新引入这类停机条件。上下文窗口、并发、超时和有限重试是不同机制。
- 模型格式修复应保留可诊断的原始结果，重试有界；格式失败不能造成动作重复执行或掩盖请求停滞。

## 实验与数据保护

- 开工先看 `git status`，保留已有修改与未跟踪文件；不要顺手清理、回滚或提交用户的其他工作。
- 调查实验先确认 run ID、场景、创建时间和数据边界。浏览器当前 URL 可能是旧实验，数据库最近更新时间也不等于最新创建的实验。
- 用户要求观察或分析时保持只读，不顺手暂停、重启、推进时间或修改角色计划。需要修复运行服务时先检查活跃实验、在途模型请求及访谈流，采取可恢复的提交/检查点边界。
- 删除、清空、回滚实验必须属于用户授权范围。执行前完整备份并验证可恢复性；避免只裁剪事件而留下未来上下文、新闻或模型结果。
- 按日回滚入口是 `backend/app/continuous_day_rewind.py`：先阅读实现与命令帮助，预演后再应用，确保写入服务和网关离线。旧 `continuous_rewind.py` 的适用范围不同，不混用。
- 回滚同时处理快照、经历索引、新闻、模型结果和在途请求；区分真实历史会话恢复与基于过去事实重建上下文。独立访谈的冻结快照保留其原始时间边界。
- `artifacts/` 是忽略提交的运行产物；`reports/` 可交付报告。报告和导出不替代 MySQL 原始记录，不提交 `.env` 或数据库凭据。

## 验证与性能

- 验证与改动范围匹配：文档/简单参数修改检查引用及配置；规则、导航、异步或回放修复增加有意义的回归用例并运行相关测试；TypeScript 改动运行 `npm run build`。
- 全量命令为 `npm test`、`npm run test:backend`、`npm run test:e2e`，不必每次都全跑。不要用长时间真实 LLM 实验代替定向验证。
- Playwright 会复用本地服务；Python `TestClient` 的启动过程可能访问真实 MySQL 或启动恢复/新闻任务。运行集成测试前阅读测试初始化，使用隔离数据并检查副作用。
- 连续领地确定性基线：`npx tsx scripts/validate-continuous-manor.ts`，用于粮食守恒和回放等检查；旧 `npm run simulate` / `verify:run` 不能代替连续引擎验证。
- 格式化只针对改动文件，例如 `npx prettier --write path/to/changed.ts`；`npm run format` 会重写较大范围。
- 性能排查分别测量世界队列、数据库、上下文构建、SSE 和渲染；避免每 tick/每帧扫描完整事件史、序列化完整档案或重建静态场景。
- 查询采用有界分页和索引，流式数据增量合并；页面卸载清理订阅、计时器及 GPU 资源。性能修复不能牺牲回放或角色信息边界。

## 分析与交付

- 用中文简洁说明发现、改动、验证和剩余限制。区分已执行检查与推断，不能把发言/计划计为完成动作。
- 实验报告标明 run ID、提取时间、截止事件序号/模拟时间、单位和统计口径。记录会影响解释的版本变化或回滚；数据库逻辑数据量与物理占用分开报告。
- 结论关联具体事件、角色轨迹或可重跑统计。HTML 报告优先自包含图表，检查离线打开、中文字体和页面布局，交付可点击的文件链接。
