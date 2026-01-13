import { Router, Request, Response } from 'express';
import { SmartFixer } from '../../scanner/smart-fixer';
import { OptimizationEngine } from '../../scanner/optimization-engine';
import logger from '../../../utils/logger';

const router = Router();
const optimizationEngine = new OptimizationEngine();

/**
 * POST /api/scanner/smart-fix
 * Fix a problem using AI
 */
router.post('/smart-fix', async (req: Request, res: Response) => {
  try {
    const { recommendation, context, options } = req.body;

    if (!recommendation) {
      return res.status(400).json({ success: false, error: 'recommendation is required' });
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
      return res.status(400).json({ success: false, error: 'recommendations array is required' });
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
      return res.status(400).json({ success: false, error: 'recommendation is required' });
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
 */
router.post('/ai-analyze', async (req: Request, res: Response) => {
  try {
    const { problem, context } = req.body;

    if (!problem) {
      return res.status(400).json({ success: false, error: 'problem is required' });
    }

    const { AIEngine } = await import('../../scanner/ai-engine');

    const aiEngine = new AIEngine({
      name: process.env.AI_PROVIDER || 'ollama',
      apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.AI_BASE_URL,
      model: process.env.AI_MODEL || 'llama2'
    });

    const analysis = await aiEngine.analyzeProblem({
      problem,
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
