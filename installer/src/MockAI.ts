
export interface AISolution {
    id: string;
    description: string;
    command: string;
    consequence: string;
    risk: 'Low' | 'Medium' | 'High';
}

export class MockAIService {
    /**
     * Simulates sending an error log to an LLM and receiving multiple potential fixes.
     */
    async analyzeError(errorLog: string): Promise<AISolution[]> {
        console.log(`\n[AI] Analyzing error signature and generating solutions...`);

        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (errorLog.includes("EACCES") || errorLog.includes("permission denied")) {
            return [
                {
                    id: 'fix_chmod',
                    description: 'Adjust file permissions to allow write access.',
                    command: 'sudo chmod 666 /etc/security/config.json',
                    consequence: 'This will make the configuration file writable by all users.',
                    risk: 'Medium'
                },
                {
                    id: 'fix_owner',
                    description: 'Change file ownership to current user.',
                    command: 'sudo chown $USER /etc/security/config.json',
                    consequence: 'Ownership of the file will be transferred to you.',
                    risk: 'Low'
                }
            ];
        }

        if (errorLog.includes("PORT_IN_USE")) {
            return [
                {
                    id: 'fix_kill',
                    description: 'Kill the process occupying port 3000.',
                    command: 'fuser -k 3000/tcp',
                    consequence: 'The existing service on port 3000 will be forcefully terminated.',
                    risk: 'High'
                },
                {
                    id: 'fix_config',
                    description: 'Configure middleware to use a different port.',
                    command: 'sed -i "s/3000/3001/g" config.json',
                    consequence: 'Service will start on port 3001 instead of default.',
                    risk: 'Low'
                }
            ];
        }

        return [{
            id: 'fix_generic',
            description: 'Attempt generic retry with elevated privileges.',
            command: 'sudo !!',
            consequence: 'Command will run as root.',
            risk: 'Medium'
        }];
    }
}
