/**
 * Backup Model
 */

export interface Backup {
  id: number;
  name: string;
  description: string;
  data: string; // JSON string
  createdAt: string;
  size: number; // in bytes
  isAutomatic: boolean;
}

export interface BackupMetadata {
  version: string;
  timestamp: number;
  sitesCount: number;
  configs: any;
}
