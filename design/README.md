# 涂鸦板（草图 → 图标的工作台）

不会画也没关系：随手涂个大概，保存后在 ZCode 对话里告诉 AI「画的是什么、想要什么感觉」，
AI 会读 `design/sketches/` 里的图，帮你做成正式的 SVG 图标 / Logo / 各尺寸 PNG。

## 启动

```
npm run sketch        # 启动并自动打开 http://127.0.0.1:7788
```

（也可以直接双击 `design/sketch.html` 打开 —— 这种方式保存时会让你选一次文件夹。）

## 用法

- 四色画笔 + 粗细滑块；「橡皮」擦掉重画；「撤销」Ctrl+Z；「清空」重画一张
- 「左右镜像」画对称 Logo 特别好用
- 「参考线」是图标常用的方/圆构图参考，只是看，不会存进导出的图片
- 画完 → 填个名字（可选）→ 点「保存」（或 Ctrl+S），PNG 自动落到 `design/sketches/`
- 保存不会清空画布，方便连续改几版；画新图请先点「清空」

## 然后交给 AI

在 ZCode 对话里说一声即可，例如：

> sketches 里那个猫的图，做成圆角方形 App 图标，风格圆润一点

AI 会读图 + 按你的描述产出正式图标（SVG 源文件、各尺寸 PNG、Android 自适应图标等）。

## 图标资产（design/icons/）

最终版 `icon-b.svg`（错位 + 顶底出血，圆点 r56 / y57% / d170）：

- `icon-b-1024.png` 白底主图；`icon-a.svg` 是落选的对称版，留作参考
- `icon-b-cutout.svg` / `icon-b-cutout-1024.png`（透明底）：镂空版 —— 眼睛挖穿、下条内部透明，只剩黑色笔画，适合放在彩色/照片背景上（黑笔画配深色底会看不见，属正常）
- `tune.html` 圆点微调面板（滑块调大小/高度/间距，保存的文件名自带参数）
- `export.html?src=icon-b.svg` 批量出图助手（页面内 `renderAt({size,scale,bg})`）
- `preview.html` 预览页

已接入项目（当前为实验版 D · 满铺马赛克）：

- Web：`public/favicon.svg`（马赛克）、`favicon-32/48.png`、`apple-touch-icon.png`（index.html 已引用）
- Android：`mipmap-*/ic_launcher*.png` 五种密度已替换（整图 = 马赛克 + 镂空标志上下贴边）；自适应图标 = 纯马赛克背景层（`ic_launcher_background.png`，来自 `icon-dev-mosaic-bg.svg`）+ 镂空标志前景层（`icon-b-cutout.svg` 按 2/3 缩放 = 铺满可视区，眼睛/下条内部透出马赛克），`mipmap-anydpi-v26/*.xml` 已改为引用 `@mipmap/ic_launcher_background`
- 启动图标需重新打包 APK 才会更新；Web 图标需重新 build/cap sync

还原稳定版（黑白）图标：跟我说一声即可 —— 从 `icon-b.svg` 重新出全套（favicon + `@color/ic_launcher_background` 白底）。

其它候选稿：`icon-a.svg`（对称版）、`icon-dev-grid.svg`（四宫格）、`icon-dev-testcard.svg`（测试卡底）、`icon-dev-blocks.svg`（拼色标志）、`icon-dev-mosaic-pastel.svg`（马赛克浅色版）。

## 吉祥物拆分（`design/icons/mascot-*.svg`）

标志的黑色部分由上下两枚形象组成，已拆成可独立使用的单件：

- `mascot-xiaoda.svg` —— **小答**（上侧）：实心对话气泡 + 镂空双眼，眼睛是 `evenodd` 透明孔；`viewBox="90 0 680 440"`
- `mascot-xiaowen.svg` —— **小问**（下侧）：空心气泡（stroke 28）+ 三个点；`viewBox="286 570 708 454"`
- `mascot-xiaoda-white.svg` / `mascot-xiaowen-white.svg` —— 同几何的白色版，用于深底 / 彩底
- 原稿两枚都朝外出血：小答顶部截平、小问底部两端截平。单枚版只把这两处按原稿同款 **100 半径**补成圆角，其余坐标一个字没动；要严格原样请用 `icon-b-cutout.svg`
- 出位图：项目无 sharp / puppeteer，用无头 Chrome 截 SVG（宽度 1024，`--default-background-color=00000000` 出透明底）
