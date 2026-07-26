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

  private assertWithinBaseDir(resolvedTarget: string, resolvedBase: string): void {
    const resolvedBaseDir = path.resolve(resolvedBase);
    const base = `${resolvedBaseDir}${path.sep}`;
    const target = path.resolve(resolvedTarget);
    if (target !== resolvedBaseDir && !target.startsWith(base)) {
      throw new Error('backend.artifact_path_escape_detected');
    }
  }

  /**
   * Resolve the REAL path of an existing file/dir (follows symlinks) and verify
   * it is within the real baseDir. Use on the READ path where the target exists.
   * If the target does not exist (e.g. a typo'd artifactRef), re-throw the
   * original ENOENT verbatim so callers see "not found" rather than a misleading
   * escape error.
   *
   * Defense-in-depth layer ON TOP of the string-based assertWithinBaseDir: the
   * string check cannot see symlinks, so a symlink inside baseDir pointing
   * outside would pass it and leak via fs.readFile. This closes that gap.
   *
   * Residual risk: there is an inherent check-vs-use window between realpath
   * and readFile where a symlink could be swapped (TOCTOU). Closing that
   * requires O_NOFOLLOW-style open-by-path which Node's fs.readFile does not
   * expose portably; for this threat model (attacker needs FS write access to
   * baseDir to swap the symlink, itself gated by the write-path checks), the
   * realpath check is proportionate.
   */
  private async assertRealPathWithinBaseDir(targetPath: string): Promise<void> {
    const realBase = await fs.realpath(this.baseDir);
    let realTarget: string;
    try {
      realTarget = await fs.realpath(targetPath);
    } catch (error: any) {
      throw error;
    }
    const base = `${realBase}${path.sep}`;
    if (realTarget !== realBase && !realTarget.startsWith(base)) {
      throw new Error('backend.artifact_path_escape_detected');
    }
  }

  /**
   * Resolve the REAL path of an existing directory (the write target's parent,
   * already ensured by fs.mkdir) and verify it is within the real baseDir.
   * Catches symlinked parent directories that would redirect a legitimate write
   * outside baseDir.
   */
  private async assertRealDirWithinBaseDir(dirPath: string): Promise<void> {
    const realBase = await fs.realpath(this.baseDir);
    const realDir = await fs.realpath(dirPath);
    const base = `${realBase}${path.sep}`;
    if (realDir !== realBase && !realDir.startsWith(base)) {
      throw new Error('backend.artifact_path_escape_detected');
    }
  }

  async writeJson(scope: string, key: string, payload: unknown): Promise<ArtifactWriteResult> {
    return this.writeText(scope, `${key}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  async writeText(scope: string, key: string, payload: string, _contentType = 'text/plain; charset=utf-8'): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const targetDir = path.join(this.baseDir, safeScope);
    const targetPath = path.join(targetDir, safeKey);
    const resolvedTargetDir = path.resolve(targetDir);
    const resolvedTargetPath = path.resolve(targetPath);
    this.assertWithinBaseDir(resolvedTargetPath, resolvedTargetDir);
    // A key may itself contain "/" (e.g. audit fallback writes
    // "<tenant>/<segment>.json"). mkdir must cover the key's own parent
    // directories, not just the scope dir, or writeFile throws ENOENT.
    // Verifying the real parent also closes the symlinked-subdirectory gap
    // that checking only the scope dir left open.
    const resolvedParentDir = path.dirname(resolvedTargetPath);
    await fs.mkdir(resolvedParentDir, { recursive: true });
    await this.assertRealDirWithinBaseDir(resolvedParentDir);
    await fs.writeFile(resolvedTargetPath, payload, 'utf8');
    return {
      artifactRef: `artifact://local/${safeScope}/${safeKey}`,
      location: resolvedTargetPath
    };
  }

  async writeBinary(scope: string, key: string, payload: Buffer, _contentType = 'application/octet-stream'): Promise<ArtifactWriteResult> {
    const safeScope = sanitizeScope(scope);
    const safeKey = sanitizeKey(key);
    const targetDir = path.join(this.baseDir, safeScope);
    const targetPath = path.join(targetDir, safeKey);
    const resolvedTargetDir = path.resolve(targetDir);
    const resolvedTargetPath = path.resolve(targetPath);
    this.assertWithinBaseDir(resolvedTargetPath, resolvedTargetDir);
    // Same nested-key rule as writeText: mkdir the key's real parent.
    const resolvedParentDir = path.dirname(resolvedTargetPath);
    await fs.mkdir(resolvedParentDir, { recursive: true });
    await this.assertRealDirWithinBaseDir(resolvedParentDir);
    await fs.writeFile(resolvedTargetPath, payload);
    return {
      artifactRef: `artifact://local/${safeScope}/${safeKey}`,
      location: resolvedTargetPath
    };
  }

  async readText(artifactRef: string, fallbackLocation?: string): Promise<string> {
    const relativePath = parseLocalArtifactRef(artifactRef);
    if (relativePath) {
      const targetPath = path.join(this.baseDir, relativePath);
      const resolvedTargetPath = path.resolve(targetPath);
      this.assertWithinBaseDir(resolvedTargetPath, this.baseDir);
      await this.assertRealPathWithinBaseDir(resolvedTargetPath);
      return fs.readFile(resolvedTargetPath, 'utf8');
    }
    if (fallbackLocation) {
      const targetPath = path.resolve(this.baseDir, fallbackLocation);
      this.assertWithinBaseDir(targetPath, this.baseDir);
      await this.assertRealPathWithinBaseDir(targetPath);
      return fs.readFile(targetPath, 'utf8');
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
