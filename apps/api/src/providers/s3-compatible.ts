import { Client as MinioClient } from 'minio';
import type { DependencyStatus, ObjectStorageProvider } from './ports.js';

export interface S3CompatibleStorageConfig {
  readonly endpoint: string;
  readonly port: number;
  readonly useSsl: boolean;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchObject';
}

export function createS3CompatibleObjectStorage(
  config: S3CompatibleStorageConfig,
): ObjectStorageProvider {
  const client = new MinioClient({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSsl,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });

  return {
    bucket: config.bucket,
    async checkHealth(): Promise<DependencyStatus> {
      try {
        await client.statObject(config.bucket, '.trail-healthcheck');
        return 'up';
      } catch (error) {
        return isMissingObject(error) ? 'up' : 'down';
      }
    },
    async presignPost(
      key,
      contentType,
      minimumBytes,
      maximumBytes,
      expiresSeconds,
    ) {
      const policy = client.newPostPolicy();
      policy.setBucket(config.bucket);
      policy.setKey(key);
      policy.setContentType(contentType);
      policy.setContentLengthRange(minimumBytes, maximumBytes);
      policy.setExpires(new Date(Date.now() + expiresSeconds * 1000));
      const result = await client.presignedPostPolicy(policy);
      return { url: result.postURL, fields: result.formData };
    },
    presignGet: (key, expiresSeconds) =>
      client.presignedGetObject(config.bucket, key, expiresSeconds),
    async head(key) {
      try {
        const stat = await client.statObject(config.bucket, key);
        return {
          sizeBytes: stat.size,
          contentType:
            stat.metaData && typeof stat.metaData['content-type'] === 'string'
              ? stat.metaData['content-type']
              : null,
        };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
    get: (key) => client.getObject(config.bucket, key),
    async put(key, body, contentType) {
      await client.putObject(config.bucket, key, body, body.length, {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
      });
    },
    async delete(key) {
      await client.removeObject(config.bucket, key);
    },
  };
}
