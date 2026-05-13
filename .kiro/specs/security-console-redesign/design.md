# 安全控制台重新设计 — 技术设计文档

## 概述

对 AetherGuard 安全控制台（`/dashboard`）进行全面的布局和视觉重构。保留所有现有功能模块，但重新设计信息架构、布局结构、交互模式和视觉风格，使其更现代、更专业、信息密度更合理。

---

## 一、High-Level Design

### 1.1 设计目标

| 目标 | 描述 |
|------|------|
| 信息层次 | 从"平铺卡片"改为"分层聚焦"：核心指标 → 趋势分析 → 详细数据 |
| 视觉密度 | 减少 3 行 12 张统计卡片的视觉噪音，合并为更紧凑的指标区 |
| 专业感 | 对标 Datadog / Grafana 风格的安全运营中心（SOC）仪表盘 |
| 响应式 | 桌面端 3 列布局，平板 2 列，移动端单列 |
| 性能 | 保持 WebSocket 实时推送 + 轮询双模式，减少不必要的重渲染 |

### 1.2 新布局架构

```
┌─────────────────────────────────────────────────────────────────┐
│  页面标题 + 副标题 + 时间范围选择器 + 导出按钮                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  指标条 (Metric Bar)                                         ││
│  │  [请求量] [拦截数] [成功率] [P99延迟] [活跃连接] [高危发现]     ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │  流量趋势 (主图)          │  │  系统资源 (迷你仪表盘)        │ │
│  │  面积图 + 时间范围切换     │  │  CPU / 内存 / 磁盘 / 网络    │ │
│  │  + 拦截高峰标注           │  │  环形进度 + 数值              │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │  威胁情报面板             │  │  安全运营面板                 │ │
│  │  攻击来源地图/条形图      │  │  活跃规则 + 近期操作          │ │
│  │  + 攻击向量分布           │  │  合并为 Tab 切换              │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  实时日志流 (全宽)                                           ││
│  │  筛选 + 暂停 + 导出 + 日志级别高亮                            ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  管理员区域 (仅 admin 可见)                                   ││
│  │  API 密钥管理                                                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 组件架构

```
Dashboard.tsx (页面容器)
├── DashboardHeader          — 标题 + 时间范围 + 全局操作
├── MetricBar                — 横向指标条（6 个核心 KPI）
├── TrafficSection           — 左: 流量趋势图 / 右: 系统资源仪表
│   ├── TrafficTrendChart    — Recharts 面积图（重构）
│   └── SystemGauges         — 4 个环形进度条
├── IntelOpsSection          — 左: 威胁情报 / 右: 安全运营
│   ├── ThreatIntelPanel     — 攻击来源 + 向量分布
│   └── SecurityOpsPanel     — Tab: 活跃规则 | 近期操作
├── LiveLogSection           — 全宽实时日志流
│   └── LogStream            — 重构后的日志组件
└── AdminSection             — API 密钥（条件渲染）
```

### 1.4 数据流

```
                    ┌─────────────┐
                    │  Backend    │
                    │  /api/stats │
                    └──────┬──────┘
                           │ HTTP (4s 轮询 / LiveMode)
                           ▼
              ┌────────────────────────┐
              │   Dashboard State      │
              │   (useState hooks)     │
              └────────────┬───────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   MetricBar        TrafficSection    IntelOpsSection
                           │
                    ┌──────┴──────┐
                    ▼             ▼
            TrafficChart    SystemGauges

WebSocket (agent:log) ──────────► LiveLogSection
```

数据源不变：
- `fetchStats()` → 统计数据 + 历史 + 攻击来源 + 安全运营摘要
- `fetchLogs()` → 初始日志
- `subscribe('agent:log')` → 实时日志推送
- `fetchDashboardRulesSummary()` → 规则摘要
- `fetchAdminApiKeys()` → API 密钥（admin only）
- `fetchCurrentUserSession()` → 用户角色

---

## 二、Low-Level Design

### 2.1 MetricBar 组件

```tsx
// 紧凑的横向指标条，替代原来 3 行 12 张卡片
interface MetricItem {
  icon: LucideIcon;
  label: string;
  value: string | number;
  trend?: number;       // 百分比变化，正数为上升
  tone: Tone;
}

const MetricBar = ({ items }: { items: MetricItem[] }) => (
  <motion.div variants={fadeUpVariants} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
    {items.map((item, i) => (
      <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:shadow-sm">
        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${toneClasses[item.tone]}`}>
          <item.icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{item.label}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-foreground">{item.value}</span>
            {item.trend !== undefined && (
              <span className={`text-xs font-medium ${item.trend >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {item.trend >= 0 ? '↑' : '↓'}{Math.abs(item.trend)}%
              </span>
            )}
          </div>
        </div>
      </div>
    ))}
  </motion.div>
);
```

### 2.2 SystemGauges 组件

```tsx
// 环形进度条展示系统资源
interface GaugeProps {
  label: string;
  value: number;       // 0-100
  unit?: string;
  tone: Tone;
}

const SystemGauges = ({ gauges }: { gauges: GaugeProps[] }) => (
  <div className="grid grid-cols-2 gap-4">
    {gauges.map((g, i) => (
      <div key={i} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4">
        <svg viewBox="0 0 36 36" className="w-16 h-16">
          {/* 背景环 */}
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="hsl(var(--muted))" strokeWidth="3"
          />
          {/* 进度环 */}
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="3"
            strokeDasharray={`${g.value}, 100`}
            className={toneClasses[g.tone].split(' ')[1]}  // 取文字颜色
          />
        </svg>
        <span className="text-xl font-bold text-foreground">{g.value}%</span>
        <span className="text-xs text-muted-foreground">{g.label}</span>
      </div>
    ))}
  </div>
);
```

### 2.3 ThreatIntelPanel 组件

```tsx
// 攻击来源 + 攻击向量分布合并面板
const ThreatIntelPanel = ({ origins, threats }: {
  origins: AttackOrigin[];
  threats: ThreatItem[];
}) => {
  const [tab, setTab] = useState<'origins' | 'vectors'>('origins');

  return (
    <ConsolePanel title={t('dashboard.threat_intel')} icon={Globe} iconTone="warning">
      {/* Tab 切换 */}
      <div className="flex gap-1 mb-4 rounded-lg bg-muted p-1">
        <TabButton active={tab === 'origins'} onClick={() => setTab('origins')}>
          {t('dashboard.attack_sources')}
        </TabButton>
        <TabButton active={tab === 'vectors'} onClick={() => setTab('vectors')}>
          {t('dashboard.top_vectors')}
        </TabButton>
      </div>

      {tab === 'origins' ? (
        <AttackOriginsChart origins={origins} />
      ) : (
        <ThreatVectorsChart threats={threats} />
      )}
    </ConsolePanel>
  );
};
```

### 2.4 SecurityOpsPanel 组件

```tsx
// 活跃规则 + 近期操作合并为 Tab 面板
const SecurityOpsPanel = ({ rules, actions, validations }: {
  rules: { totalRules: number; topRules: any[] };
  actions: DashboardSecuritySummary['recentActions'];
  validations: DashboardSecuritySummary['recentValidations'];
}) => {
  const [tab, setTab] = useState<'rules' | 'actions'>('rules');

  return (
    <ConsolePanel title={t('dashboard.security_ops')} icon={Shield} iconTone="primary">
      <div className="flex gap-1 mb-4 rounded-lg bg-muted p-1">
        <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>
          {t('dashboard.active_rules')} ({rules.totalRules})
        </TabButton>
        <TabButton active={tab === 'actions'} onClick={() => setTab('actions')}>
          {t('dashboard.recent_actions')}
        </TabButton>
      </div>

      {tab === 'rules' ? (
        <RulesList rules={rules.topRules} />
      ) : (
        <ActionsList actions={actions} validations={validations} />
      )}
    </ConsolePanel>
  );
};
```

### 2.5 DashboardHeader 组件

```tsx
// 页面顶部：标题 + 全局操作
const DashboardHeader = ({ timeRange, onTimeRangeChange, onExport, paused, onTogglePause }: {
  timeRange: '1h' | '24h' | '7d';
  onTimeRangeChange: (range: '1h' | '24h' | '7d') => void;
  onExport: (format: 'json' | 'csv') => void;
  paused: boolean;
  onTogglePause: () => void;
}) => (
  <motion.div variants={fadeUpVariants} className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="space-y-1">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('dashboard.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
    </div>
    <div className="flex items-center gap-3 flex-wrap">
      {/* 时间范围选择器 */}
      <div className="flex rounded-lg border border-border bg-muted p-0.5">
        {(['1h', '24h', '7d'] as const).map((range) => (
          <button
            key={range}
            onClick={() => onTimeRangeChange(range)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              timeRange === range
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`dashboard.time_${range}`)}
          </button>
        ))}
      </div>
      {/* 暂停/恢复 */}
      <button onClick={onTogglePause} className="...">
        {paused ? <Play size={16} /> : <Pause size={16} />}
      </button>
      {/* 导出 */}
      <button onClick={() => onExport('json')} className="...">
        <Download size={16} />
      </button>
    </div>
  </motion.div>
);
```

### 2.6 重构后的 LogStream

```tsx
// 改进：虚拟滚动 + 日志级别颜色条 + 更紧凑的布局
const LogStream = ({ logs, filterQuery, onFilterChange, emptyText }: {
  logs: LogItem[];
  filterQuery: string;
  onFilterChange: (q: string) => void;
  emptyText: string;
}) => (
  <div className="space-y-3">
    {/* 内联筛选器 */}
    <div className="relative">
      <Search className="absolute left-3 top-2.5 text-muted-foreground" size={14} />
      <input
        value={filterQuery}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder={t('dashboard.filter_placeholder')}
        className="w-full rounded-lg border border-border bg-muted/30 py-2 pl-9 pr-3 text-sm"
      />
    </div>
    {/* 日志列表 */}
    <div className="h-[400px] overflow-y-auto rounded-xl border border-border bg-muted/10 p-3 font-mono text-xs space-y-1.5">
      {logs.map((log) => (
        <div key={log.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/20 transition-colors">
          {/* 级别指示条 */}
          <div className={`w-1 h-full min-h-[20px] rounded-full ${
            log.level === 'ERROR' ? 'bg-rose-500' :
            log.level === 'WARN' ? 'bg-amber-500' : 'bg-emerald-500'
          }`} />
          <span className="w-16 shrink-0 text-muted-foreground">{new Date(log.time).toLocaleTimeString()}</span>
          <span className="w-10 shrink-0 font-bold">{log.status || 200}</span>
          <span className="w-10 shrink-0 text-primary font-semibold">{log.type}</span>
          <span className="break-all text-foreground">{log.message}</span>
        </div>
      ))}
      {logs.length === 0 && (
        <div className="py-12 text-center text-muted-foreground font-sans">{emptyText}</div>
      )}
    </div>
  </div>
);
```

### 2.7 视觉风格变更

| 方面 | 当前 | 重构后 |
|------|------|--------|
| 统计卡片 | 3×4 大卡片，hover 上浮 | 1 行紧凑指标条，带趋势箭头 |
| 面板圆角 | `rounded-xl` | 保持 `rounded-xl`，减少内边距 |
| 面板标题 | 图标 + 标题 + 副标题 | 保持，但标题更小 (`text-sm`) |
| 图表 | 单一面积图 | 面积图 + 环形仪表盘 |
| 日志 | 全卡片式每条日志 | 紧凑行 + 左侧级别色条 |
| 动画 | 每个卡片独立 fadeUp | 容器级 stagger，减少动画量 |
| 间距 | `gap-6` 大间距 | `gap-4` 更紧凑 |
| 颜色 | 使用 CSS 变量 | 保持，增加渐变背景点缀 |

### 2.8 新增时间范围

增加 `7d` 选项（原来只有 1h / 24h），需要后端 `fetchStats` 支持 `?range=7d` 参数。

### 2.9 文件结构

```
frontend/src/pages/Dashboard.tsx          — 主页面（重构）
frontend/src/components/dashboard/
├── DashboardHeader.tsx                   — 页面头部
├── MetricBar.tsx                         — 指标条
├── TrafficTrendChart.tsx                 — 流量趋势图
├── SystemGauges.tsx                      — 系统资源环形图
├── ThreatIntelPanel.tsx                  — 威胁情报面板
├── SecurityOpsPanel.tsx                  — 安全运营面板
├── LiveLogStream.tsx                     — 实时日志流
└── AdminKeySection.tsx                   — API 密钥区域
```

### 2.10 i18n 新增 Key

```json
{
  "dashboard": {
    "time_7d": "7 天",
    "threat_intel": "威胁情报",
    "security_ops": "安全运营",
    "system_resources": "系统资源",
    "metric_bar_title": "核心指标",
    "trend_up": "↑ {n}%",
    "trend_down": "↓ {n}%",
    "tab_origins": "攻击来源",
    "tab_vectors": "攻击向量",
    "tab_rules": "活跃规则",
    "tab_actions": "近期操作"
  }
}
```

---

## 三、迁移策略

1. **新建** `frontend/src/components/dashboard/` 目录，逐个实现子组件
2. **重构** `Dashboard.tsx`，用新子组件替换内联代码
3. **保持** 所有 API 调用和数据流不变
4. **保持** 所有 `data-testid` 属性（或添加新的），确保 E2E 测试兼容
5. **更新** i18n 文件（zh.json + en.json）
6. **不需要** 后端改动（7d range 可选，先用前端 slice 实现）

---

## 四、不在范围内

- 后端 API 结构变更
- 新增数据源或 WebSocket 事件
- 路由变更（仍然是 `/dashboard`）
- 移动端专用布局（响应式即可）
