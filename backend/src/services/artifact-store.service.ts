import fs from 'fs/promises';
import path from 'path';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import logger from '../utils/logger';
import { getArtifactStoreMode } from '../config/platform-runtime';

export interface ArtifactWriteResult {
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
  writeText(scope: string, key: string, payload: string, contentType?: string): Promise<ArtifactWriteResult>;
  writeBinary(scope: string, key: string, payload: Buffer, contentType?: string): Promise<ArtifactWriteResult>;
  readText(artifactRef: string, fallbackLocation?: string): Promise<string>;
  describe(): ArtifactStoreDescription;
}

function sanitizeScope(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'root';
}

function sanitizeKey(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'artifact';
}

function parseLocalArtifactRef(artifactRef: string): string | null {
  const prefix = 'artifact://local/';
  if (!artifactRef.startsWith(prefix)) {
    return null;
  }
  return artifactRef.slice(prefix.length);
}

function parseS3ArtifactRef(artifactRef: string): { bucket: string; key: string } | null {
  const prefix = 'artifact://s3/';
  if (!artifactRef.startsWith(prefix)) {
    return null;
  }

  const remainder = artifactRef.slice(prefix.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  return {
    bucket: remainder.slice(0, slashIndex),
    key: remainder.slice(slashIndex + 1)
  };
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

class LocalArtifactStore implements ArtifactStore {
  readonly mode = 'local' as const;

  constructor(private readonly baseDir: string) {}

  async writeJson(scope: string, key: string, payload: unknown): Promise<ArtifactWriteResult> {
    return this.writeText(scope, `${key}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  async writeText(scope: string, key: string, payload: string, _contentType = 'text/plain; charset=utf-8'): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const targetDir = path.join(this.baseDir, safeScope);
    const targetPath = path.join(targetDir, safeKey);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, payload, 'utf8');
    return {
      artifactRef: `artifact://local/${safeScope}/${safeKey}`,
      location: targetPath
    };
  }

  async writeBinary(scope: string, key: string, payload: Buffer, _contentType = 'application/octet-stream'): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const targetDir = path.join(this.baseDir, safeScope);
    const targetPath = path.join(targetDir, safeKey);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, payload);
    return {
      artifactRef: `artifact://local/${safeScope}/${safeKey}`,
      location: targetPath
    };
  }

  async readText(artifactRef: string, fallbackLocation?: string): Promise<string> {
    const relativePath = parseLocalArtifactRef(artifactRef);
    if (relativePath) {
      return fs.readFile(path.join(this.baseDir, relativePath), 'utf8');
    }
    if (fallbackLocation) {
      return fs.readFile(fallbackLocation, 'utf8');
    }
    throw new Error('backend.unsupported_local_artifact_ref');
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
    return this.writeText(scope, `${key}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  async writeText(scope: string, key: string, payload: string, contentType = 'text/plain; charset=utf-8'): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const objectKey = `${safeScope}/${safeKey}`;

    try {
      await this.ensureBucket();
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: payload,
        ContentType: contentType
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
      return this.fallbackStore.writeText(scope, key, payload, contentType);
    }
  }

  async writeBinary(scope: string, key: string, payload: Buffer, contentType = 'application/octet-stream'): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const objectKey = `${safeScope}/${safeKey}`;

    try {
      await this.ensureBucket();
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: payload,
        ContentType: contentType
      }));
      return {
        artifactRef: `artifact://s3/${this.bucket}/${objectKey}`,
        location: `s3://${this.bucket}/${objectKey}`
      };
    } catch (error: any) {
      logger.warn('Failed to persist binary artifact to S3-compatible store, falling back to local disk', {
        bucket: this.bucket,
        endpoint: this.endpoint,
        key: objectKey,
        error: error?.message
      });
      return this.fallbackStore.writeBinary(scope, key, payload, contentType);
    }
  }

  async readText(artifactRef: string, fallbackLocation?: string): Promise<string> {
    const parsed = parseS3ArtifactRef(artifactRef);

    if (!parsed) {
      if (fallbackLocation) {
        return this.fallbackStore.readText('', fallbackLocation);
      }
      throw new Error('backend.unsupported_s3_artifact_ref');
    }

    try {
      await this.ensureBucket();
      const response = await this.client.send(new GetObjectCommand({
        Bucket: parsed.bucket,
        Key: parsed.key
      }));
      return await streamToString(response.Body);
    } catch (error: any) {
      logger.warn('Failed to read artifact from S3-compatible store, falling back to local disk when available', {
        bucket: parsed.bucket,
        endpoint: this.endpoint,
        key: parsed.key,
        error: error?.message
      });
      if (fallbackLocation) {
        return this.fallbackStore.readText('', fallbackLocation);
      }
      throw error;
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

  async writeText(scope: string, key: string, payload: string, contentType?: string): Promise<ArtifactWriteResult> {
    return this.getStore().writeText(scope, key, payload, contentType);
  }

  async writeBinary(scope: string, key: string, payload: Buffer, contentType?: string): Promise<ArtifactWriteResult> {
    return this.getStore().writeBinary(scope, key, payload, contentType);
  }

  async readText(artifactRef: string, fallbackLocation?: string): Promise<string> {
    return this.getStore().readText(artifactRef, fallbackLocation);
  }

  async readJson<T>(artifactRef: string, fallbackLocation?: string): Promise<T> {
    const raw = await this.readText(artifactRef, fallbackLocation);
    return JSON.parse(raw) as T;
  }

  describe(): ArtifactStoreDescription {
    return this.getStore().describe();
  }
}

export const artifactStoreService = new ArtifactStoreService();
