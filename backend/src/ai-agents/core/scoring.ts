import {
    AnalysisResult,
    DebateTriggerMetrics,
    SecurityVerdict,
    VerdictDistribution
} from './types';

const EPSILON = 0.000001;

function clamp(value: number, min = 0, max = 1): number {
    return Math.min(max, Math.max(min, value));
}

export function normalizeDistribution(
    distribution?: Partial<VerdictDistribution> | null
): VerdictDistribution {
    const safe = clamp(distribution?.safe ?? 0);
    const suspicious = clamp(distribution?.suspicious ?? 0);
    const malicious = clamp(distribution?.malicious ?? 0);
    const total = safe + suspicious + malicious;

    if (total <= EPSILON) {
        return {
            safe: 1 / 3,
            suspicious: 1 / 3,
            malicious: 1 / 3
        };
    }

    return {
        safe: Number((safe / total).toFixed(6)),
        suspicious: Number((suspicious / total).toFixed(6)),
        malicious: Number((malicious / total).toFixed(6))
    };
}

export function distributionFromVerdict(
    verdict: SecurityVerdict,
    confidence: number
): VerdictDistribution {
    const normalizedConfidence = clamp(confidence, 0.34, 0.98);
    const remainder = 1 - normalizedConfidence;

    switch (verdict) {
        case 'safe':
            return normalizeDistribution({
                safe: normalizedConfidence,
                suspicious: remainder * 0.7,
                malicious: remainder * 0.3
            });
        case 'malicious':
            return normalizeDistribution({
                safe: remainder * 0.2,
                suspicious: remainder * 0.3,
                malicious: normalizedConfidence
            });
        case 'unknown':
            return normalizeDistribution({
                safe: remainder * 0.35,
                suspicious: normalizedConfidence,
                malicious: remainder * 0.65
            });
        case 'suspicious':
        default:
            return normalizeDistribution({
                safe: remainder * 0.45,
                suspicious: normalizedConfidence,
                malicious: remainder * 0.55
            });
    }
}

export function dominantVerdict(distribution: VerdictDistribution): SecurityVerdict {
    const normalized = normalizeDistribution(distribution);

    if (normalized.safe >= normalized.suspicious && normalized.safe >= normalized.malicious) {
        return 'safe';
    }
    if (normalized.malicious >= normalized.safe && normalized.malicious >= normalized.suspicious) {
        return 'malicious';
    }
    return 'suspicious';
}

export function confidenceFromDistribution(distribution: VerdictDistribution): number {
    const normalized = normalizeDistribution(distribution);
    return Math.max(normalized.safe, normalized.suspicious, normalized.malicious);
}

export function blendDistributions(
    results: Array<Pick<AnalysisResult, 'classScores' | 'confidence'>>,
    weights?: number[]
): VerdictDistribution {
    if (results.length === 0) {
        return distributionFromVerdict('unknown', 0.5);
    }

    const totalWeight = results.reduce((sum, _, index) => sum + (weights?.[index] ?? 1), 0);
    const aggregate = results.reduce(
        (acc, result, index) => {
            const weight = (weights?.[index] ?? 1) / Math.max(totalWeight, EPSILON);
            const distribution = normalizeDistribution(result.classScores);
            acc.safe += distribution.safe * weight;
            acc.suspicious += distribution.suspicious * weight;
            acc.malicious += distribution.malicious * weight;
            return acc;
        },
        { safe: 0, suspicious: 0, malicious: 0 }
    );

    return normalizeDistribution(aggregate);
}

function klDivergence(left: VerdictDistribution, right: VerdictDistribution): number {
    const p = normalizeDistribution(left);
    const q = normalizeDistribution(right);
    const entries: Array<keyof VerdictDistribution> = ['safe', 'suspicious', 'malicious'];

    return entries.reduce((sum, key) => {
        const pValue = Math.max(p[key], EPSILON);
        const qValue = Math.max(q[key], EPSILON);
        return sum + pValue * Math.log2(pValue / qValue);
    }, 0);
}

export function jensenShannonDivergence(
    left: VerdictDistribution,
    right: VerdictDistribution
): number {
    const p = normalizeDistribution(left);
    const q = normalizeDistribution(right);
    const midpoint = normalizeDistribution({
        safe: (p.safe + q.safe) / 2,
        suspicious: (p.suspicious + q.suspicious) / 2,
        malicious: (p.malicious + q.malicious) / 2
    });

    return Number((((klDivergence(p, midpoint) + klDivergence(q, midpoint)) / 2)).toFixed(6));
}

export function averagePairwiseDivergence(results: AnalysisResult[]): number {
    if (results.length < 2) {
        return 0;
    }

    let total = 0;
    let pairs = 0;

    for (let index = 0; index < results.length; index += 1) {
        for (let inner = index + 1; inner < results.length; inner += 1) {
            total += jensenShannonDivergence(results[index].classScores, results[inner].classScores);
            pairs += 1;
        }
    }

    return Number((total / Math.max(pairs, 1)).toFixed(6));
}

export function confidenceRange(results: AnalysisResult[]): number {
    if (results.length === 0) {
        return 0;
    }

    const confidences = results.map((result) => clamp(result.confidence));
    return Number((Math.max(...confidences) - Math.min(...confidences)).toFixed(6));
}

export function buildDebateTriggerMetrics(
    results: AnalysisResult[],
    divergenceThreshold: number,
    confidenceThreshold: number
): DebateTriggerMetrics {
    const verdicts = new Set(results.map((result) => dominantVerdict(result.classScores)));
    const labelConflict = verdicts.size > 1;
    const divergence = averagePairwiseDivergence(results);
    const range = confidenceRange(results);
    const reasons: string[] = [];

    if (labelConflict) {
        reasons.push('label_conflict');
    }
    if (divergence > divergenceThreshold) {
        reasons.push('divergence_threshold');
    }
    if (range > confidenceThreshold) {
        reasons.push('confidence_range');
    }

    return {
        triggered: reasons.length > 0,
        labelConflict,
        confidenceRange: range,
        divergence,
        reasons
    };
}

export function verdictToDecision(
    verdict: SecurityVerdict
): 'allow' | 'block' | 'challenge' | 'monitor' {
    switch (verdict) {
        case 'safe':
            return 'allow';
        case 'malicious':
            return 'block';
        case 'unknown':
            return 'challenge';
        case 'suspicious':
        default:
            return 'monitor';
    }
}
