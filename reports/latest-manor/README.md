# 最新领地实验分析

主报告：`report.html`，图表和可检索事件均内嵌，可离线单文件打开。

- 分析实验：`continuous-1789196221885-abbea8`
- 截止边界：E209609，D90 04:17，暂停状态
- 数据：`data.json`（只读一致性快照提取）
- 核心验证：回放事件无缺口、最终Agent吻合、粮食守恒；7张图像加载、所有事件引用存在、证据搜索与跳转、桌面及390px手机布局通过检查。
- Python 图像：`outcome.png`、`stocks.png`、`budget.png`、`finance.png`、`health.png`、`dialogue.png`、`runtime.png`

复现：在项目根目录执行：

```sh
uv run --project backend python -m scripts.reports.extract_latest
uv run --project backend --with matplotlib --with numpy python scripts/reports/render_latest.py
```

提取脚本固定本报告实验ID，重新执行将更新提取边界；原报告数据以本目录已交付版本为准。分析不改变实验状态，不发起模型调用。
