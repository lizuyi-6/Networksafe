import {
  CreateBucketCommand,
  GetObjectCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectLockConfigurationCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import path from 'path';
import fs from 'fs/promises';
import { platformConfigService } from './platform-config.service';
import logger from '../utils/logger';

export interface AuditArchiveWriteResult {
  artifactRef: string;
  location: string;
  bucket: string;
  objectKey: string;
  versionId?: string;
  retentionUntil?: string;
  objectLockEnabled: boolean;
}

export interface AuditArchiveInspection {
  bucket: string;
  objectKey: string;
  versionId?: string;
  objectLockEnabled: boolean;
  objectLockMode?: string;
  retentionUntil?: string;
  contentLength?: number;
}

function sanitizeScope(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'root';
}

function sanitizeKey(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'artifact';
}

async function streamToString(stream: any): Promise<string> {
  if (!stream) {
    return '';
  }
  if (typeof stream.transformToString === 'function') {
    return stream.transformToString();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

class AuditArchiveService {
  private client: S3Client | null = null;
  private ensuredBuckets = new Set<string>();

  private getClient(): S3Client {
    if (this.client) {
      return this.client;
    }

    const endpoint = String(process.env.S3_ENDPOINT || '').trim();
    const accessKeyId = String(process.env.S3_ACCESS_KEY || '').trim();
    const secretAccessKey = String(process.env.S3_SECRET_KEY || '').trim();
    const region = String(process.env.S3_REGION || 'us-east-1').trim();

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('backend.audit_archive_s3_configuration_incomplete');
    }

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });

    return this.client;
  }

  private getFallbackDir(): string {
    return process.env.ARTIFACTS_DIR || path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'artifacts');
  }

  private async getSettings(tenantId: string) {
    const config = await platformConfigService.getConfig(tenantId);
    return config.auditArchive;
  }

  async ensureBucket(tenantId: string): Promise<{ bucket: string; objectLockRequired: boolean; retentionDays: number }> {
    const settings = await this.getSettings(tenantId);
    const bucket = settings.bucket;
    if (!bucket) {
      throw new Error('backend.audit_archive_bucket_required');
    }

    if (this.ensuredBuckets.has(bucket)) {
      return {
        bucket,
        objectLockRequired: settings.objectLockRequired,
        retentionDays: settings.retentionDays
      };
    }

    const client = this.getClient();
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error: any) {
      const statusCode = Number(error?.$metadata?.httpStatusCode || 0);
      const errorName = String(error?.name || '');
      if (statusCode !== 404 && errorName !== 'NotFound' && errorName !== 'NoSuchBucket') {
        throw error;
      }

      await client.send(new CreateBucketCommand({
        Bucket: bucket,
        ObjectLockEnabledForBucket: settings.objectLockRequired
      }));
    }

    await client.send(new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    }));

    if (settings.objectLockRequired) {
      await client.send(new PutObjectLockConfigurationCommand({
        Bucket: bucket,
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: {
            DefaultRetention: {
              Mode: 'COMPLIANCE',
              Days: settings.retentionDays
            }
          }
        }
      }));
    }

    const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (settings.objectLockRequired && versioning.Status !== 'Enabled') {
      throw new Error('backend.audit_archive_versioning_not_enabled');
    }

    this.ensuredBuckets.add(bucket);
    return {
      bucket,
      objectLockRequired: settings.objectLockRequired,
      retentionDays: settings.retentionDays
    };
  }

  async writeLockedJson(tenantId: string, scope: string, key: string, payload: unknown): Promise<AuditArchiveWriteResult> {
    const settings = await this.getSettings(tenantId);
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(`${key}.json`);
    const objectKey = `${safeScope}/${safeKey}`;
    const retentionUntilDate = new Date(Date.now() + settings.retentionDays * 24 * 60 * 60 * 1000);

    try {
      const { bucket, objectLockRequired } = await this.ensureBucket(tenantId);
      const response = await this.getClient().send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: JSON.stringify(payload, null, 2),
        ContentType: 'application/json',
        ObjectLockMode: objectLockRequired ? 'COMPLIANCE' : undefined,
        ObjectLockRetainUntilDate: objectLockRequired ? retentionUntilDate : undefined
      }));

      return {
        artifactRef: `artifact://s3/${bucket}/${objectKey}`,
        location: `s3://${bucket}/${objectKey}`,
        bucket,
        objectKey,
        versionId: response.VersionId,
        retentionUntil: retentionUntilDate.toISOString(),
        objectLockEnabled: settings.objectLockRequired
      };
    } catch (error: any) {
      logger.error('Failed to persist audit archive to locked bucket', {
        tenantId,
        bucket: settings.bucket,
        key: objectKey,
        error: error?.message
      });

      if (settings.objectLockRequired) {
        throw error;
      }

      const fallbackDir = path.join(this.getFallbackDir(), 'audit-fallback', safeScope);
      await fs.mkdir(fallbackDir, { recursive: true });
      const targetPath = path.join(fallbackDir, safeKey);
      await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
      return {
        artifactRef: `artifact://local/audit-fallback/${safeScope}/${safeKey}`,
        location: targetPath,
        bucket: 'local-fallback',
        objectKey,
        objectLockEnabled: false
      };
    }
  }

  async inspectObject(bucket: string, objectKey: string, versionId?: string): Promise<AuditArchiveInspection> {
    const response = await this.getClient().send(new HeadObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      VersionId: versionId
    }));

    return {
      bucket,
      objectKey,
      versionId: response.VersionId || versionId,
      objectLockEnabled: Boolean(response.ObjectLockMode || response.ObjectLockRetainUntilDate),
      objectLockMode: response.ObjectLockMode,
      retentionUntil: response.ObjectLockRetainUntilDate ? response.ObjectLockRetainUntilDate.toISOString() : undefined,
      contentLength: response.ContentLength
    };
  }

  async readJson<T>(bucket: string, objectKey: string, versionId?: string): Promise<T> {
    const response = await this.getClient().send(new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      VersionId: versionId
    }));
    const raw = await streamToString(response.Body);
    return JSON.parse(raw) as T;
  }
}

export const auditArchiveService = new AuditArchiveService();
