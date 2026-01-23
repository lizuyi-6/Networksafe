#!/usr/bin/env node
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { MockAIService, AISolution } from './MockAI';
import { AuditService } from './AuditService';

const aiService = new MockAIService();
const auditService = new AuditService();

async function main() {
    console.clear();
    console.log(chalk.blue.bold("🛡️  Intelligent Security Middleware Installer v0.3.1"));
    console.log(chalk.gray("   Powered by AI Self-Healing Engine (Bandwidth Optimized)\n"));

    await auditService.log('INSTALLATION_START', { version: '0.3.1' });

    // 1. Environment Detection
    const spinner = ora('Detecting server environment...').start();
    await new Promise(r => setTimeout(r, 1000));
    spinner.succeed(chalk.green('Environment: Node.js v18 (Linux)'));
    await auditService.log('ENV_DETECTED', { os: 'linux', node: 'v18' });

    // 2. Simulate Installation
    await performInstallation();
}

async function performInstallation() {
    console.log(chalk.cyan(`\nStarting installation process...\n`));
    const spinner = ora('Configuring network bindings...').start();
    await new Promise(r => setTimeout(r, 1500));

    // Specific Error Signature that triggers Code 10001
    const errorMsg = 'EACCES: permission denied, open \'/etc/security/config.json\'';
    spinner.fail(chalk.red(`Installation Failed! Error: ${errorMsg}`));

    // LOGGING: This should be compressed to errCode: 10001
    await auditService.log('INSTALLATION_ERROR', { error: errorMsg }, 'FAILURE');

    // 3. AI Analysis
    const { askAI } = await inquirer.prompt([{
        type: 'confirm',
        name: 'askAI',
        message: 'Analyze error with AI?',
        default: true
    }]);

    if (!askAI) {
        console.log('Installation aborted.');
        await auditService.log('USER_ABORT', { reason: 'Decline AI' }, 'FAILURE');
        return;
    }

    const aiSpinner = ora('Consulting AI Knowledge Base...').start();
    const solutions = await aiService.analyzeError(errorMsg);
    aiSpinner.succeed(chalk.green(`AI found ${solutions.length} solutions.`));

    await auditService.log('AI_ANALYSIS_COMPLETE', { solutions_count: solutions.length });

    // 4. Solution Iteration Loop
    for (let i = 0; i < solutions.length; i++) {
        const sol = solutions[i];
        console.log(chalk.yellow(`\n--- Solution ${i + 1}/${solutions.length} ---`));
        console.log(chalk.white.bold(`Description: `) + sol.description);
        console.log(chalk.white.bold(`Command:     `) + chalk.cyan(sol.command));
        console.log(chalk.white.bold(`Risk:        `) + getRiskColor(sol.risk)(sol.risk));

        const { execute } = await inquirer.prompt([{
            type: 'confirm',
            name: 'execute',
            message: 'Execute this solution?',
            default: true
        }]);

        if (execute) {
            // LOGGING: This should be compressed to cmdCode: 20001
            await auditService.log('USER_APPROVED_FIX', { solutionId: sol.id, command: sol.command });

            const fixed = await simulateFixExecution(sol);
            if (fixed) {
                console.log(chalk.green('\n✅ Installation Completed Successfully!'));
                await auditService.log('INSTALLATION_SUCCESS', { appliedFix: sol.id });
                return;
            } else {
                console.log(chalk.red('\n❌ Solution failed.'));
                await auditService.log('FIX_FAILED', { solutionId: sol.id }, 'FAILURE');
            }
        } else {
            await auditService.log('USER_REJECTED_FIX', { solutionId: sol.id }, 'SKIPPED');
        }
    }
}

function getRiskColor(risk: string) {
    switch (risk) {
        case 'High': return chalk.red;
        case 'Medium': return chalk.yellow;
        default: return chalk.green;
    }
}

async function simulateFixExecution(sol: AISolution): Promise<boolean> {
    const spinner = ora('Applying fix...').start();
    await new Promise(r => setTimeout(r, 2000));

    if (sol.id === 'fix_chmod') {
        spinner.fail('Command failed: Operation not permitted');
        return false;
    }

    spinner.succeed('Fix applied successfully.');
    return true;
}

main().catch(err => console.error(err));
