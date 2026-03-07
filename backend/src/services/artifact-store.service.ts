import fs from 'fs/promises';
import path from 'path';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import logger from '../utils/logger';
import { getArtifactStoreMode } from '../config/platform-runtime';

interface ArtifactWriteResult {
  artifactRef: string;
  location: string;
}

type ArtifactStoreModeName = 'local' | 's3';

interface ArtifactStoreDescription {
  requestedMode: 'local' | 's3';
  activeMode: ArtifactStoreModeName;
  bucket?: string;
  endpoint?: string;
}

interface ArtifactStore {
  readonly mode: ArtifactStoreModeName;
  writeJson(scope: string, key: string, payload: unknown): Promise<ArtifactWriteResult>;
  describe(): ArtifactStoreDescription;
}

function sanitizeScope(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'root';
}

function sanitizeKey(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'artifact';
}

class LocalArtifactStore implements ArtifactStore {
  readonly mode = 'local' as const;

  constructor(private readonly baseDir: string) {}

  async writeJson(scope: string, key: string, payload: unknown): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const targetDir = path.join(this.baseDir, safeScope);
    const targetPath = path.join(targetDir, `${safeKey}.json`);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
    return {
      artifactRef: `artifact://local/${safeScope}/${safeKey}.json`,
      location: targetPath
    };
  }

  describe(): ArtifactStoreDescription {
    return {
      requestedMode: getArtifactStoreMode(),
      activeMode: this.mode
    };
  }
}

class S3ArtifactStore implements ArtifactStore {
  readonly mode = 's3' as const;
  private readonly client: S3Client;
  private readonly fallbackStore: LocalArtifactStore;
  private bucketReady = false;

  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    private readonly region: string,
    accessKeyId: string,
    secretAccessKey: string,
    fallbackBaseDir: string
  ) {
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
    this.fallbackStore = new LocalArtifactStore(fallbackBaseDir);
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) {
      return;
    }

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketReady = true;
      return;
    } catch (error: any) {
      const statusCode = Number(error?.$metadata?.httpStatusCode || 0);
      const errorName = String(error?.name || '');
      if (statusCode !== 404 && errorName !== 'NotFound' && errorName !== 'NoSuchBucket') {
        throw error;
      }
    }

    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.bucketReady = true;
  }

  async writeJson(scope: string, key: string, payload: unknown): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const objectKey = `${safeScope}/${safeKey}.json`;

    try {
      await this.ensureBucket();
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: JSON.stringify(payload, null, 2),
        ContentType: 'application/json'
      }));
      return {
        artifactRef: `artifact://s3/${this.bucket}/${objectKey}`,
        location: `s3://${this.bucket}/${objectKey}`
      };
    } catch (error: any) {
      logger.warn('Failed to persist artifact to S3-compatible store, falling back to local disk', {
        bucket: this.bucket,
        endpoint: this.endpoint,
        key: objectKey,
        error: error?.message
      });
      return this.fallbackStore.writeJson(scope, key, payload);
    }
  }

  describe(): ArtifactStoreDescription {
    return {
      requestedMode: getArtifactStoreMode(),
      activeMode: this.mode,
      bucket: this.bucket,
      endpoint: this.endpoint
    };
  }
}

class ArtifactStoreService {
  private store: ArtifactStore | null = null;

  private getBaseDir(): string {
    return process.env.ARTIFACTS_DIR || path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'artifacts');
  }

  private createStore(): ArtifactStore {
    const requestedMode = getArtifactStoreMode();
    const baseDir = this.getBaseDir();

    if (requestedMode !== 's3') {
      return new LocalArtifactStore(baseDir);
    }

    const endpoint = String(process.env.S3_ENDPOINT || '').trim();
    const bucket = String(process.env.S3_BUCKET || '').trim();
    const accessKeyId = String(process.env.S3_ACCESS_KEY || '').trim();
    const secretAccessKey = String(process.env.S3_SECRET_KEY || '').trim();
    const region = String(process.env.S3_REGION || 'us-east-1').trim();

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      logger.warn('ARTIFACT_STORE=s3 requested but S3 configuration is incomplete; falling back to local artifact store');
      return new LocalArtifactStore(baseDir);
    }

    logger.info('S3-compatible artifact store configured', {
      endpoint,
      bucket,
      region
    });

    return new S3ArtifactStore(endpoint, bucket, region, accessKeyId, secretAccessKey, baseDir);
  }

  private getStore(): ArtifactStore {
    if (!this.store) {
      this.store = this.createStore();
    }
    return this.store;
  }

  async writeJson(scope: string, key: string, payload: unknown): Promise<ArtifactWriteResult> {
    return this.getStore().writeJson(scope, key, payload);
  }

  describe(): ArtifactStoreDescription {
    return this.getStore().describe();
  }
}

export const artifactStoreService = new ArtifactStoreService();
