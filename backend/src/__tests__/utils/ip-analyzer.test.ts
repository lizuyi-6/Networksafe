import { IPAnalyzer } from '../../utils/ip-analyzer';

// ip-analyzer imports isDemoMode but never uses it in current code.
// Mock it to avoid side effects.
jest.mock('../../config/app-mode', () => ({
    isDemoMode: jest.fn(() => false),
}));

describe('IPAnalyzer', () => {
    let analyzer: IPAnalyzer;

    beforeEach(() => {
        analyzer = new IPAnalyzer();
    });

    // ── recordAttack ──────────────────────────────────────────────

    describe('recordAttack', () => {
        it('should increment total attack count by 1 for each call', () => {
            expect(analyzer.getTotalAttacks()).toBe(0);
            analyzer.recordAttack('1.2.3.4');
            expect(analyzer.getTotalAttacks()).toBe(1);
            analyzer.recordAttack('5.6.7.8');
            expect(analyzer.getTotalAttacks()).toBe(2);
        });

        it('should store attack records keyed by IP', () => {
            analyzer.recordAttack('10.0.0.1');
            analyzer.recordAttack('10.0.0.1');
            // Two attacks from the same IP should still be counted as 2
            expect(analyzer.getTotalAttacks()).toBe(2);
        });
    });

    // ── detectCountry (tested indirectly via getAttackOrigins) ───

    describe('detectCountry (via recordAttack + getAttackOrigins)', () => {
        const testCases: Array<{
            ip: string;
            expectedCountry: string;
        }> = [
            // US range: first octet 1-25
            { ip: '1.0.0.1', expectedCountry: 'United States' },
            { ip: '25.255.255.255', expectedCountry: 'United States' },
            // CN range: first octet 27-47
            { ip: '27.0.0.1', expectedCountry: 'China' },
            { ip: '47.255.255.255', expectedCountry: 'China' },
            // RU range: first octet 46-62 (but 46-47 overlaps with CN which checks first)
            { ip: '48.0.0.1', expectedCountry: 'Russia' },
            { ip: '62.255.255.255', expectedCountry: 'Russia' },
            // JP range: first octet 58-60 (unreachable - RU catches 46-62 first)
            // DE range: first octet 77-95
            { ip: '77.0.0.1', expectedCountry: 'Germany' },
            { ip: '95.255.255.255', expectedCountry: 'Germany' },
            // GB range: first octet 80-95 (unreachable - DE catches 77-95 first)
            // Outside known ranges
            { ip: '100.0.0.1', expectedCountry: 'Unknown' },
            { ip: '200.200.200.200', expectedCountry: 'Unknown' },
            { ip: '0.0.0.0', expectedCountry: 'Unknown' },
        ];

        it.each(testCases)('should detect IP $ip as $expectedCountry', ({ ip, expectedCountry }) => {
            analyzer.recordAttack(ip);
            const origins = analyzer.getAttackOrigins();
            expect(origins.byCountry).toHaveLength(1);
            expect(origins.byCountry[0].country).toBe(expectedCountry);
        });
    });

    // ── getAttackOrigins ──────────────────────────────────────────

    describe('getAttackOrigins', () => {
        it('should return empty byCountry array when no attacks recorded', () => {
            const origins = analyzer.getAttackOrigins();
            expect(origins).toEqual({ byCountry: [] });
        });

        it('should group attacks by country and sort by count descending', () => {
            // 2 attacks from CN, 1 from US, 3 from RU
            analyzer.recordAttack('30.0.0.1'); // CN
            analyzer.recordAttack('31.0.0.1'); // CN
            analyzer.recordAttack('1.0.0.1');   // US
            analyzer.recordAttack('50.0.0.1');  // RU
            analyzer.recordAttack('51.0.0.1');  // RU
            analyzer.recordAttack('52.0.0.1');  // RU

            const origins = analyzer.getAttackOrigins();

            expect(origins.byCountry).toHaveLength(3);
            expect(origins.byCountry[0].country).toBe('Russia');
            expect(origins.byCountry[0].count).toBe(3);
            expect(origins.byCountry[1].country).toBe('China');
            expect(origins.byCountry[1].count).toBe(2);
            expect(origins.byCountry[2].country).toBe('United States');
            expect(origins.byCountry[2].count).toBe(1);
        });

        it('should calculate correct percentages', () => {
            analyzer.recordAttack('30.0.0.1'); // CN
            analyzer.recordAttack('31.0.0.1'); // CN
            analyzer.recordAttack('1.0.0.1');   // US

            const origins = analyzer.getAttackOrigins();
            const cnEntry = origins.byCountry.find(e => e.countryCode === 'CN');
            const usEntry = origins.byCountry.find(e => e.countryCode === 'US');

            expect(cnEntry!.percentage).toBeCloseTo(66.67, 1);
            expect(usEntry!.percentage).toBeCloseTo(33.33, 1);
        });

        it('should have percentages summing to 100 for single country', () => {
            analyzer.recordAttack('30.0.0.1');
            const origins = analyzer.getAttackOrigins();
            expect(origins.byCountry[0].percentage).toBe(100);
        });

        it('each entry should have country, countryCode, count, and percentage fields', () => {
            analyzer.recordAttack('30.0.0.1');
            const origins = analyzer.getAttackOrigins();
            const entry = origins.byCountry[0];

            expect(entry).toHaveProperty('country');
            expect(entry).toHaveProperty('countryCode');
            expect(entry).toHaveProperty('count');
            expect(entry).toHaveProperty('percentage');
            expect(typeof entry.country).toBe('string');
            expect(typeof entry.countryCode).toBe('string');
            expect(typeof entry.count).toBe('number');
            expect(typeof entry.percentage).toBe('number');
        });
    });

    // ── getCountryStats ───────────────────────────────────────────

    describe('getCountryStats', () => {
        it('should return undefined for a country with no recorded attacks', () => {
            expect(analyzer.getCountryStats('CN')).toBeUndefined();
            expect(analyzer.getCountryStats('US')).toBeUndefined();
        });

        it('should return the attack count for a country that has attacks', () => {
            analyzer.recordAttack('30.0.0.1'); // CN
            analyzer.recordAttack('31.0.0.1'); // CN

            expect(analyzer.getCountryStats('CN')).toBe(2);
        });

        const statsCases: Array<{
            ip: string;
            countryCode: string;
            expectedCount: number;
        }> = [
            { ip: '1.0.0.1', countryCode: 'US', expectedCount: 1 },
            { ip: '48.0.0.1', countryCode: 'RU', expectedCount: 1 },
            { ip: '80.0.0.1', countryCode: 'DE', expectedCount: 1 },
            { ip: '100.0.0.1', countryCode: 'Unknown', expectedCount: 1 },
        ];

        it.each(statsCases)('should map IP $ip to country code $countryCode with count $expectedCount', ({ ip, countryCode, expectedCount }) => {
            analyzer.recordAttack(ip);
            expect(analyzer.getCountryStats(countryCode)).toBe(expectedCount);
        });
    });

    // ── getTotalAttacks ───────────────────────────────────────────

    describe('getTotalAttacks', () => {
        it('should return 0 for a fresh analyzer', () => {
            expect(analyzer.getTotalAttacks()).toBe(0);
        });

        it('should return the cumulative count after multiple recordAttack calls', () => {
            const counts = [1, 5, 10, 50, 100];
            let cumulative = 0;
            for (const n of counts) {
                for (let i = 0; i < n; i++) {
                    analyzer.recordAttack(`${i}.0.0.1`);
                }
                cumulative += n;
                expect(analyzer.getTotalAttacks()).toBe(cumulative);
            }
        });
    });

    // ── clearRecords ──────────────────────────────────────────────

    describe('clearRecords', () => {
        it('should reset total attacks to 0', () => {
            analyzer.recordAttack('1.0.0.1');
            analyzer.recordAttack('30.0.0.1');
            expect(analyzer.getTotalAttacks()).toBe(2);

            analyzer.clearRecords();
            expect(analyzer.getTotalAttacks()).toBe(0);
        });

        it('should clear country statistics', () => {
            analyzer.recordAttack('30.0.0.1');
            analyzer.recordAttack('1.0.0.1');

            analyzer.clearRecords();
            expect(analyzer.getCountryStats('CN')).toBeUndefined();
            expect(analyzer.getCountryStats('US')).toBeUndefined();
        });

        it('should return empty attack origins after clear', () => {
            analyzer.recordAttack('30.0.0.1');
            analyzer.recordAttack('1.0.0.1');

            analyzer.clearRecords();
            const origins = analyzer.getAttackOrigins();
            expect(origins.byCountry).toHaveLength(0);
        });

        it('should allow recording attacks again after clear', () => {
            analyzer.recordAttack('30.0.0.1');
            analyzer.clearRecords();

            analyzer.recordAttack('1.0.0.1');
            expect(analyzer.getTotalAttacks()).toBe(1);
            const origins = analyzer.getAttackOrigins();
            expect(origins.byCountry).toHaveLength(1);
            expect(origins.byCountry[0].countryCode).toBe('US');
        });
    });

    // ── default export ────────────────────────────────────────────

    describe('default export', () => {
        it('should be the same as the named export', () => {
            // Default export should reference the same class
            const IPAnalyzerDefault = require('../../utils/ip-analyzer').default;
            const instance = new IPAnalyzerDefault();
            expect(instance).toBeInstanceOf(IPAnalyzer);
        });
    });
});
