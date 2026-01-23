@echo off
chcp 65001 >nul
echo ========================================
echo   API安全中间件管理系统 - 用户手册合并工具
echo ========================================
echo.

REM 检查必要的文件是否存在
if not exist "用户手册_第1部分_封面目录概述.md" (
    echo 错误: 找不到 用户手册_第1部分_封面目录概述.md
    pause
    exit /b 1
)

if not exist "用户手册_第2部分_安装部署基本使用.md" (
    echo 错误: 找不到 用户手册_第2部分_安装部署基本使用.md
    pause
    exit /b 1
)

if not exist "用户手册_第3部分_系统使用指南.md" (
    echo 错误: 找不到 用户手册_第3部分_系统使用指南.md
    pause
    exit /b 1
)

echo 正在合并用户手册文件...
echo.

REM 创建完整的用户手册文件
echo 创建 完整用户手册.md ...
(
    echo # API安全中间件管理系统 - 完整用户手册
    echo.
    echo **软件名称：** API安全中间件管理系统
    echo **版本号：** V1.0
    echo **申请人：** [请填写申请人姓名]
    echo **申请日期：** [请填写申请日期]
    echo.
    echo ---
    echo.
) > "完整用户手册.md"

REM 合并第一部分
echo 添加第一部分：封面目录概述...
type "用户手册_第1部分_封面目录概述.md" >> "完整用户手册.md"

REM 合并第二部分
echo 添加第二部分：安装部署基本使用...
echo. >> "完整用户手册.md"
echo --- >> "完整用户手册.md"
echo. >> "完整用户手册.md"
type "用户手册_第2部分_安装部署基本使用.md" >> "完整用户手册.md"

REM 合并第三部分
echo 添加第三部分：系统使用指南...
echo. >> "完整用户手册.md"
echo --- >> "完整用户手册.md"
echo. >> "完整用户手册.md"
type "用户手册_第3部分_系统使用指南.md" >> "完整用户手册.md"

REM 添加页码标记
echo. >> "完整用户手册.md"
echo --- >> "完整用户手册.md"
echo. >> "完整用户手册.md"
echo # 用户手册结束
echo.
echo **总页数：** 约15页（包含截图位置）
echo **截图数量：** 15张以上
echo **生成时间：** %date% %time%
echo.
echo ========================================
echo 用户手册合并完成！
echo ========================================

echo.
echo 操作完成！
echo.
echo 生成的文件：
echo   1. 完整用户手册.md - 完整的用户手册文档
echo.
echo 下一步操作：
echo   1. 准备15张系统运行截图
echo   2. 将截图插入到标注的位置
echo   3. 转换为Word或PDF格式用于打印
echo.
echo 按任意键退出...
pause >nul