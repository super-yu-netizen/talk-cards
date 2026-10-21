# 项目规则

- 这是《对话卡牌》网页抽牌游戏，一个纯静态网页。完整需求见 `CODEX_PROMPT.md`。
- 内容数据都在 `data/` 目录：
  - `cards.json`、`series.json`、`scenes.json` 是源文件。
  - `game-data.js` 由 `python3 tools/build_data.py` 根据源文件生成，网页只读这个文件。
- 不要修改 `data/` 里的文件，也不要在代码里写死卡牌文字。发现数据有问题，在汇报里说明。
- 技术约束：
  - 用原生 HTML、CSS、JS，不用框架、npm、构建工具、外部 CDN 或网络字体。
  - 双击 `index.html` 就能运行：不用 ES module，也不用 `fetch` 读本地文件。
  - 数据只存在本机的 `localStorage`，key 统一加前缀 `talkcards:`。
  - 不加统计代码，也不加第三方脚本。
- 代码注释和汇报都用中文。
