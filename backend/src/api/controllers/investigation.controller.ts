/**
 * Investigation Controller
 *
 * Handles API requests for bug investigation agent team.
 */

import { Request, Response, NextFunction } from 'express';
import { BugInvestigationTeam } from '../../ai-agents/investigation';
import { InvestigationService } from '../../services/investigation.service';

export class InvestigationController {
  private investigationTeam: BugInvestigationTeam;
  private investigationService: InvestigationService;

  constructor() {
    this.investigationTeam = BugInvestigationTeam.getInstance();
    this.investigationService = new InvestigationService();
  }

  /**
   * Start a new investigation
   */
  public startInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        title,
        description,
        severity,
        category,
        reproductionSteps,
        environment,
        reporter,
        logs,
        traces,
        metrics,
        codeContext
      } = req.body;

      const agentId = (req as Request & { agent?: { id?: string } }).agent?.id;

      // Create bug report
      const bugReport = BugInvestigationTeam.createBugReport({
        title,
        description,
        severity,
        category,
        reproductionSteps,
        environment,
        reporter: reporter || agentId || 'api'
      });

      // Create investigation context
      const context = BugInvestigationTeam.createContext({
        bugReport,
        logs,
        traces,
        metrics,
        codeContext
      });

      // Start investigation
      console.log(`[InvestigationController] Starting investigation for bug ${bugReport.id}`);
      const result = await this.investigationTeam.investigate(bugReport, context);

      // Save investigation to database
      await this.investigationService.saveInvestigation({
        investigationId: result.investigationId,
        bugReportId: bugReport.id,
        bugReport,
        context,
        result,
        createdAt: new Date(),
        status: 'completed'
      });

      res.status(200).json({
        success: true,
        data: {
          investigationId: result.investigationId,
          bugReportId: bugReport.id,
          result,
          status: 'completed'
        }
      });
    } catch (error) {
      console.error('[InvestigationController] Failed to start investigation:', error);
      next(error);
    }
  };

  /**
   * Get investigation status
   */
  public getInvestigationStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { investigationId } = req.params;

      const status = this.investigationTeam.getInvestigationStatus(investigationId);

      if (!status || status.status === 'not_found') {
        res.status(404).json({
          success: false,
          error: 'Investigation not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: status
      });
    } catch (error) {
      console.error('[InvestigationController] Failed to get investigation status:', error);
      next(error);
    }
  };

  /**
   * Get investigation result
   */
  public getInvestigationResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { investigationId } = req.params;

      // Try to get from database first
      const savedResult = await this.investigationService.getInvestigation(investigationId);

      if (savedResult) {
        res.status(200).json({
          success: true,
          data: savedResult
        });
        return;
      }

      // If not in database, check active investigations
      const status = this.investigationTeam.getInvestigationStatus(investigationId);

      if (!status || status.status === 'not_found') {
        res.status(404).json({
          success: false,
          error: 'Investigation not found'
        });
        return;
      }

      if (status.status === 'in_progress') {
        res.status(202).json({
          success: true,
          data: {
            investigationId,
            status: 'in_progress',
            message: 'Investigation still in progress'
          }
        });
        return;
      }

      res.status(404).json({
        success: false,
        error: 'Investigation result not found'
      });
    } catch (error) {
      console.error('[InvestigationController] Failed to get investigation result:', error);
      next(error);
    }
  };

  /**
   * Get active investigations
   */
  public getActiveInvestigations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const investigations = this.investigationTeam.getActiveInvestigations();

      res.status(200).json({
        success: true,
        data: investigations,
        count: investigations.length
      });
    } catch (error) {
      console.error('[InvestigationController] Failed to get active investigations:', error);
      next(error);
    }
  };

  /**
   * Get agent capabilities
   */
  public getCapabilities = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const capabilities = this.investigationTeam.getAgentCapabilities();

      res.status(200).json({
        success: true,
        data: capabilities
      });
    } catch (error) {
      console.error('[InvestigationController] Failed to get capabilities:', error);
      next(error);
    }
  };

  /**
   * Cancel an investigation
   */
  public cancelInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { investigationId } = req.params;

      // TODO: Implement cancellation logic in coordinator
      res.status(501).json({
        success: false,
        error: 'Investigation cancellation not yet implemented'
      });
    } catch (error) {
      console.error('[InvestigationController] Failed to cancel investigation:', error);
      next(error);
    }
  };

  /**
   * Get investigation history
   */
  public getInvestigationHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { limit = 50, offset = 0, severity, category } = req.query;

      const history = await this.investigationService.getInvestigationHistory({
        limit: Number(limit),
        offset: Number(offset),
        severity: severity as string,
        category: category as string
      });

      res.status(200).json({
        success: true,
        data: history.investigations,
        pagination: {
          total: history.total,
          limit: Number(limit),
          offset: Number(offset)
        }
      });
    } catch (error) {
      console.error('[InvestigationController] Failed to get investigation history:', error);
      next(error);
    }
  };
}
