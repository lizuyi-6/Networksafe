/**
 * Site Configuration Model
 */

export interface SiteConfig {
  id: number;
  domain: string;
  target: string; // Backend server URL
  sslEnabled: boolean;
  security: {
    antiBot: boolean;
    rateLimit: {
      enabled: boolean;
      requestsPerMinute: number;
    };
    concurrency: {
      enabled: boolean;
      maxConcurrent: number;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateSiteDto {
  domain: string;
  target: string;
  sslEnabled?: boolean;
  security?: SiteConfig['security'];
}

export interface UpdateSiteDto {
  target?: string;
  sslEnabled?: boolean;
  security?: Partial<SiteConfig['security']>;
}
