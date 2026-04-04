// Fix Agents.tsx - replace hardcoded Chinese
const fs = require('fs');
let content = fs.readFileSync('src/pages/Agents.tsx', 'utf8');

// Replace formatUptime function
content = content.replace(
    /const formatUptime = \(seconds: number\): string => \{\s*const d = Math\.floor\(seconds \/ 86400\);\s*const h = Math\.floor\(\(seconds % 86400\) \/ 3600\);\s*const m = Math\.floor\(\(seconds % 3600\) \/ 60\);\s*let result = '';\s*if \(d > 0\) result \+= `\$\{d\}天`;\s*if \(h > 0\) result \+= `\$\{h\}小时`;\s*if \(m > 0\) result \+= `\$\{m\}分钟`;\s*return result \|\| '0分钟';\s*\};/,
    `const formatUptime = (seconds: number): string => {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const day = t('agents.day') || 'd';
        const hour = t('agents.hour') || 'h';
        const minute = t('agents.minute') || 'm';
        let result = '';
        if (d > 0) result += \`\${d}\${day}\`;
        if (h > 0) result += \`\${h}\${hour}\`;
        if (m > 0) result += \`\${m}\${minute}\`;
        return result || \`0\${minute}\`;
    };`
);

// Replace hardcoded strings
content = content.replace(/title="智能体" subtitle="[^"]*"/, `title={t('agents.title')} subtitle={t('agents.subtitle')}`);
content = content.replace(/>刷新</g, `>{t('agents.refresh')}<`);
content = content.replace(/label="总智能体"/, `label={t('agents.total_agents')}`);
content = content.replace(/label="在线节点"/, `label={t('agents.online_nodes')}`);
content = content.replace(/label="近期威胁"/, `label={t('agents.recent_threats')}`);
content = content.replace(/label="在线率"/, `label={t('agents.online_rate')}`);
content = content.replace(/>发起扫描</g, `>{t('agents.initiate_scan')}<`);
content = content.replace(/event\.title \|\| '安全事件'/g, `event.title || t('agents.security_event') || 'Security Event'`);

fs.writeFileSync('src/pages/Agents.tsx', content);
console.log('Agents.tsx updated!');
