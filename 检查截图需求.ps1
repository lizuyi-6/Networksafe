# API安全中间件管理系统 - 截图需求检查脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  API安全中间件管理系统 - 截图需求检查" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 截图需求清单
$screenshotRequirements = @(
    @{
        Id = 1
        Name = "系统架构图"
        Description = "展示四层架构设计（前端、后端、核心库、安装器）"
        Location = "用户手册第1部分"
        FileName = "01_系统架构图.png"
        Priority = "高"
    },
    @{
        Id = 2
        Name = "系统主界面概览"
        Description = "展示系统整体布局和主要功能区域"
        Location = "用户手册第1部分"
        FileName = "02_系统主界面概览.png"
        Priority = "高"
    },
    @{
        Id = 3
        Name = "Docker Compose启动成功"
        Description = "终端截图，显示所有服务启动成功"
        Location = "用户手册第2部分"
        FileName = "03_Docker启动成功.png"
        Priority = "高"
    },
    @{
        Id = 4
        Name = "服务健康检查通过"
        Description = "/health接口返回正常结果的截图"
        Location = "用户手册第2部分"
        FileName = "04_健康检查通过.png"
        Priority = "中"
    },
    @{
        Id = 5
        Name = "系统登录界面"
        Description = "完整的登录表单界面"
        Location = "用户手册第2部分"
        FileName = "05_系统登录界面.png"
        Priority = "高"
    },
    @{
        Id = 6
        Name = "仪表板完整界面"
        Description = "显示所有KPI卡片、统计图表和最近活动记录"
        Location = "用户手册第3部分"
        FileName = "06_仪表板完整界面.png"
        Priority = "高"
    },
    @{
        Id = 7
        Name = "安全扫描器运行中"
        Description = "扫描器正在运行，显示进度条和实时日志"
        Location = "用户手册第3部分"
        FileName = "07_安全扫描器运行中.png"
        Priority = "高"
    },
    @{
        Id = 8
        Name = "超级管理员面板"
        Description = "服务器监控、错误日志查看等管理功能界面"
        Location = "用户手册第3部分"
        FileName = "08_超级管理员面板.png"
        Priority = "中"
    },
    @{
        Id = 9
        Name = "部署向导配置界面"
        Description = "显示参数设置和配置预览的界面"
        Location = "用户手册第3部分"
        FileName = "09_部署向导配置界面.png"
        Priority = "中"
    },
    @{
        Id = 10
        Name = "站点管理界面"
        Description = "站点列表、状态指示和操作按钮"
        Location = "用户手册第3部分"
        FileName = "10_站点管理界面.png"
        Priority = "中"
    },
    @{
        Id = 11
        Name = "修复历史界面"
        Description = "时间线视图显示修复记录"
        Location = "用户手册第3部分"
        FileName = "11_修复历史界面.png"
        Priority = "低"
    },
    @{
        Id = 12
        Name = "系统设置界面"
        Description = "账户设置、安全设置等配置选项"
        Location = "用户手册第3部分"
        FileName = "12_系统设置界面.png"
        Priority = "中"
    },
    @{
        Id = 13
        Name = "语言切换功能"
        Description = "中英文界面切换的效果对比"
        Location = "用户手册第3部分"
        FileName = "13_语言切换功能.png"
        Priority = "低"
    },
    @{
        Id = 14
        Name = "实时监控图表"
        Description = "图表动态效果，鼠标悬停显示数据"
        Location = "用户手册第3部分"
        FileName = "14_实时监控图表.png"
        Priority = "中"
    },
    @{
        Id = 15
        Name = "安全事件详情"
        Description = "安全事件详情弹窗，显示完整信息"
        Location = "用户手册第3部分"
        FileName = "15_安全事件详情.png"
        Priority = "低"
    }
)

# 检查截图文件是否存在
Write-Host "检查截图文件..." -ForegroundColor Yellow
Write-Host ""

$existingScreenshots = @()
$missingScreenshots = @()

foreach ($req in $screenshotRequirements) {
    if (Test-Path $req.FileName) {
        $file = Get-Item $req.FileName
        $existingScreenshots += @{
            Requirement = $req
            FileInfo = $file
        }
    } else {
        $missingScreenshots += $req
    }
}

# 显示检查结果
Write-Host "检查结果：" -ForegroundColor Cyan
Write-Host "  已存在: $($existingScreenshots.Count) 张截图" -ForegroundColor Green
Write-Host "  缺失: $($missingScreenshots.Count) 张截图" -ForegroundColor Red
Write-Host ""

if ($existingScreenshots.Count -gt 0) {
    Write-Host "已存在的截图：" -ForegroundColor Green
    Write-Host "┌─────┬──────────────────────┬──────────────────────┬────────────┐" -ForegroundColor Gray
    Write-Host "│ ID  │ 截图名称             │ 文件大小            │ 修改时间   │" -ForegroundColor Gray
    Write-Host "├─────┼──────────────────────┼──────────────────────┼────────────┤" -ForegroundColor Gray

    foreach ($item in $existingScreenshots) {
        $req = $item.Requirement
        $file = $item.FileInfo
        $size = "$([math]::Round($file.Length / 1KB, 1)) KB"
        $time = $file.LastWriteTime.ToString("MM-dd HH:mm")

        Write-Host ("│ {0,-3} │ {1,-20} │ {2,-20} │ {3,-10} │" -f
            $req.Id,
            $req.Name.Substring(0, [math]::Min(20, $req.Name.Length)),
            $size,
            $time) -ForegroundColor White
    }

    Write-Host "└─────┴──────────────────────┴──────────────────────┴────────────┘" -ForegroundColor Gray
    Write-Host ""
}

if ($missingScreenshots.Count -gt 0) {
    Write-Host "缺失的截图：" -ForegroundColor Red
    Write-Host "┌─────┬──────────────────────┬────────────────────────────────────┬──────────┐" -ForegroundColor Gray
    Write-Host "│ ID  │ 截图名称             │ 描述                               │ 优先级   │" -ForegroundColor Gray
    Write-Host "├─────┼──────────────────────┼────────────────────────────────────┼──────────┤" -ForegroundColor Gray

    foreach ($req in $missingScreenshots) {
        $desc = $req.Description
        if ($desc.Length -gt 30) {
            $desc = $desc.Substring(0, 27) + "..."
        }

        $priorityColor = if ($req.Priority -eq "高") { "Red" }
                        elseif ($req.Priority -eq "中") { "Yellow" }
                        else { "Gray" }

        Write-Host ("│ {0,-3} │ {1,-20} │ {2,-30} │ {3,-8} │" -f
            $req.Id,
            $req.Name.Substring(0, [math]::Min(20, $req.Name.Length)),
            $desc,
            $req.Priority) -ForegroundColor $priorityColor
    }

    Write-Host "└─────┴──────────────────────┴────────────────────────────────────┴──────────┘" -ForegroundColor Gray
    Write-Host ""
}

# 生成截图操作指南
Write-Host "截图操作指南：" -ForegroundColor Cyan
Write-Host ""

$guidelines = @"
## 截图技术要求：
1. **分辨率**：建议1920×1080或更高
2. **格式**：PNG格式，保证清晰度
3. **文件大小**：每张不超过2MB
4. **命名规范**：按编号命名，如01_系统架构图.png

## 截图内容要求：
1. **界面完整**：不裁剪重要功能区域
2. **文字清晰**：所有文字可读
3. **数据真实**：使用测试数据，避免敏感信息
4. **状态正确**：确保界面处于正确状态

## 截图顺序建议：
1. 先准备高优先级的截图（ID 1-7）
2. 再准备中优先级的截图（ID 8-12,14）
3. 最后准备低优先级的截图（ID 13,15）

## 系统启动步骤：
1. 启动Redis服务
2. 启动后端服务（端口3005）
3. 启动前端服务（端口5173）
4. 访问 http://localhost:5173
5. 使用 admin/password123 登录
"@

Write-Host $guidelines -ForegroundColor White
Write-Host ""

# 生成截图清单文件
$checklistContent = @"
# API安全中间件管理系统 - 截图清单
# 生成时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

## 截图需求清单

| ID | 截图名称 | 文件名 | 优先级 | 状态 | 备注 |
|----|----------|--------|--------|------|------|
"@

foreach ($req in $screenshotRequirements) {
    $status = if (Test-Path $req.FileName) { "✅ 已存在" } else { "❌ 缺失" }
    $checklistContent += "| $($req.Id) | $($req.Name) | $($req.FileName) | $($req.Priority) | $status | $($req.Description) |`n"
}

$checklistContent += @"

## 统计信息
- 总需求数: $($screenshotRequirements.Count)
- 已完成: $($existingScreenshots.Count)
- 未完成: $($missingScreenshots.Count)
- 完成率: $([math]::Round($existingScreenshots.Count / $screenshotRequirements.Count * 100, 1))%

## 下一步操作
1. 按照优先级顺序准备缺失的截图
2. 确保截图质量符合要求
3. 将截图插入到用户手册的相应位置
4. 验证所有截图都已正确插入

## 截图质量检查清单
- [ ] 所有截图分辨率足够高
- [ ] 文字清晰可读
- [ ] 界面完整无裁剪
- [ ] 无敏感信息泄露
- [ ] 文件命名规范
- [ ] 文件大小适中
"@

Set-Content -Path "截图清单.md" -Value $checklistContent -Encoding UTF8
Write-Host "已生成截图清单文件: 截图清单.md" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "检查完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "建议操作：" -ForegroundColor Yellow
Write-Host "  1. 查看生成的截图清单.md文件" -ForegroundColor White
Write-Host "  2. 按照优先级准备缺失的截图" -ForegroundColor White
Write-Host "  3. 运行合并脚本生成完整用户手册" -ForegroundColor White
Write-Host ""
Write-Host "按Enter键退出..." -ForegroundColor Gray
Read-Host