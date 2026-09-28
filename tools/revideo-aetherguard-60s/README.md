# AetherGuard Revideo 60s Promo

基于 Revideo 0.11.0 的独立宣传片工程。它不会改动现有 `build:video:demo` 生产线，也不把 Revideo 依赖引入 frontend 或仓库根依赖。

## 输出

- `artifacts/video/revideo-aetherguard-60s/aetherguard-60s.final.mp4`
- `artifacts/video/revideo-aetherguard-60s/aetherguard-60s.zh-CN.srt`
- `artifacts/video/revideo-aetherguard-60s/build-report.json`
- `artifacts/video/revideo-aetherguard-60s/qa-report.json`
- `artifacts/video/revideo-aetherguard-60s/qa-frames/*.png`

`public/assets/`、`public/fonts/`、`public/audio/`、`output/` 和 `dist/` 都是可重新生成的本地工作目录，不进入 Git。

## 复现

```bash
npm --prefix tools/revideo-aetherguard-60s install
npm --prefix tools/revideo-aetherguard-60s run prepare-assets
npm --prefix tools/revideo-aetherguard-60s run narration
npm --prefix tools/revideo-aetherguard-60s run render:smoke
npm --prefix tools/revideo-aetherguard-60s run render:preview
npm --prefix tools/revideo-aetherguard-60s run render
npm --prefix tools/revideo-aetherguard-60s run finalize
npm --prefix tools/revideo-aetherguard-60s run qa
```

仓库根目录等价入口：

```bash
npm run build:video:revideo
```

## 口径约束

- 画面仅使用当前 Gateway Appliance 产品线素材；不使用已退役 ESP32 素材或 FluxGuard 品牌资产。
- UI 画面均标为“演示界面 · 示例数据”。
- Gateway Appliance 表述为工业硬件原型；不声称已量产、认证或完成完整硬件在环验证。
- AetherGuard 不替代 WAF、EDR 或堡垒机。
- 仅覆盖实际接入网关的受控网络链路。
