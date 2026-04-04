// Fix AlertDetail.tsx - replace hardcoded Chinese
const fs = require('fs');
let content = fs.readFileSync('src/pages/AlertDetail.tsx', 'utf8');

content = content.replace(/title="告警详情" subtitle="[^"]*"/, `title={t('alertDetail.title')} subtitle={t('alertDetail.subtitle')}`);
content = content.replace(/返回告警中心/g, t('alertDetail.back'));
content = content.replace(/title="正在加载告警详情"/g, `title={t('alertDetail.loading')}`);
content = content.replace(/严重级别/g, t('alertDetail.severity_level'));
content = content.replace(/状态/g, t('alertDetail.status'));
content = content.replace(/来源/g, t('alertDetail.source'));
content = content.replace(/时间/g, t('alertDetail.time'));
content = content.replace(/title="证据与关联扫描"/g, `title={t('alertDetail.evidence')}`);
content = content.replace(/title="暂无结构化证据"/g, `title={t('alertDetail.no_evidence')}`);
content = content.replace(/title="时间线"/g, `title={t('alertDetail.timeline')}`);
content = content.replace(/title="暂无关联动作"/g, `title={t('alertDetail.no_actions')}`);

// Replace useLanguage import if missing
if (!content.includes("useLanguage")) {
    content = content.replace(
        "import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';",
        "import { useLanguage } from '../context/LanguageContext';\nimport { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';"
    );
    // Add const { t } = useLanguage() in the component
    content = content.replace(
        "const AlertDetail = () => {\n    const { id = '' } = useParams();",
        "const AlertDetail = () => {\n    const { t } = useLanguage();\n    const { id = '' } = useParams();"
    );
}

fs.writeFileSync('src/pages/AlertDetail.tsx', content);
console.log('AlertDetail.tsx updated!');
