/**
 * Attack Simulator - Automated security testing for FluxGuard
 * Simulates various attack patterns to test defense capabilities
 */

const axios = require('axios');
const chalk = require('chalk');

const TARGET_BASE = process.env.TARGET_URL || 'http://vulnerable-app:8080';
const DEFENSE_BASE = process.env.DEFENSE_URL || 'http://backend:3005';

const ATTACKS = {
    sql_injection: [
        {
            name: "Basic OR Bypass",
            endpoint: "/login",
            method: "POST",
            data: { username: "' OR '1'='1' --", password: "anything" },
            severity: "critical"
        },
        {
            name: "UNION SELECT",
            endpoint: "/search",
            method: "GET",
            params: { q: "' UNION SELECT id,username,password,email FROM users--" },
            severity: "critical"
        },
        {
            name: "Comment Injection",
            endpoint: "/login",
            method: "POST",
            data: { username: "admin'--", password: "x" },
            severity: "high"
        },
        {
            name: "Stacked Queries",
            endpoint: "/search",
            method: "GET",
            params: { q: "'; DROP TABLE users; --" },
            severity: "critical"
        }
    ],
    xss: [
        {
            name: "Script Tag",
            endpoint: "/comment",
            method: "POST",
            data: { comment: "<script>alert('XSS')</script>" },
            severity: "high"
        },
        {
            name: "Event Handler",
            endpoint: "/profile",
            method: "GET",
            params: { name: "<img src=x onerror=alert('XSS')>" },
            severity: "high"
        },
        {
            name: "SVG Onload",
            endpoint: "/comment",
            method: "POST",
            data: { comment: "<svg onload=alert('XSS')>" },
            severity: "high"
        },
        {
            name: "JavaScript Protocol",
            endpoint: "/profile",
            method: "GET",
            params: { name: "<a href=\"javascript:alert('XSS')\">click</a>" },
            severity: "medium"
        }
    ],
    path_traversal: [
        {
            name: "Basic Traversal",
            endpoint: "/file",
            method: "GET",
            params: { name: "../../../etc/passwd" },
            severity: "critical"
        },
        {
            name: "URL Encoded",
            endpoint: "/file",
            method: "GET",
            params: { name: "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd" },
            severity: "critical"
        },
        {
            name: "Double Encoded",
            endpoint: "/file",
            method: "GET",
            params: { name: "..%252f..%252f..%252fetc/passwd" },
            severity: "critical"
        },
        {
            name: "Windows Path",
            endpoint: "/file",
            method: "GET",
            params: { name: "..\\..\\..\\windows\\system32\\config\\sam" },
            severity: "critical"
        }
    ],
    command_injection: [
        {
            name: "Semicolon Injection",
            endpoint: "/ping",
            method: "GET",
            params: { host: "127.0.0.1; cat /etc/passwd" },
            severity: "critical"
        },
        {
            name: "Pipe Injection",
            endpoint: "/ping",
            method: "GET",
            params: { host: "127.0.0.1 | ls -la" },
            severity: "critical"
        },
        {
            name: "AND Injection",
            endpoint: "/ping",
            method: "GET",
            params: { host: "127.0.0.1 && whoami" },
            severity: "critical"
        },
        {
            name: "Backtick Injection",
            endpoint: "/ping",
            method: "GET",
            params: { host: "`id`" },
            severity: "critical"
        }
    ],
    rate_abuse: [
        {
            name: "Rapid Requests",
            endpoint: "/login",
            method: "POST",
            data: { username: "admin", password: "wrong" },
            repeat: 100,
            severity: "medium"
        }
    ]
};

class AttackSimulator {
    constructor() {
        this.results = {
            total: 0,
            blocked: 0,
            allowed: 0,
            errors: 0,
            attacks: []
        };
    }

    async run() {
        console.log(chalk.red.bold('\n🔥 FluxGuard Attack Simulator 🔥\n'));
        console.log(chalk.gray(`Target: ${TARGET_BASE}`));
        console.log(chalk.gray(`Defense: ${DEFENSE_BASE}\n`));

        await this.checkConnectivity();

        for (const [category, attacks] of Object.entries(ATTACKS)) {
            console.log(chalk.yellow.bold(`\n━━━ ${category.toUpperCase().replace('_', ' ')} ━━━\n`));
            
            for (const attack of attacks) {
                await this.executeAttack(category, attack);
                await this.delay(500);
            }
        }

        this.printSummary();
    }

    async checkConnectivity() {
        console.log(chalk.blue('Checking connectivity...'));
        
        try {
            await axios.get(`${TARGET_BASE}/`, { timeout: 5000 });
            console.log(chalk.green('✓ Target application is reachable'));
        } catch (error) {
            console.log(chalk.red('✗ Target application is not reachable'));
            console.log(chalk.gray('  Make sure the demo environment is running'));
        }

        try {
            await axios.get(`${DEFENSE_BASE}/api/health`, { timeout: 5000 });
            console.log(chalk.green('✓ Defense system is reachable'));
        } catch (error) {
            console.log(chalk.yellow('⚠ Defense system health check failed (may be normal)'));
        }
        
        console.log('');
    }

    async executeAttack(category, attack) {
        const startTime = Date.now();
        this.results.total++;

        console.log(chalk.white(`  → ${attack.name}`));
        console.log(chalk.gray(`    Severity: ${attack.severity}`));

        try {
            let response;
            const url = `${TARGET_BASE}${attack.endpoint}`;
            const config = {
                timeout: 10000,
                validateStatus: () => true
            };

            if (attack.repeat) {
                let blocked = 0;
                for (let i = 0; i < attack.repeat; i++) {
                    try {
                        await axios({
                            method: attack.method,
                            url,
                            data: attack.data,
                            ...config
                        });
                    } catch (e) {
                        if (e.response?.status === 429) {
                            blocked++;
                        }
                    }
                }
                
                const result = {
                    category,
                    attack: attack.name,
                    severity: attack.severity,
                    blocked: blocked > attack.repeat * 0.5,
                    responseTime: Date.now() - startTime
                };
                
                this.results.attacks.push(result);
                
                if (result.blocked) {
                    this.results.blocked++;
                    console.log(chalk.green(`    ✓ BLOCKED (Rate limit triggered)`));
                } else {
                    this.results.allowed++;
                    console.log(chalk.red(`    ✗ ALLOWED (${blocked}/${attack.repeat} blocked)`));
                }
                
                return;
            }

            if (attack.method === 'GET') {
                response = await axios.get(url, { params: attack.params, ...config });
            } else {
                response = await axios({
                    method: attack.method,
                    url,
                    data: attack.data,
                    ...config
                });
            }

            const responseTime = Date.now() - startTime;
            const wasBlocked = this.detectBlock(response);

            const result = {
                category,
                attack: attack.name,
                severity: attack.severity,
                blocked: wasBlocked,
                statusCode: response.status,
                responseTime
            };

            this.results.attacks.push(result);

            if (wasBlocked) {
                this.results.blocked++;
                console.log(chalk.green(`    ✓ BLOCKED (${response.status}) - ${responseTime}ms`));
            } else {
                this.results.allowed++;
                console.log(chalk.red(`    ✗ ALLOWED (${response.status}) - ${responseTime}ms`));
                
                if (attack.severity === 'critical') {
                    console.log(chalk.red.bold(`    ⚠ CRITICAL VULNERABILITY EXPOSED!`));
                }
            }

        } catch (error) {
            this.results.errors++;
            const result = {
                category,
                attack: attack.name,
                severity: attack.severity,
                blocked: false,
                error: error.message
            };
            this.results.attacks.push(result);
            
            if (error.code === 'ECONNABORTED' || error.code === 'ECONNREFUSED') {
                console.log(chalk.yellow(`    ⚠ CONNECTION BLOCKED - ${error.message}`));
                this.results.blocked++;
                this.results.errors--;
            } else {
                console.log(chalk.gray(`    ? ERROR: ${error.message}`));
            }
        }
    }

    detectBlock(response) {
        if (response.status === 403) return true;
        if (response.status === 429) return true;
        
        const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        
        const blockIndicators = [
            'blocked',
            'forbidden',
            'denied',
            'security',
            'waf',
            'firewall',
            'malicious',
            'attack detected'
        ];
        
        const lowerBody = body.toLowerCase();
        return blockIndicators.some(indicator => lowerBody.includes(indicator));
    }

    printSummary() {
        console.log('\n');
        console.log(chalk.bold('╔════════════════════════════════════════════════════════════╗'));
        console.log(chalk.bold('║                    ATTACK SIMULATION SUMMARY               ║'));
        console.log(chalk.bold('╚════════════════════════════════════════════════════════════╝'));
        console.log('');
        
        const blockRate = this.results.total > 0 
            ? ((this.results.blocked / this.results.total) * 100).toFixed(1)
            : 0;
        
        console.log(`  Total Attacks:     ${this.results.total}`);
        console.log(chalk.green(`  Blocked:           ${this.results.blocked} (${blockRate}%)`));
        console.log(chalk.red(`  Allowed:           ${this.results.allowed}`));
        console.log(chalk.gray(`  Errors:            ${this.results.errors}`));
        console.log('');

        const byCategory = {};
        for (const attack of this.results.attacks) {
            if (!byCategory[attack.category]) {
                byCategory[attack.category] = { total: 0, blocked: 0 };
            }
            byCategory[attack.category].total++;
            if (attack.blocked) byCategory[attack.category].blocked++;
        }

        console.log(chalk.bold('  By Category:'));
        for (const [category, stats] of Object.entries(byCategory)) {
            const rate = ((stats.blocked / stats.total) * 100).toFixed(0);
            const icon = stats.blocked === stats.total ? '✓' : '✗';
            const color = stats.blocked === stats.total ? chalk.green : chalk.yellow;
            console.log(color(`    ${icon} ${category.padEnd(20)} ${stats.blocked}/${stats.total} (${rate}%)`));
        }

        console.log('');
        
        const criticalAllowed = this.results.attacks.filter(
            a => a.severity === 'critical' && !a.blocked
        ).length;
        
        if (criticalAllowed > 0) {
            console.log(chalk.red.bold(`  ⚠ ${criticalAllowed} CRITICAL attacks were not blocked!`));
        } else {
            console.log(chalk.green.bold('  ✓ All critical attacks were blocked!'));
        }
        
        console.log('');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

async function main() {
    const simulator = new AttackSimulator();
    await simulator.run();
}

main().catch(console.error);
