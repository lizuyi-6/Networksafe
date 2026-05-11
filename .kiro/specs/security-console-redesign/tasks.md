# Tasks — 安全控制台重新设计

## Task 1: 创建 dashboard 子组件目录和基础组件
- [x] 创建 `frontend/src/components/dashboard/` 目录
- [x] 创建 `MetricBar.tsx` — 紧凑横向指标条组件（6 个 KPI，带趋势箭头）
- [x] 创建 `SystemGauges.tsx` — 4 个环形进度条（CPU/内存/磁盘/网络）
- [x] 确保组件使用现有的 CSS 变量和 Tone 类型系统

## Task 2: 创建 DashboardHeader 组件
- [x] 创建 `DashboardHeader.tsx` — 页面标题 + 时间范围选择器(1h/24h/7d) + 暂停/恢复 + 导出按钮
- [x] 时间范围选择器使用 pill 样式切换
- [x] 保留 `data-testid` 属性兼容性

## Task 3: 创建威胁情报和安全运营面板
- [x] 创建 `ThreatIntelPanel.tsx` — Tab 切换：攻击来源 | 攻击向量
- [x] 创建 `SecurityOpsPanel.tsx` — Tab 切换：活跃规则 | 近期操作
- [x] Tab 组件使用统一的 TabButton 子组件

## Task 4: 重构实时日志流组件
- [x] 创建 `LiveLogStream.tsx` — 全宽布局，内联筛选器
- [x] 日志条目改为紧凑行 + 左侧级别色条（ERROR=红, WARN=黄, INFO=绿）
- [x] 保留暂停、导出功能的 `data-testid`

## Task 5: 创建 AdminKeySection 组件
- [x] 创建 `AdminKeySection.tsx` — 从 Dashboard.tsx 提取 API 密钥管理区域
- [x] 仅 admin 角色可见

## Task 6: 重构 Dashboard.tsx 主页面
- [x] 用新子组件替换所有内联代码
- [x] 实现新的网格布局：MetricBar → Traffic+Gauges → Intel+Ops → Logs → Admin
- [x] 保持所有数据获取逻辑（useEffect hooks）不变
- [x] 保持 WebSocket 订阅逻辑不变
- [x] 确保 LiveMode 和 Demo 模式正常工作

## Task 7: 更新 i18n 文件
- [x] 更新 `frontend/src/locales/zh.json` 添加新 key
- [x] 更新 `frontend/src/locales/en.json` 添加对应英文翻译
- [x] 新增 key: time_7d, threat_intel, security_ops, system_resources, tab_origins, tab_vectors, tab_rules, tab_actions

## Task 8: 视觉微调和动画优化
- [x] 减少动画量：容器级 stagger 替代每个卡片独立动画
- [x] 间距从 gap-6 调整为 gap-4
- [x] 面板标题字号从 text-base 调整为 text-sm
- [x] 确保 light/dark/system 三种主题下视觉一致
