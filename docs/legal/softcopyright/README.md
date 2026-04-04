# AetherGuard 主平台版软著材料

本目录用于存放 AetherGuard 智能服务器安全防御平台 V1.0 的软著申报源文件。

## 文件说明

- `aetherguard_v1_user_manual.html`
  软著用户手册的排版源文件，引用 `output/playwright/softcopyright-aetherguard-v1/` 下的整窗截图。
- `aetherguard_v1_frontend_source_print.html`
  前端源代码打印稿 HTML，由脚本生成。
- `aetherguard_v1_backend_source_print.html`
  后端源代码打印稿 HTML，由脚本生成。
- `aetherguard_v1_frontend_source_print.txt`
  前端源代码打印稿文本版，由脚本生成。
- `aetherguard_v1_backend_source_print.txt`
  后端源代码打印稿文本版，由脚本生成。
- `aetherguard_v1_source_selection.md`
  本次源码打印稿选用的文件范围和页数说明。

## 生成步骤

1. 启动本地演示环境，确保前端位于 `http://127.0.0.1:8080`，后端位于 `http://127.0.0.1:3005`。
   如果后端以 `DISABLE_REDIS=true` 的方式本地启动，需要同时设置 `ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN=true`，否则登录后续的 `auth/me` 鉴权会因为 Redis 不可用而被拒绝，导致受保护页面无法正常截图。
2. 运行截图脚本：

```powershell
node scripts/legal/capture-softcopyright-screenshots.mjs
```

3. 生成源码打印稿 HTML 和 TXT：

```powershell
node scripts/legal/generate-softcopyright-code-print.mjs
```

4. 生成 PDF：

```powershell
node scripts/legal/render-html-to-pdf.mjs docs/legal/softcopyright/aetherguard_v1_user_manual.html output/pdf/aetherguard_v1_user_manual.pdf
node scripts/legal/render-html-to-pdf.mjs docs/legal/softcopyright/aetherguard_v1_frontend_source_print.html output/pdf/aetherguard_v1_frontend_source_print.pdf --landscape
node scripts/legal/render-html-to-pdf.mjs docs/legal/softcopyright/aetherguard_v1_backend_source_print.html output/pdf/aetherguard_v1_backend_source_print.pdf --landscape
```

## 输出位置

- 截图：`output/playwright/softcopyright-aetherguard-v1/`
- PDF：`output/pdf/`
