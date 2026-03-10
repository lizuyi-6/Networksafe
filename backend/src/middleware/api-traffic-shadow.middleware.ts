import { NextFunction, Request, Response } from 'express';
import { fastpathTrafficShadowService } from '../services/fastpath-traffic-shadow.service';

export function apiTrafficShadowMiddleware(req: Request, res: Response, next: NextFunction): void {
  fastpathTrafficShadowService.submitFromRequest(req);
  next();
}

export default apiTrafficShadowMiddleware;
