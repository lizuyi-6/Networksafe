/**
 * API Security Middleware - 管理控制台
 * 主应用程序逻辑
 */

// ========================================
// 应用状态
// ========================================
const AppState = {
    currentPage: 'dashboard',
    config: {
        antiBot: {
            enabled: true,
            requestThreshold: 100,
            fastRequestThreshold: 10,
            blockDuration: 3600,
            allowKnownBots: true,
            checkUserAgent: true,
            enableHoneypot: true,
            detectHeadless: true
        },
        rateLimit: {
            requestsPerMinute: 60,
            windowSeconds: 60,
            sendHeaders: true,
            includeRetryAfter: true
        },
        concurrency: {
            maxConcurrent: 5,
            maxQueueSize: 20
        },
        auth: {
            maxLoginAttempts: 5,
            lockoutDuration: 900,
            attemptWindow: 300,
            passwordPolicy: {
                minLength: 8,
                maxLength: 128,
                requireUppercase: true,
                requireLowercase: true,
                requireNumbers: true,
                requireSpecialChars: true
            }
        },
        monitoring: {
            enablePerformance: true,
            slowThreshold: 1000,
            memoryThreshold: 500
        }
    },
    stats: {
        totalRequests: 0,
        blockedRequests: 0,
        rateLimited: 0,
        successRate: 100
    }
};

// ========================================
// 初始化
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initForms();
    initDocs();
    updateTime();
    startSimulation();
    
    // 每秒更新时间
    setInterval(updateTime, 1000);
});

// ========================================
// 导航系统
// ========================================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            navigateTo(page);
        });
    });
    
    // 移动端菜单切换
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }
    
    // 点击外部关闭侧边栏
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        }
    });
}

function navigateTo(page) {
    // 更新导航项
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    // 更新页面显示
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });
    
    AppState.currentPage = page;
    
    // 移动端关闭侧边栏
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
    }
}

// ========================================
// 表单处理
// ========================================
function initForms() {
    // Anti-Bot 保存
    document.getElementById('saveAntiBot')?.addEventListener('click', () => {
        saveAntiBotConfig();
    });
    
    // Rate Limit 保存
    document.getElementById('saveRateLimit')?.addEventListener('click', () => {
        saveRateLimitConfig();
    });
    
    // Concurrency 保存
    document.getElementById('saveConcurrency')?.addEventListener('click', () => {
        saveConcurrencyConfig();
    });
    
    // Auth 保存
    document.getElementById('saveAuth')?.addEventListener('click', () => {
        saveAuthConfig();
    });
    
    // Monitoring 保存
    document.getElementById('saveMonitoring')?.addEventListener('click', () => {
        saveMonitoringConfig();
    });
    
    // IP黑名单添加
    document.getElementById('addIpBlock')?.addEventListener('click', () => {
        addIpToBlocklist();
    });
    
    // 添加User-Agent模式
    document.getElementById('addPattern')?.addEventListener('click', () => {
        addUserAgentPattern();
    });
    
    // 添加路由限制
    document.getElementById('addRoute')?.addEventListener('click', () => {
        addRouteLimit();
    });
    
    // 删除按钮事件委托
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete')) {
            const item = e.target.closest('.pattern-item, tr');
            if (item) {
                item.remove();
                showToast('已删除', 'success');
            }
        }
    });
}

function saveAntiBotConfig() {
    AppState.config.antiBot = {
        enabled: document.getElementById('antiBotEnabled').checked,
        requestThreshold: parseInt(document.getElementById('requestThreshold').value),
        fastRequestThreshold: parseInt(document.getElementById('fastRequestThreshold').value),
        blockDuration: parseInt(document.getElementById('blockDuration').value),
        allowKnownBots: document.getElementById('allowKnownBots').checked,
        checkUserAgent: document.getElementById('checkUserAgent').checked,
        enableHoneypot: document.getElementById('enableHoneypot').checked,
        detectHeadless: document.getElementById('detectHeadless').checked
    };
    
    console.log('Anti-Bot config saved:', AppState.config.antiBot);
    showToast('反机器人配置已保存', 'success');
}

function saveRateLimitConfig() {
    AppState.config.rateLimit = {
        requestsPerMinute: parseInt(document.getElementById('requestsPerMinute').value),
        windowSeconds: parseInt(document.getElementById('windowSeconds').value),
        sendHeaders: document.getElementById('sendHeaders').checked,
        includeRetryAfter: document.getElementById('includeRetryAfter').checked
    };
    
    console.log('Rate Limit config saved:', AppState.config.rateLimit);
    showToast('速率限制配置已保存', 'success');
}

function saveConcurrencyConfig() {
    AppState.config.concurrency = {
        maxConcurrent: parseInt(document.getElementById('maxConcurrent').value),
        maxQueueSize: parseInt(document.getElementById('maxQueueSize').value)
    };
    
    console.log('Concurrency config saved:', AppState.config.concurrency);
    showToast('并发控制配置已保存', 'success');
}

function saveAuthConfig() {
    AppState.config.auth = {
        maxLoginAttempts: parseInt(document.getElementById('maxLoginAttempts').value),
        lockoutDuration: parseInt(document.getElementById('lockoutDuration').value),
        attemptWindow: parseInt(document.getElementById('attemptWindow').value),
        passwordPolicy: {
            minLength: parseInt(document.getElementById('minLength').value),
            maxLength: parseInt(document.getElementById('maxLength').value),
            requireUppercase: document.getElementById('requireUppercase').checked,
            requireLowercase: document.getElementById('requireLowercase').checked,
            requireNumbers: document.getElementById('requireNumbers').checked,
            requireSpecialChars: document.getElementById('requireSpecialChars').checked
        }
    };
    
    console.log('Auth config saved:', AppState.config.auth);
    showToast('认证安全配置已保存', 'success');
}

function saveMonitoringConfig() {
    AppState.config.monitoring = {
        enablePerformance: document.getElementById('enablePerformance').checked,
        slowThreshold: parseInt(document.getElementById('slowThreshold').value),
        memoryThreshold: parseInt(document.getElementById('memoryThreshold').value)
    };
    
    console.log('Monitoring config saved:', AppState.config.monitoring);
    showToast('性能监控配置已保存', 'success');
}

function addIpToBlocklist() {
    const ip = document.getElementById('newIp').value.trim();
    const reason = document.getElementById('blockReason').value;
    const duration = document.getElementById('blockTime').value;
    
    if (!ip) {
        showToast('请输入IP地址', 'error');
        return;
    }
    
    // 验证IP格式
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
        showToast('IP地址格式不正确', 'error');
        return;
    }
    
    const reasonMap = {
        'manual': '手动封禁',
        'bot': '机器人行为',
        'bruteforce': '暴力破解',
        'ratelimit': '速率超限'
    };
    
    const now = new Date();
    const expireTime = duration ? new Date(now.getTime() + parseInt(duration) * 1000) : null;
    
    const tbody = document.getElementById('blockedIps');
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${ip}</td>
        <td>${formatDateTime(now)}</td>
        <td>${expireTime ? formatDateTime(expireTime) : '永久'}</td>
        <td><span class="tag yellow">${reasonMap[reason]}</span></td>
        <td><button class="btn btn-sm">解封</button></td>
    `;
    
    tbody.insertBefore(tr, tbody.firstChild);
    
    // 清空输入
    document.getElementById('newIp').value = '';
    document.getElementById('blockTime').value = '';
    
    showToast(`IP ${ip} 已添加到黑名单`, 'success');
}

function addUserAgentPattern() {
    const pattern = prompt('输入User-Agent模式:');
    if (pattern && pattern.trim()) {
        const patternList = document.getElementById('patternList');
        const div = document.createElement('div');
        div.className = 'pattern-item';
        div.innerHTML = `
            <code>${pattern.trim()}</code>
            <button class="btn-icon delete">×</button>
        `;
        patternList.appendChild(div);
        showToast('模式已添加', 'success');
    }
}

function addRouteLimit() {
    const route = prompt('输入路由路径 (如 /api/users):');
    if (!route) return;
    
    const method = prompt('输入HTTP方法 (GET/POST/PUT/DELETE):', 'POST');
    if (!method) return;
    
    const limit = prompt('输入每分钟请求限制:', '30');
    if (!limit) return;
    
    const tbody = document.getElementById('routeLimits');
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><code>${route}</code></td>
        <td>${method.toUpperCase()}</td>
        <td>${limit}</td>
        <td><button class="btn-icon delete">×</button></td>
    `;
    tbody.appendChild(tr);
    showToast('路由限制已添加', 'success');
}

// ========================================
// 文档导航
// ========================================
function initDocs() {
    const docNav = document.querySelectorAll('.docs-nav li');
    
    docNav.forEach(item => {
        item.addEventListener('click', () => {
            const docId = item.dataset.doc;
            
            // 更新导航
            docNav.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            
            // 更新内容
            document.querySelectorAll('.doc-section').forEach(section => {
                section.classList.toggle('active', section.id === `doc-${docId}`);
            });
        });
    });
}

// ========================================
// 时间更新
// ========================================
function updateTime() {
    const timeEl = document.getElementById('currentTime');
    if (timeEl) {
        timeEl.textContent = new Date().toLocaleTimeString('zh-CN');
    }
}

// ========================================
// 数据模拟
// ========================================
function startSimulation() {
    // 初始化统计数据
    updateStats();
    generateRecentEvents();
    
    // 定期更新模拟数据
    setInterval(() => {
        simulateNewRequests();
        updateChartBars();
    }, 2000);
}

function simulateNewRequests() {
    // 模拟新请求
    const newRequests = Math.floor(Math.random() * 50) + 10;
    const newBlocked = Math.floor(Math.random() * 5);
    const newRateLimited = Math.floor(Math.random() * 3);
    
    AppState.stats.totalRequests += newRequests;
    AppState.stats.blockedRequests += newBlocked;
    AppState.stats.rateLimited += newRateLimited;
    
    const successful = AppState.stats.totalRequests - AppState.stats.blockedRequests - AppState.stats.rateLimited;
    AppState.stats.successRate = Math.round((successful / AppState.stats.totalRequests) * 100);
    
    updateStats();
    
    // 随机生成新事件
    if (Math.random() > 0.7) {
        addNewEvent();
    }
}

function updateStats() {
    document.getElementById('totalRequests').textContent = formatNumber(AppState.stats.totalRequests);
    document.getElementById('blockedRequests').textContent = formatNumber(AppState.stats.blockedRequests);
    document.getElementById('rateLimited').textContent = formatNumber(AppState.stats.rateLimited);
    document.getElementById('successRate').textContent = AppState.stats.successRate + '%';
    
    // 更新并发状态
    document.getElementById('activeConnections').textContent = Math.floor(Math.random() * 30) + 10;
    document.getElementById('queuedRequests').textContent = Math.floor(Math.random() * 10);
    document.getElementById('rejectedRequests').textContent = Math.floor(Math.random() * 20);
}

function updateChartBars() {
    const bars = document.querySelectorAll('.chart-bars .bar');
    bars.forEach(bar => {
        const height = Math.floor(Math.random() * 60) + 20;
        bar.style.height = height + '%';
    });
}

function generateRecentEvents() {
    const events = [
        { time: '16:28:45', type: 'ANTIBOT', ip: '192.168.1.100', detail: 'Suspicious User-Agent: curl/7.68.0', status: 'blocked' },
        { time: '16:28:30', type: 'RATELIMIT', ip: '10.0.0.55', detail: '超过速率限制', status: 'limited' },
        { time: '16:28:15', type: 'AUTH', ip: '203.0.113.50', detail: '登录失败尝试: user@example.com', status: 'warning' },
        { time: '16:28:00', type: 'ANTIBOT', ip: '192.168.1.100', detail: '快速连续请求检测', status: 'blocked' },
        { time: '16:27:45', type: 'CONCURRENCY', ip: '172.16.0.100', detail: '并发请求超限', status: 'limited' }
    ];
    
    const tbody = document.getElementById('recentEvents');
    if (!tbody) return;
    
    tbody.innerHTML = events.map(event => `
        <tr>
            <td>${event.time}</td>
            <td><span class="tag ${getEventTypeColor(event.type)}">${event.type}</span></td>
            <td><code>${event.ip}</code></td>
            <td>${event.detail}</td>
            <td><span class="tag ${getStatusColor(event.status)}">${getStatusText(event.status)}</span></td>
        </tr>
    `).join('');
}

function addNewEvent() {
    const eventTypes = ['ANTIBOT', 'RATELIMIT', 'AUTH', 'CONCURRENCY'];
    const statuses = ['blocked', 'limited', 'warning'];
    const ips = ['192.168.1.' + Math.floor(Math.random() * 255), '10.0.0.' + Math.floor(Math.random() * 255)];
    const details = [
        'Suspicious User-Agent detected',
        '超过速率限制',
        '登录失败尝试',
        '并发请求超限',
        'Bot行为检测触发'
    ];
    
    const now = new Date();
    const event = {
        time: now.toLocaleTimeString('zh-CN').slice(0, 8),
        type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
        ip: ips[Math.floor(Math.random() * ips.length)],
        detail: details[Math.floor(Math.random() * details.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)]
    };
    
    const tbody = document.getElementById('recentEvents');
    if (!tbody) return;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${event.time}</td>
        <td><span class="tag ${getEventTypeColor(event.type)}">${event.type}</span></td>
        <td><code>${event.ip}</code></td>
        <td>${event.detail}</td>
        <td><span class="tag ${getStatusColor(event.status)}">${getStatusText(event.status)}</span></td>
    `;
    
    tbody.insertBefore(tr, tbody.firstChild);
    
    // 保持最多10条
    while (tbody.children.length > 10) {
        tbody.removeChild(tbody.lastChild);
    }
}

// ========================================
// Toast 通知
// ========================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${getToastIcon(type)}</span>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function getToastIcon(type) {
    switch (type) {
        case 'success': return '✅';
        case 'error': return '❌';
        case 'warning': return '⚠️';
        default: return 'ℹ️';
    }
}

// ========================================
// 工具函数
// ========================================
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function formatDateTime(date) {
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function getEventTypeColor(type) {
    switch (type) {
        case 'ANTIBOT': return 'red';
        case 'RATELIMIT': return 'yellow';
        case 'AUTH': return 'blue';
        case 'CONCURRENCY': return 'green';
        default: return 'blue';
    }
}

function getStatusColor(status) {
    switch (status) {
        case 'blocked': return 'red';
        case 'limited': return 'yellow';
        case 'warning': return 'yellow';
        case 'allowed': return 'green';
        default: return 'blue';
    }
}

function getStatusText(status) {
    switch (status) {
        case 'blocked': return '已拦截';
        case 'limited': return '已限制';
        case 'warning': return '警告';
        case 'allowed': return '通过';
        default: return status;
    }
}

// ========================================
// API 调用（预留接口）
// ========================================
const API = {
    baseUrl: '/api',
    
    async getConfig() {
        // TODO: 从后端获取配置
        return AppState.config;
    },
    
    async saveConfig(section, data) {
        // TODO: 保存配置到后端
        console.log(`Saving ${section} config:`, data);
        return { success: true };
    },
    
    async getStats() {
        // TODO: 从后端获取统计数据
        return AppState.stats;
    },
    
    async getBlockedIps() {
        // TODO: 从后端获取IP黑名单
        return [];
    },
    
    async blockIp(ip, reason, duration) {
        // TODO: 添加IP到黑名单
        console.log(`Blocking IP: ${ip}, reason: ${reason}, duration: ${duration}`);
        return { success: true };
    },
    
    async unblockIp(ip) {
        // TODO: 从黑名单移除IP
        console.log(`Unblocking IP: ${ip}`);
        return { success: true };
    },
    
    async getLogs(filters) {
        // TODO: 获取日志
        console.log('Getting logs with filters:', filters);
        return [];
    }
};

// 导出到全局（用于调试）
window.AppState = AppState;
window.API = API;
