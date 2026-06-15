/**
 * Tests for model-access — the AI model catalog and plan-tier access gates.
 * Pure config logic: normalizePlan, getModelsForTier, canUseModel, stage maps.
 */

import {
    normalizePlan,
    getModelsForTier,
    canUseModel,
    canUseCustomEndpoint,
    getDefaultModel,
    getModelIdForStage,
    getStageModelMap,
    getPlatformCloudBaseUrl,
    buildPlatformCloudUrl,
    PLATFORM_MODELS,
    type PlanTier,
    type DetectionStage
} from '../../utils/model-access';

describe('model-access', () => {
    describe('normalizePlan', () => {
        it('accepts canonical plan tiers', () => {
            expect(normalizePlan('starter')).toBe('starter');
            expect(normalizePlan('pro')).toBe('pro');
            expect(normalizePlan('ultra')).toBe('ultra');
        });
        it('is case-insensitive', () => {
            expect(normalizePlan('STARTER')).toBe('starter');
            expect(normalizePlan('Pro')).toBe('pro');
        });
        it('defaults to starter for unknown/missing input', () => {
            expect(normalizePlan('unknown')).toBe('starter');
            expect(normalizePlan(undefined)).toBe('starter');
            expect(normalizePlan('')).toBe('starter');
        });
    });

    describe('getModelsForTier', () => {
        it('returns a non-empty array for each tier', () => {
            for (const tier of ['starter', 'pro', 'ultra'] as PlanTier[]) {
                const models = getModelsForTier(tier);
                expect(models.length).toBeGreaterThan(0);
            }
        });
        it('ultra has at least as many models as starter', () => {
            expect(getModelsForTier('ultra').length).toBeGreaterThanOrEqual(getModelsForTier('starter').length);
        });
    });

    describe('canUseModel', () => {
        it('returns true for a model in the tier catalog', () => {
            const starterModel = getModelsForTier('starter')[0];
            expect(canUseModel('starter', starterModel.id)).toBe(true);
        });
        it('returns false for a model not available in the tier', () => {
            // Use an ultra-only model and check starter can't use it.
            const ultraModels = getModelsForTier('ultra');
            const starterModels = getModelsForTier('starter');
            const ultraOnly = ultraModels.find((m) => !starterModels.some((s) => s.id === m.id));
            if (ultraOnly) {
                expect(canUseModel('starter', ultraOnly.id)).toBe(false);
                expect(canUseModel('ultra', ultraOnly.id)).toBe(true);
            }
        });
    });

    describe('canUseCustomEndpoint', () => {
        it('returns a boolean', () => {
            expect(typeof canUseCustomEndpoint('starter')).toBe('boolean');
        });
    });

    describe('getDefaultModel', () => {
        it('returns a valid PlatformModel for each tier', () => {
            for (const tier of ['starter', 'pro', 'ultra'] as PlanTier[]) {
                const model = getDefaultModel(tier);
                expect(model).toBeDefined();
                expect(model.id).toBeTruthy();
            }
        });
    });

    describe('stage model map', () => {
        it('getModelIdForStage returns a string for each stage', () => {
            for (const stage of ['primary', 'deep_analysis', 'learning_verification', 'blocking_review'] as DetectionStage[]) {
                const id = getModelIdForStage(stage);
                expect(typeof id).toBe('string');
                expect(id.length).toBeGreaterThan(0);
            }
        });
        it('getStageModelMap returns a record with all 4 stages', () => {
            const map = getStageModelMap();
            expect(Object.keys(map)).toHaveLength(4);
            expect(map.primary).toBeDefined();
            expect(map.blocking_review).toBeDefined();
        });
    });

    describe('URL builders', () => {
        it('getPlatformCloudBaseUrl returns a non-empty URL', () => {
            const url = getPlatformCloudBaseUrl();
            expect(url).toBeTruthy();
            expect(url.length).toBeGreaterThan(0);
        });
        it('buildPlatformCloudUrl appends a path', () => {
            const url = buildPlatformCloudUrl('/v1/chat');
            expect(url).toContain('/v1/chat');
        });
        it('buildPlatformCloudUrl with no path returns the base URL', () => {
            const url = buildPlatformCloudUrl();
            expect(url).toBeTruthy();
        });
    });

    describe('PLATFORM_MODELS catalog', () => {
        it('contains at least one model', () => {
            expect(PLATFORM_MODELS.length).toBeGreaterThan(0);
        });
        it('every model has an id and a minTier', () => {
            for (const model of PLATFORM_MODELS) {
                expect(model.id).toBeTruthy();
                expect(model.minTier).toBeTruthy();
            }
        });
    });
});
