# ConvoSketchpad Social Preview

GitHub Social Preview 候选图，尺寸均为 `1280 × 640` PNG，使用确定性 SVG 排版生成。

## 候选方案

| 文件 | 方向 |
|---|---|
| `product-first.png` | 英文产品价值优先，完整展示当前 Canvas |
| `brand-first.png` | 品牌与“探索/主线”叙事优先 |
| `chinese-first.png` | 中文定位优先 |
| `minimal-global.png` | 极简国际版，适合较小的链接预览卡片 |

## 生成

```bash
node design/social-preview/generate.mjs
```

生成器会从以下项目资产读取原图，不修改源文件：

- `public/convosketchpad-logo-1024.png`
- `public/screenshot.png`

所有候选图统一使用“让想法自由分支 / Let ideas fly free”和产品副标题，不再把产品定位为 OpenClaw 专属工作台。文字、Logo、尺寸、颜色和截图均通过 SVG 确定性合成，未使用 AI 重绘产品界面。PNG 文件小于 GitHub Social Preview 的 1 MB 限制。

主 Social Preview 不放置二维码：预览图通常显示在已经可点击的仓库链接卡片中，二维码会占用小尺寸卡片的有效空间。英文和中文版都保留可抄写的 `github.com/MrToyy/convosketchpad`，用于图片脱离链接后被单独转发或截图的场景；线下物料、演讲页或群聊海报应另做带二维码的分享版本。
