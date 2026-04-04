import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.join(repoRoot, 'docs', 'legal', 'softcopyright');
const pageSize = 50;

const bundles = [
  {
    id: 'frontend',
    sideLabel: '前端源代码打印稿',
    htmlName: 'aetherguard_v1_frontend_source_print.html',
    textName: 'aetherguard_v1_frontend_source_print.txt',
    selections: [
      { file: 'frontend/src/App.tsx', start: 1, end: 574 },
      { file: 'frontend/src/pages/Dashboard.tsx', start: 1, end: 533 },
      { file: 'frontend/src/pages/Devices.tsx', start: 1, end: 443 },
    ],
  },
  {
    id: 'backend',
    sideLabel: '后端源代码打印稿',
    htmlName: 'aetherguard_v1_backend_source_print.html',
    textName: 'aetherguard_v1_backend_source_print.txt',
    selections: [
      { file: 'backend/src/index.ts', start: 1, end: 162 },
      { file: 'backend/src/websocket/agent-gateway.ts', start: 1, end: 700 },
      { file: 'backend/src/api/routes/devices.routes.ts', start: 1, end: 688 },
    ],
  },
];

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function summarisePage(records) {
  const parts = [];
  const grouped = new Map();

  for (const record of records) {
    const current = grouped.get(record.file);
    if (!current) {
      grouped.set(record.file, { start: record.originalLine, end: record.originalLine });
      continue;
    }
    current.end = record.originalLine;
  }

  for (const [file, range] of grouped.entries()) {
    parts.push(`${file}:${range.start}-${range.end}`);
  }

  return parts.join(' | ');
}

async function loadRecords(selection) {
  const fullPath = path.join(repoRoot, selection.file);
  const raw = await fs.readFile(fullPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const end = Math.min(selection.end, lines.length);
  const selected = [];

  for (let index = selection.start; index <= end; index += 1) {
    selected.push({
      file: selection.file,
      shortFile: selection.file.replace(/^.*?src\//, 'src/'),
      originalLine: index,
      text: lines[index - 1] ?? '',
    });
  }

  return selected;
}

function chunk(records, size) {
  const pages = [];
  for (let index = 0; index < records.length; index += size) {
    pages.push(records.slice(index, index + size));
  }
  return pages;
}

function buildText(bundle, records) {
  const lines = [];
  lines.push(bundle.sideLabel);
  lines.push('软件名称: AetherGuard 智能服务器安全防御平台 V1.0');
  lines.push(`生成时间: ${new Date().toISOString()}`);
  lines.push('');

  for (const record of records) {
    const logical = String(record.originalLine).padStart(4, '0');
    lines.push(`[${record.shortFile}:${logical}] ${record.text}`);
  }

  return lines.join('\n');
}

function buildHtml(bundle, pages, totalLines) {
  const totalPages = pages.length;
  const pageHtml = pages
    .map((records, pageIndex) => {
      const summary = summarisePage(records);
      const rows = records
        .map((record) => {
          const source = `${record.shortFile}:${String(record.originalLine).padStart(4, '0')}`;
          return `
            <div class="code-line">
              <span class="source">${escapeHtml(source)}</span>
              <span class="code">${escapeHtml(record.text)}</span>
            </div>
          `;
        })
        .join('');

      return `
        <section class="page">
          <header class="page-header">
            <div class="title-group">
              <div class="software-name">AetherGuard 智能服务器安全防御平台 V1.0</div>
              <div class="bundle-name">${bundle.sideLabel}</div>
            </div>
            <div class="page-index">第 ${pageIndex + 1} / ${totalPages} 页</div>
          </header>
          <div class="page-summary">${escapeHtml(summary)}</div>
          <div class="code-block">${rows}</div>
          <footer class="page-footer">每页 50 行，本稿共 ${totalLines} 行。</footer>
        </section>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${bundle.sideLabel}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 0;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Consolas", "Cascadia Mono", "Microsoft YaHei UI", monospace;
      color: #101828;
      background: #e5e7eb;
    }

    .page {
      width: 297mm;
      height: 210mm;
      page-break-after: always;
      background: #ffffff;
      padding: 10mm 10mm 8mm;
      display: flex;
      flex-direction: column;
      gap: 3mm;
    }

    .page:last-child {
      page-break-after: auto;
    }

    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      border-bottom: 0.4mm solid #d0d5dd;
      padding-bottom: 2mm;
    }

    .software-name {
      font-size: 10pt;
      font-weight: 700;
    }

    .bundle-name {
      margin-top: 0.8mm;
      font-size: 9pt;
      color: #475467;
    }

    .page-index {
      font-size: 9pt;
      font-weight: 700;
      color: #344054;
    }

    .page-summary {
      font-size: 8pt;
      color: #475467;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .code-block {
      flex: 1;
      border: 0.3mm solid #d0d5dd;
      background: #fcfcfd;
      padding: 2.2mm 2.4mm;
      display: grid;
      grid-template-rows: repeat(50, 1fr);
      overflow: hidden;
    }

    .code-line {
      display: grid;
      grid-template-columns: 56mm 1fr;
      column-gap: 2.4mm;
      align-items: center;
      font-size: 7.4pt;
      line-height: 1;
      white-space: pre;
      overflow: hidden;
    }

    .source {
      color: #475467;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .code {
      overflow: hidden;
      text-overflow: clip;
    }

    .page-footer {
      border-top: 0.4mm solid #d0d5dd;
      padding-top: 1.6mm;
      font-size: 8pt;
      color: #667085;
      text-align: right;
    }
  </style>
</head>
<body>
  ${pageHtml}
</body>
</html>`;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const manifestLines = [
    '# AetherGuard 主平台版源代码打印稿范围',
    '',
    '软件名称：AetherGuard 智能服务器安全防御平台 V1.0',
    '',
  ];

  let totalPages = 0;

  for (const bundle of bundles) {
    const records = [];

    for (const selection of bundle.selections) {
      const loaded = await loadRecords(selection);
      records.push(...loaded);
    }

    if (records.length % pageSize !== 0) {
      throw new Error(`${bundle.id} line count ${records.length} is not divisible by ${pageSize}`);
    }

    const pages = chunk(records, pageSize);
    totalPages += pages.length;

    await fs.writeFile(path.join(outputDir, bundle.htmlName), buildHtml(bundle, pages, records.length), 'utf8');
    await fs.writeFile(path.join(outputDir, bundle.textName), buildText(bundle, records), 'utf8');

    manifestLines.push(`## ${bundle.sideLabel}`);
    manifestLines.push(`- 总行数：${records.length}`);
    manifestLines.push(`- 总页数：${pages.length} 页`);
    for (const selection of bundle.selections) {
      manifestLines.push(`- ${selection.file} 第 ${selection.start} - ${selection.end} 行`);
    }
    manifestLines.push('');
  }

  manifestLines.push(`合计页数：${totalPages} 页`);

  await fs.writeFile(
    path.join(outputDir, 'aetherguard_v1_source_selection.md'),
    manifestLines.join('\n'),
    'utf8',
  );

  console.log('Generated code print HTML and text artifacts.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
