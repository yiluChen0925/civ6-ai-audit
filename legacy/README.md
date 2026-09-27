# Legacy — 早期实验

这里存放项目开发过程中的早期方案，**已被更优的方案取代**，仅作记录保留。

## collection.bat

**作用**：从游戏日志目录和 Cline 目录采集 CSV 和对话记录。

**为什么被取代**：
- 需要手动运行，容易忘记
- 无法采集 AI 的每回合实时状态
- 与最终方案（`civ6-mcp/server.py` 内嵌导出）功能重叠

**取代方案**：`civ6-mcp/server.py` 在 `end_turn` 时自动导出完整回合数据到 `data/collected/turn_XXX.json`。