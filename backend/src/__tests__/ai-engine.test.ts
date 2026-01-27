
import { AIEngine, AIAnalysisRequest } from '../scanner/ai-engine';

// Mock AIEngine to avoid real API calls
// We can partial mock the class or just mock the private callLLM method if we could access it,
// but usually we extend or use prototype mocking for private methods in tests
// OR we mock the axios library used inside.

jest.mock('axios');
const axios = require('axios');

describe('AIEngine', () => {
    let aiEngine: AIEngine;
    const mockProvider = {
        name: 'openai' as const,
        apiKey: 'test-key',
        model: 'gpt-4'
    };

    beforeEach(() => {
        aiEngine = new AIEngine(mockProvider);
        jest.clearAllMocks();
    });

    const mockRequest: AIAnalysisRequest = {
        problem: {
            title: 'Test Problem',
            description: 'Something broke',
            category: 'security',
            priority: 'high'
        },
        context: {
            systemInfo: {},
            logs: [],
            configFiles: {}
        }
    };

    it('should successfully analyze a problem with mocked response', async () => {
        const mockResponse = {
            diagnosis: {
                rootCause: 'Configuration error',
                severity: 'medium',
                confidence: 0.9
            },
            solutions: [],
            alternativeApproaches: []
        };

        (axios.post as jest.Mock).mockResolvedValue({
            data: {
                choices: [{
                    message: {
                        content: JSON.stringify(mockResponse)
                    }
                }]
            }
        });

        const result = await aiEngine.analyzeProblem(mockRequest);

        expect(result.diagnosis.rootCause).toBe('Configuration error');
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should handle markdown code blocks in response', async () => {
        const mockResponse = {
            diagnosis: { rootCause: 'Test', severity: 'low', confidence: 1 },
            solutions: []
        };
        const content = "```json\n" + JSON.stringify(mockResponse) + "\n```";

        (axios.post as jest.Mock).mockResolvedValue({
            data: {
                choices: [{
                    message: {
                        content: content
                    }
                }]
            }
        });

        const result = await aiEngine.analyzeProblem(mockRequest);
        expect(result.diagnosis.rootCause).toBe('Test');
    });

    it('should fallback to rule-based analysis on API failure', async () => {
        (axios.post as jest.Mock).mockRejectedValue(new Error('API Error'));

        // Silence console.error for this test
        const originalError = console.error;
        console.error = jest.fn();

        const result = await aiEngine.analyzeProblem(mockRequest);

        expect(result.diagnosis.rootCause).toContain('Unable to determine without AI');
        expect(result.warnings).toContain('AI analysis unavailable, using rule-based fallback');

        console.error = originalError;
    });
});
