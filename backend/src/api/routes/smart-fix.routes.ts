import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { SmartFixer } from '../../scanner/smart-fixer';
import { OptimizationEngine } from '../../scanner/optimization-engine';
import { InputValidator } from '../../security/input-validator';
import logger from '../../utils/logger';

const router = Router();
const optimizationEngine = new OptimizationEngine();
const inputValidator = new InputValidator();

// SECURITY FIX CVE-2026-004/018: Apply authentication to all routes
router.use(authenticate);
router.use(requireRole('admin'));

/**
 * AI Prompt Injection Protection
 * SECURITY FIX: Validate and sanitize AI prompts to prevent prompt injection attacks
 */
class AIPromptValidator {
  /**
   * Dangerous patterns that could indicate prompt injection attempts
   */
  private static readonly DANGEROUS_PATTERNS = [
    // Ignore previous instructions
    /ignore\s+(all\s+)?previous\s+instructions?/i,
    /disregard\s+(all\s+)?previous\s+instructions?/i,
    /forget\s+(all\s+)?previous\s+instructions?/i,

    // Override attempts
    /override\s+(your\s+)?(programming|instructions|system|rules)/i,
    /bypass\s+(your\s+)?(security|rules|restrictions)/i,
    /break\s+(your\s+)?(programming|rules|guidelines)/i,

    // System prompt extraction
    /(show|print|output|display|reveal|tell\s+me)\s+(your\s+)?(system\s+)?(prompt|instructions|programming|rules)/i,
    /what\s+(are\s+)?(your\s+)?(instructions|rules|constraints|guidelines)/i,

    // SQL/Code injection
    /execute\s+(the\s+)?following\s*(sql|code|command|script)/i,
    /run\s*(this|the)\s*(sql|code|command)/i,
    /drop\s+table/i,
    /exec\s*(\(|\s)/i,

    // Data exfiltration
    /(print|output|display|show)\s+(all\s+)?(users?|passwords?|credentials?|keys?|tokens?|secrets?)/i,
    /(send|transmit|exfiltrate)\s+(all\s+)?(data|logs|credentials)/i,

    // Configuration/Environment access
    /(access|read|show)\s+(your\s+)?(environment|env|config|settings|\.env)/i,
    /get\s+(the\s+)?(jwt_secret|api_key|secret_key|password)/i,
  ];

  /**
   * Validate an AI prompt for injection attempts
   * @param prompt The prompt to validate
   * @returns Object with valid flag and error message if invalid
   */
  static validatePrompt(prompt: string): { valid: boolean; error?: string; sanitized?: string } {
    if (!prompt || typeof prompt !== 'string') {
      return { valid: false, error: 'backend.prompt_must_be_a_non_empty_string' };
    }

    // Check length limits
    if (prompt.length > 10000) {
      return { valid: false, error: 'backend.prompt_is_too_long_maximum_10000_characters_allowed' };
    }

    // Check for dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(prompt)) {
        logger.warn('Blocked AI prompt with dangerous pattern', {
          pattern: pattern.source,
          promptLength: prompt.length
        });

        return {
          valid: false,
          error: 'backend.prompt_contains_potentially_malicious_content_request_rejected_for_security_reasons'
        };
      }
    }

    // Additional checks for structured output attempts
    const structuredOutputAttempts = [
      /\bjson\b.*\{.*\}/i,
      /\bxml\b.*<.*>/i,
      /\bformat\b.*\{(json|xml|yaml)\}/i,
    ];

    for (const pattern of structuredOutputAttempts) {
      if (pattern.test(prompt)) {
        logger.warn('Prompt contains structured output request', {
          pattern: pattern.source
        });
        // This is allowed but should be monitored
        break;
      }
    }

    return { valid: true, sanitized: prompt.trim() };
  }

  /**
   * Sanitize user input for AI prompts
   * @param prompt The prompt to sanitize
   * @returns Sanitized prompt
   */
  static sanitizePrompt(prompt: string): string {
    // Remove potential control characters
    let sanitized = prompt.replace(/[\x00-\x1F\x7F]/g, '');

    // Limit repeated characters (prevent DoS)
    sanitized = sanitized.replace(/(.{10,}?)\1{10,}/g, '$1');

    return sanitized;
  }
}

/**
 * POST /api/scanner/smart-fix
 * Fix a problem using AI
 * SECURITY FIX CVE-2026-004: Added authentication and admin role requirement
 */
router.post('/smart-fix', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recommendation, context, options } = req.body;

    if (!recommendation) {
      return res.status(400).json({ success: false, error: 'backend.recommendation_is_required' });
    }

    logger.info(`Starting smart fix for: ${recommendation.title}`);

    // Create smart fixer with options
    const smartFixer = new SmartFixer({
      enableAI: options?.enableAI !== false,
      aiProvider: options?.aiProvider || {
        name: process.env.AI_PROVIDER || 'ollama',
        apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.AI_BASE_URL,
        model: process.env.AI_MODEL || 'llama2'
      },
      maxAttempts: options?.maxAttempts || 3,
      executionTimeout: options?.executionTimeout || 60000,
      enableRealTimeMonitoring: options?.enableRealTimeMonitoring !== false
    });

    // Run smart fix
    const result = await smartFixer.fixProblem(recommendation, context);

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    logger.error('Smart fix failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/batch-fix
 * Fix multiple problems in batch
 */
router.post('/batch-fix', async (req: Request, res: Response) => {
  try {
    const { recommendations, context, options } = req.body;

    if (!recommendations || !Array.isArray(recommendations)) {
      return res.status(400).json({ success: false, error: 'backend.recommendations_array_is_required' });
    }

    logger.info(`Batch fixing ${recommendations.length} problems`);

    const smartFixer = new SmartFixer(options);

    const results = await smartFixer.batchFix(recommendations, context);

    const summary = {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      totalAttempts: results.reduce((sum, r) => sum + r.attempts.length, 0),
      totalTime: results.reduce((sum, r) => sum + r.totalTime, 0)
    };

    logger.info('Batch fix complete', { summary });

    res.json({
      success: true,
      data: {
        results,
        summary
      }
    });
  } catch (error: any) {
    logger.error('Batch fix failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/dry-fix
 * Simulate fixing without executing
 */
router.post('/dry-fix', async (req: Request, res: Response) => {
  try {
    const { recommendation, context, options } = req.body;

    if (!recommendation) {
      return res.status(400).json({ success: false, error: 'backend.recommendation_is_required' });
    }

    logger.info(`Dry run for: ${recommendation.title}`);

    const smartFixer = new SmartFixer(options);

    const dryRunResult = await smartFixer.dryFix(recommendation, context);

    res.json({
      success: true,
      data: dryRunResult
    });
  } catch (error: any) {
    logger.error('Dry fix failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/scanner/ai-status
 * Check AI provider status
 */
router.get('/ai-status', async (req: Request, res: Response) => {
  try {
    const provider = {
      name: process.env.AI_PROVIDER || 'ollama',
      model: process.env.AI_MODEL || 'llama2',
      baseURL: process.env.AI_BASE_URL || 'http://localhost:11434',
      configured: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.AI_BASE_URL)
    };

    // Test connection if configured
    let status = 'not_configured';
    let error = null;

    if (provider.configured) {
      try {
        if (provider.name === 'ollama') {
          // Test Ollama connection
          const axios = require('axios');
          await axios.get(`${provider.baseURL}/api/tags`, { timeout: 5000 });
          status = 'available';
        } else if (provider.name === 'openai' || provider.name === 'anthropic') {
          // Just check if API key is present
          status = 'available';
        }
      } catch (err: any) {
        status = 'unavailable';
        error = err.message;
      }
    }

    res.json({
      success: true,
      data: {
        provider,
        status,
        error
      }
    });
  } catch (error: any) {
    logger.error('AI status check failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/ai-analyze
 * Analyze a problem using AI
 * SECURITY FIX: Added prompt injection validation
 */
router.post('/ai-analyze', async (req: Request, res: Response) => {
  try {
    const { problem, context } = req.body;

    if (!problem) {
      return res.status(400).json({ success: false, error: 'backend.problem_is_required' });
    }

    // SECURITY: Validate problem description for prompt injection
    const validation = AIPromptValidator.validatePrompt(problem);
    if (!validation.valid) {
      logger.warn('Blocked AI analysis with potentially malicious prompt', {
        error: validation.error
      });
      return res.status(400).json({
        success: false,
        error: validation.error || 'Invalid prompt content'
      });
    }

    // Use sanitized prompt
    const sanitizedProblem = AIPromptValidator.sanitizePrompt(problem);

    // Also validate context if provided
    if (context) {
      if (context.logs && Array.isArray(context.logs)) {
        // Limit logs to prevent DoS
        context.logs = context.logs.slice(0, 100);
      }

      if (context.configFiles) {
        // Limit config file content
        for (const [key, value] of Object.entries(context.configFiles)) {
          if (typeof value === 'string' && value.length > 50000) {
            context.configFiles[key as string] = value.substring(0, 50000) + '... (truncated)';
          }
        }
      }
    }

    const { AIEngine } = await import('../../scanner/ai-engine');

    const aiEngine = new AIEngine({
      name: (process.env.AI_PROVIDER || 'ollama') as any,
      apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.AI_BASE_URL,
      model: process.env.AI_MODEL || 'llama2'
    });

    const analysis = await aiEngine.analyzeProblem({
      problem: {
        title: 'User Reported Issue',
        description: sanitizedProblem,
        category: 'general',
        priority: 'medium'
      },
      context: {
        systemInfo: context?.systemInfo || {},
        logs: context?.logs || [],
        configFiles: context?.configFiles || {}
      }
    });

    res.json({
      success: true,
      data: analysis
    });
  } catch (error: any) {
    logger.error('AI analysis failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
