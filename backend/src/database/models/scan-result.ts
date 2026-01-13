/**
 * Scan Result Model
 */

export interface ScanResult {
  id: number;
  siteId: number;
  scanType: 'port' | 'system' | 'web' | 'all';
  result: any; // JSON data
  recommendations: Recommendation[];
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
}

export interface Recommendation {
  category: 'security' | 'performance' | 'reliability';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  action: string; // Command or action to take
  autoApplicable: boolean; // Can be automatically applied
  risk: string; // Potential risks
}

export interface ScanOptions {
  scanPorts?: boolean;
  scanSystem?: boolean;
  scanWebServer?: boolean;
  depth?: 'quick' | 'standard' | 'deep';
}
