# Day 90 连续庄园实验报告

打开 `index.html` 查看完整报告。8张Matplotlib图表已以PNG嵌入，HTML可单独离线使用；死亡登记支持检索/死因筛选。`data.json` 保存汇总数据、关键事件与证据，`summary.json` 保存核心统计；PNG和preview文件便于单独查看。

读取边界：continuous-1789123107617-75b7fc / E286930 / 界面第90天12:43。数据库保持暂停，分析未修改实验。

从项目根目录重新读取数据库（只读）：

```sh
uv run --project backend python -m scripts.reports.extract_day90
```

从已有数据重新生成图表和HTML：

```sh
uv run --project backend --with matplotlib --with numpy python scripts/reports/render_day90.py
```

渲染脚本使用macOS内置STHeiti字体。换到其他操作系统时，将字体路径替换为包含中文字形的字体。

“本次实验内容体积”按归属行的已存储内容列精确求和，不含索引、页开销与日志；“整个数据库表数据＋索引”来自InnoDB元数据估计。这两个口径不能相减得出本次实验的独占磁盘空间。
