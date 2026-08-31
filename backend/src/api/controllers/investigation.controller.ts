/**
 * Investigation Controller
 *
 * Handles API requests for bug investigation agent team.
 */

import { Request, Response, NextFunction } from 'express';
import { BugInvestigationTeam } from '../../ai-agents/investigation';
import { InvestigationService } from '../../services/investigation.service';
import { isPlatformAdminRole } from '../../security/permissions';

/**
 * SECURITY (audit 2026-08, AUD-02-5): investigations are tenant-owned.
 * Ownership is recorded at creation and enforced on every read/cancel;
 * unknown ownership (legacy/persisted rows predating this fix) is visible
 * only to platform-level requesters. Tenant-scoped requesters get 404 —
 * indistinguishable from a missing id, so ownership cannot be probed.
 */
export class InvestigationController {
  private investigationTeam: BugInvestigationTeam;
  private investigationService: InvestigationService;
  private investigationTenants: Map<string, string | null> = new Map();

  constructor() {
    this.investigationTeam = BugInvestigationTeam.getInstance();
    this.investigationService = new InvestigationService();
  }

  private requesterTenantId(req: Request): string | null {
    const user = (req as Request & { user?: { tenantId?: string } }).user;
    return user?.tenantId ?? null;
  }

  private isPlatformRequester(req: Request): boolean {
    const user = (req as Request & { user?: { role?: string } }).user;
    return isPlatformAdminRole(user?.role);
  }

  private async canAccessInvestigation(req: Request, investigationId: string): Promise<boolean> {
    if (this.isPlatformRequester(req)) {
      return true;
    }
    // N3-4: ownership resolves from the in-process map first (active
    // investigations), then from the persisted owner_tenant_id — a restart
    // no longer silently reverts every investigation to platform-only
    // visibility. Unknown ownership fails closed for tenant-scoped
    // requesters.
    const owner = await this.resolveOwner(investigationId);
    if (owner === undefined) {
      return false;
    }
    return owner === this.requesterTenantId(req);
  }

  private async resolveOwner(investigationId: string): Promise<string | null | undefined> {
    if (this.investigationTenants.has(investigationId)) {
      return this.investigationTenants.get(investigationId) ?? null;
    }
    try {
      return await this.investigationService.getOwnerTenantId(investigationId);
    } catch {
      return undefined;
    }
  }

  private sendNotFound(res: Response): void {
    res.status(404).json({
      success: false,
      error: 'backend.investigation_not_found'
    });
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

      // AUD-02-5: record the owning tenant for object-level access control.
      // N3-4: also persist it — the in-process map dies with the process.
      const ownerTenantId = this.requesterTenantId(req);
      this.investigationTenants.set(result.investigationId, ownerTenantId);

      // Save investigation to database
      await this.investigationService.saveInvestigation({
        investigationId: result.investigationId,
        bugReportId: bugReport.id,
        bugReport,
        context,
        result,
        createdAt: new Date(),
        status: 'completed',
        ownerTenantId
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

      if (!(await this.canAccessInvestigation(req, investigationId))) {
        this.sendNotFound(res);
        return;
      }

      const status = this.investigationTeam.getInvestigationStatus(investigationId);

      if (!status || status.status === 'not_found') {
        this.sendNotFound(res);
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

      // AUD-02-5: object-level tenant guard (404, indistinguishable).
      if (!(await this.canAccessInvestigation(req, investigationId))) {
        this.sendNotFound(res);
        return;
      }

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
        this.sendNotFound(res);
        return;
      }

      if (status.status === 'in_progress') {
        res.status(202).json({
          success: true,
          data: {
            investigationId,
            status: 'in_progress',
            message: 'backend.investigation_still_in_progress'
          }
        });
        return;
      }

      res.status(404).json({
        success: false,
        error: 'backend.investigation_result_not_found'
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
      // AUD-02-5: tenant-scoped listing. Platform requesters see all;
      // tenant requesters only investigations owned by their tenant
      // (unknown ownership is hidden, not leaked).
      const platform = this.isPlatformRequester(req);
      const requesterTenant = this.requesterTenantId(req);
      const all = this.investigationTeam.getActiveInvestigations() as Array<Record<string, any>>;
      const investigations = all.filter((item) => {
        const id = String(item?.investigationId ?? item?.id ?? '');
        if (!this.investigationTenants.has(id)) {
          return platform;
        }
        return platform || this.investigationTenants.get(id) === requesterTenant;
      });

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

      // AUD-02-5: object-level tenant guard (404, indistinguishable).
      if (!(await this.canAccessInvestigation(req, investigationId))) {
        this.sendNotFound(res);
        return;
      }

      const result = this.investigationTeam.cancelInvestigation(investigationId);

      if (!result.cancelled) {
        const statusCode = result.status === 'not_found' ? 404 : 409;
        res.status(statusCode).json({
          success: false,
          error: result.message,
          data: {
            investigationId,
            status: result.status
          }
        });
        return;
      }

      try {
        await this.investigationService.updateInvestigationStatus(investigationId, 'cancelled');
      } catch (persistError) {
        console.warn('[InvestigationController] Cancelled investigation but failed to persist status:', persistError);
      }

      res.status(200).json({
        success: true,
        data: {
          investigationId,
          status: 'cancelled'
        }
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

      // AUD-02-5: tenant-scoped history. Rows whose ownership is unknown to
      // this controller instance (persisted before ownership tracking) are
      // platform-only; tenant requesters only see rows they own.
      const platform = this.isPlatformRequester(req);
      const requesterTenant = this.requesterTenantId(req);
      // N3-4: history rows carry persisted ownership; the in-process map is
      // only a fast path. Legacy rows without an owner stay platform-only.
      const rows = (history.investigations as Array<Record<string, any>>).filter((row) => {
        if (platform) {
          return true;
        }
        const id = String(row?.investigationId ?? row?.id ?? '');
        const owner = this.investigationTenants.has(id)
          ? (this.investigationTenants.get(id) ?? null)
          : (row?.ownerTenantId === undefined ? null : row?.ownerTenantId ?? null);
        return owner !== null && owner === requesterTenant;
      });

      res.status(200).json({
        success: true,
        data: rows,
        pagination: {
          total: rows.length,
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
