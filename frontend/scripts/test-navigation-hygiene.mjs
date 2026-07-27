import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(frontendRoot, 'src');
const sourceFiles = [];

function collectSourceFiles(directory) {
    for (const directoryEntry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, directoryEntry.name);
        if (directoryEntry.isDirectory()) {
            collectSourceFiles(entryPath);
            continue;
        }
        if (/\.tsx?$/.test(directoryEntry.name)) {
            sourceFiles.push(entryPath);
        }
    }
}

collectSourceFiles(sourceRoot);

const violations = [];
for (const sourceFile of sourceFiles) {
    const sourceText = fs.readFileSync(sourceFile, 'utf8');
    const relativePath = path.relative(frontendRoot, sourceFile);

    for (const match of sourceText.matchAll(/to=\{`[^`]*\$\{([^}]*)\}[^`]*`\}/g)) {
        if (!match[1].trim().startsWith('encodeURIComponent(')) {
            violations.push(`${relativePath}: dynamic Link route segment must use encodeURIComponent(): ${match[0]}`);
        }
    }

    for (const match of sourceText.matchAll(/to=\{(?![`'"])([^}\n]+)\}/g)) {
        if (!match[1].includes('requireInternalRoute(')) {
            violations.push(`${relativePath}: variable Link destination must use requireInternalRoute(): ${match[0]}`);
        }
    }

    for (const match of sourceText.matchAll(/navigate\(\s*(?!['"`{]|-?\d+\s*\))([^,\n]+)/g)) {
        if (!match[1].trim().startsWith('requireInternalRoute(')) {
            violations.push(`${relativePath}: variable navigate() destination must use requireInternalRoute(): ${match[0]}`);
        }
    }

    for (const match of sourceText.matchAll(/(?:to=|navigate\()\s*["'`]([^"'`]+)["'`]/g)) {
        const destination = match[1];
        if (destination.startsWith('//') || destination.includes('\\')) {
            violations.push(`${relativePath}: unsafe route literal: ${destination}`);
        }
    }
}

if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`);
    process.exit(1);
}

process.stdout.write(`navigation_hygiene=passed files=${sourceFiles.length}\n`);
