# Sticky Ink Button (`sticky-ink-button/`)

复刻参考视频中的 3D 高光黑色粘液胶囊按钮（`let's collaborate`），支持指针粘附拉丝、多股丝网牵引、张力绷断飞溅液滴、弹性果冻回弹、自定义手型光标沾墨覆盖，以及右上角可折叠微调面板。

## 文件结构

- `index.html`：极简舞台结构、自定义 SVG 手型光标层、WebGL2 画布、语义化 `<button>` 与右上角可折叠 `Tune` 面板。
- `styles.css`：纯黑外底与居中浅灰圆角舞台、`[hidden]` 显隐规则、键盘 `:focus-visible` 焦点环、`prefers-reduced-motion` / `.no-webgl` 静态 3D 胶囊降级样式。
- `physics.js`：零 DOM 依赖粘弹物理引擎（精确胶囊 SDF、64 节点弹性耦合轮廓环、8 节点 Verlet 多丝系统、受控回缩与液滴粒子、光标粘液弹簧团）。
- `renderer.js`：双尺度高度场 + WebGL2 渲染管线（R 通道大尺度 Metaball 液颈融合 + G 通道细丝/微液滴抗锯齿，多 Pass 可分离高斯模糊、实时高度场法线与左上柔光箱高光/底部反光/右下方软阴影合成）。
- `main.js`：视口同步、Pointer Events 交互、自定义手型光标热区同步、点击微压缩反馈与 `Tune` 参数实时绑定。

## 运行方式

在仓库根目录或 `sticky-ink-button/` 下启动任意静态服务器即可（ES Modules 需通过 HTTP 访问）：

```powershell
python -m http.server 18185 --directory sticky-ink-button
```

浏览器打开 `http://127.0.0.1:18185/`。

## 验证记录

### 1. 自动检查（最新代码后执行）
- `node --check sticky-ink-button/physics.js && node --check sticky-ink-button/renderer.js && node --check sticky-ink-button/main.js`：通过（0 错误）。
- `physics.js` Node 单元测试：验证 `pillSDF`（内部 `-34`、边缘 `0`、外部 `66`）、接触粘附（`isStuck=true`）、多丝生成（`attachedCount=7`）、超限绷断产生液滴（`sawDroplets=true`）与边缘弹性回弹（`maxAbsDisp=0.426`），180 帧后无 `NaN` 且平稳归零。
- Playwright + Edge (`msedge`, WebGL2 启用) 运行时检查：
  - `isWebGL2: true`，`consoleErrors: []`，`pageErrors: []`。
  - 桌面 `1280×800`：`scrollWidth === innerWidth (1280)`，按钮居中 `236×68`。
  - 窄屏 `430×844`：`scrollWidth === innerWidth (430)`，按钮完整居中无横向溢出。
  - 交互态：`stretchRightDown` 7 根粘附丝；`sweepBottom` 扫掠产生 7 根粘附丝 + 1 根回缩；`snapRecoil` 触发 `droplets: 25`、`spikes: 4`、`maxDisp: 6.411`；点击脉动 `pressScale: 0.9816`；`Tune` 开关展开与 `Escape` 关闭正常。

### 2. 视觉评审（由只读子代理核验 6 张运行截图）
覆盖状态与视口：`1280×800` 静止态、右下斜拉态、底部横向扫掠态、绷断飞溅回弹态、`Tune` 面板展开态，以及 `430×844` 窄屏态。
- **Premultiplied-alpha 边缘融合**：第一轮发现的阴影浅白蓝光晕已完全消除，与浅灰卡片过渡自然。
- **3D 黑胶高光与阴影**：左上柔光箱弧形主高光、下沿微弱环境反光、右下方软阴影及居中白色文案 `let's collaborate` 均清晰自然。
- **多丝拉扯与孔洞**：5–7 根粗细不一的弯曲粘液丝之间保留清晰镂空，丝线附带连续 3D 高光。
- **自定义手型光标沾墨**：指尖自然沾染黑液，手型轮廓仍清晰可辨，断裂后无残留悬浮黑块。
- **绷断与回弹**：第一轮出现的跨屏回弹长直线与锯齿尖刺已消除，可见立体飞溅液滴与边缘弹性回弹波。
- **微调面板与窄屏**：桌面展开不遮挡中心按钮，窄屏居中且无重黑焦点框。

### 已知轻微观察项 / 未覆盖项
- 底部多根细丝并行扫掠时，边缘根部衔接处仍有轻微水平暗带感；部分飞溅液滴聚集重叠处可见细小合并形态。
- 真实手机 GPU、真实触屏手感、Safari/Firefox 实测与 `prefers-reduced-motion` 系统开关的实机效果未在本轮无头 Edge 环境中实际测验。
