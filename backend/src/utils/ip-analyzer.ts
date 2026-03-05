/**
 * IP Analyzer Utility
 * Tracks attack origins and geographic distribution
 */
import { isDemoMode } from '../config/app-mode';

interface AttackRecord {
    ip: string;
    timestamp: number;
    country?: string;
}

interface CountryStats {
    [countryCode: string]: {
        count: number;
        countryName: string;
        percentage: number;
    };
}

interface AttackOrigins {
    byCountry: Array<{
        country: string;
        countryCode: string;
        count: number;
        percentage: number;
    }>;
}

export class IPAnalyzer {
    private attacks: Map<string, AttackRecord[]> = new Map();
    private countryStats: CountryStats = {};
    private totalAttacks: number = 0;

    // Country name mapping
    private readonly COUNTRY_NAMES: Record<string, string> = {
        'CN': 'China',
        'US': 'United States',
        'RU': 'Russia',
        'JP': 'Japan',
        'DE': 'Germany',
        'GB': 'United Kingdom',
        'FR': 'France',
        'BR': 'Brazil',
        'IN': 'India',
        'KR': 'South Korea',
        'CA': 'Canada',
        'AU': 'Australia',
        'Unknown': 'Unknown'
    };

    constructor() {
        // 不再初始化默认统计数据，确保数据真实
    }

    /**
     * Record an attack from an IP address
     */
    public recordAttack(ip: string): void {
        const timestamp = Date.now();
        const countryCode = this.detectCountry(ip);

        // Store attack record
        if (!this.attacks.has(ip)) {
            this.attacks.set(ip, []);
        }
        this.attacks.get(ip)!.push({ ip, timestamp, country: countryCode });

        // Update country statistics
        if (!this.countryStats[countryCode]) {
            this.countryStats[countryCode] = {
                count: 0,
                countryName: this.COUNTRY_NAMES[countryCode] || 'Unknown',
                percentage: 0
            };
        }
        this.countryStats[countryCode].count++;
        this.totalAttacks++;

        // Recalculate percentages
        this.recalculatePercentages();
    }

    /**
     * Get attack origins grouped by country
     */
    public getAttackOrigins(): AttackOrigins {
        const byCountry = Object.entries(this.countryStats)
            .map(([countryCode, stats]) => ({
                country: stats.countryName,
                countryCode,
                count: stats.count,
                percentage: stats.percentage
            }))
            .sort((a, b) => b.count - a.count); // Sort by count descending

        return { byCountry };
    }

    /**
     * Get statistics for a specific country
     */
    public getCountryStats(countryCode: string): number | undefined {
        return this.countryStats[countryCode]?.count;
    }

    /**
     * Get total attack count
     */
    public getTotalAttacks(): number {
        return this.totalAttacks;
    }

    /**
     * Clear all attack records
     */
    public clearRecords(): void {
        this.attacks.clear();
        this.countryStats = {};
        this.totalAttacks = 0;
        // 不再初始化默认统计数据，确保数据真实
    }

    /**
     * Detect country from IP address (simplified implementation)
     * In production, this would use a GeoIP database or API
     */
    private detectCountry(ip: string): string {
        // Simplified geo-detection based on IP ranges
        // This is a basic implementation for demonstration
        // In production, use libraries like maxmind or geoip-lite

        const firstOctet = parseInt(ip.split('.')[0]);

        // Simplified geographic distribution based on first octet
        if (firstOctet >= 1 && firstOctet <= 25) return 'US';
        if (firstOctet >= 27 && firstOctet <= 47) return 'CN';
        if (firstOctet >= 46 && firstOctet <= 62) return 'RU';
        if (firstOctet >= 58 && firstOctet <= 60) return 'JP';
        if (firstOctet >= 77 && firstOctet <= 95) return 'DE';
        if (firstOctet >= 80 && firstOctet <= 95) return 'GB';

        return 'Unknown';
    }

    /**
     * Recalculate percentages for all countries
     */
    private recalculatePercentages(): void {
        if (this.totalAttacks === 0) return;

        for (const countryCode in this.countryStats) {
            this.countryStats[countryCode].percentage =
                (this.countryStats[countryCode].count / this.totalAttacks) * 100;
        }
    }

    /**
     * Initialize with some default statistics for dashboard visualization
     */
    private initializeDefaultStats(): void {
        // Add some sample data for demonstration
        const sampleAttacks = [
            { ip: '192.168.1.100', country: 'CN' },
            { ip: '10.0.0.50', country: 'US' },
            { ip: '172.16.0.25', country: 'RU' },
            { ip: '203.0.113.10', country: 'CN' },
            { ip: '198.51.100.5', country: 'JP' }
        ];

        sampleAttacks.forEach(attack => {
            const countryCode = attack.country;

            if (!this.countryStats[countryCode]) {
                this.countryStats[countryCode] = {
                    count: 0,
                    countryName: this.COUNTRY_NAMES[countryCode] || 'Unknown',
                    percentage: 0
                };
            }
            this.countryStats[countryCode].count++;
            this.totalAttacks++;
        });

        this.recalculatePercentages();
    }
}

export default IPAnalyzer;
