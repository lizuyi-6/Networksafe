# API安全中间件管理系统 - 用户手册合并脚本
# PowerShell版本 - 功能更强大

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  API安全中间件管理系统 - 用户手册合并工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 定义文件列表
$manualParts = @(
    @{ Name = "用户手册_第1部分_封面目录概述.md"; Title = "第一部分：系统概述" },
    @{ Name = "用户手册_第2部分_安装部署基本使用.md"; Title = "第二部分：安装与部署" },
    @{ Name = "用户手册_第3部分_系统使用指南.md"; Title = "第三部分：系统使用指南" }
)

# 检查文件是否存在
$missingFiles = @()
foreach ($part in $manualParts) {
    if (-not (Test-Path $part.Name)) {
        $missingFiles += $part.Name
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host "错误: 以下文件不存在：" -ForegroundColor Red
    foreach ($file in $missingFiles) {
        Write-Host "  - $file" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "请确保所有用户手册部分文件都存在。" -ForegroundColor Yellow
    Read-Host "按Enter键退出"
    exit 1
}

# 创建完整的用户手册
$outputFile = "完整用户手册.md"
Write-Host "正在创建完整的用户手册..." -ForegroundColor Green

# 创建文件头部
$header = @"
# API安全中间件管理系统 - 完整用户手册

**软件名称：** API安全中间件管理系统
**版本号：** V1.0
**申请人：** [请填写申请人姓名]
**申请日期：** [请填写申请日期]

---

## 目录

1. [系统概述](#系统概述)
2. [安装与部署](#安装与部署)
3. [系统使用指南](#系统使用指南)

---

"@

Set-Content -Path $outputFile -Value $header -Encoding UTF8

# 合并各个部分
$totalPages = 0
foreach ($part in $manualParts) {
    Write-Host "正在合并: $($part.Title)..." -ForegroundColor Yellow

    # 添加部分标题
    Add-Content -Path $outputFile -Value "`n## $($part.Title)`n" -Encoding UTF8

    # 读取并添加内容
    $content = Get-Content -Path $part.Name -Encoding UTF8 -Raw
    Add-Content -Path $outputFile -Value $content -Encoding UTF8

    # 估算页数（每页约500字）
    $wordCount = ($content -split '\s+').Count
    $pages = [math]::Ceiling($wordCount / 500)
    $totalPages += $pages

    Write-Host "  完成! 估算页数: $pages" -ForegroundColor Green
}

# 添加页脚
$footer = @"

---

## 用户手册信息

**总页数：** 约 $totalPages 页（包含截图位置）
**截图位置：** 15个（需要插入实际截图）
**生成时间：** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**文件大小：** $([math]::Round((Get-Item $outputFile).Length / 1KB, 2)) KB

## 使用说明

1. **截图准备**：按照手册中的截图位置说明，准备15张系统运行截图
2. **插入截图**：将截图插入到标注的截图位置
3. **格式转换**：建议转换为Word或PDF格式用于打印
4. **打印要求**：使用A4纸单面打印，确保文字清晰可读

## 截图清单

| 编号 | 截图位置 | 截图要求 | 状态 |
|------|----------|----------|------|
| 1 | 系统架构图 | 展示四层架构设计 | [ ] |
| 2 | 系统主界面概览 | 展示整体布局 | [ ] |
| 3 | Docker Compose启动成功 | 终端截图 | [ ] |
| 4 | 服务健康检查通过 | 接口返回结果 | [ ] |
| 5 | 系统登录界面 | 完整登录表单 | [ ] |
| 6 | 仪表板完整界面 | 所有KPI和图表 | [ ] |
| 7 | 安全扫描器运行中 | 显示进度和日志 | [ ] |
| 8 | 超级管理员面板 | 服务器监控界面 | [ ] |
| 9 | 部署向导配置界面 | 参数设置界面 | [ ] |
| 10 | 站点管理界面 | 站点列表和操作 | [ ] |
| 11 | 修复历史界面 | 时间线视图 | [ ] |
| 12 | 系统设置界面 | 配置选项界面 | [ ] |
| 13 | 语言切换功能 | 中英文切换效果 | [ ] |
| 14 | 实时监控图表 | 图表动态效果 | [ ] |
| 15 | 安全事件详情 | 事件详情弹窗 | [ ] |

---

**用户手册生成完成！**
========================================
"@

Add-Content -Path $outputFile -Value $footer -Encoding UTF8

# 生成统计信息
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "合并完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "生成的文件：" -ForegroundColor Yellow
Write-Host "  • $outputFile" -ForegroundColor White
Write-Host ""
Write-Host "文件信息：" -ForegroundColor Yellow
$fileInfo = Get-Item $outputFile
Write-Host "  • 大小: $([math]::Round($fileInfo.Length / 1KB, 2)) KB" -ForegroundColor White
Write-Host "  • 创建时间: $($fileInfo.CreationTime)" -ForegroundColor White
Write-Host "  • 估算页数: $totalPages 页" -ForegroundColor White
Write-Host ""
Write-Host "下一步操作：" -ForegroundColor Yellow
Write-Host "  1. 运行截图检查脚本: .\检查截图需求.ps1" -ForegroundColor White
Write-Host "  2. 准备系统运行截图" -ForegroundColor White
Write-Host "  3. 将截图插入到用户手册中" -ForegroundColor White
Write-Host "  4. 转换为打印格式 (Word/PDF)" -ForegroundColor White
Write-Host ""
Write-Host "按Enter键退出..." -ForegroundColor Gray
Read-Host