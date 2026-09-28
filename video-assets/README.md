# video-assets — AetherGuard 项目视频素材

StepFun 接口实测记录（key 不入库，从环境变量 STEP_API_KEY 读）。

## 1. 语音合成 TTS

- Endpoint: POST https://api.stepfun.com/step_plan/v1/audio/speech
- Model: stepaudio-2.5-tts（单次 input ≤1000 字符，instruction ≤200 字符，支持 () 内联语境）
- 选定音色: zhengpaiqingnian 正派青年（25-35 岁、沉稳、非播音腔；4 候选试听在 voice-audition/）
- 样品: tts-sample-cixingnansheng.mp3（初测，磁性男声）

## 2. 图像生成

- Endpoint: POST https://api.stepfun.com/step_plan/v1/images/generations
- Model: step-image-edit-2，b64_json 返回，seed 可复现
- 输入图最大支持 4096x4096 分辨率（图生图/编辑场景）
- 样品: img-sample-juhua-1024.png

## 3. 旁白成品（v2，60s 对齐版）

- 文稿: narration-v2.md（v1 原稿 narration.md 保留对照；v2 为对齐 60s 精简约 12%）
- 分段音频: audio/seg01..seg08.mp3（段定义与每段 instruction 见 segments.json）
- 母带: audio/narration-master-60s.wav / .mp3 — 精确 60.000s
  各段首尾静音已裁、按窗口对齐（seg03 借 seg04 余量 0.3s，全程 1.0x 无变速）
- v1 磁性男声旧版归档于 audio-v1-cixingnansheng/
- **自然语速版（推荐）: audio-normal/narration-master-60s-natural.wav / .mp3 — 精确 60.000s**
  语音零变速，仅把段内长停顿压到 0.25s + 时间槽按内容重新分配（见下表）；分段原片在 audio-normal/seg*.mp3
  新时间槽: 0.0 / 5.0 / 10.7 / 17.9 / 27.9 / 34.8 / 43.8 / 53.0 / 60.0
- 旧最佳版（zhengpaiqingnian 正派青年）: audio-best-zhengpaiqingnian/ — 71.8s
- **最终版（shuangkuainansheng 爽快男声）: audio-best-shuangkuai/narration-master-best.wav / .mp3 — 69.2s**
  自然语速 + 段内自然停顿全保留 + 段间 0.4s 间隙，语音零变速
  段落起止: 0.00 / 6.60 / 13.06 / 23.05 / 33.93 / 42.51 / 52.53 / 61.38 / 69.23
  自然语速 + 段内自然停顿全保留 + 段间 0.4s 间隙，语音零变速
  段落起止: 0.00 / 6.12 / 13.69 / 21.74 / 33.12 / 41.32 / 51.77 / 62.57 / 71.84

## 4. 工具脚本

- scripts/video/tts.mjs — 批量 TTS（读 segments.json，断点续跑，--force 全量重生成，TTS_VOICE 换音色）
- scripts/video/mix-master.ps1 — 裁静音 + 按窗口拼 60s 母带（窗口分配硬编码在 $plan）

## 5. 待办

- 分镜画面: step-image-edit-2 概念稿 + dashboard 截图 + 架构图
- 本目录产物不提交 git（check-repository-hygiene.mjs）