import { Client as MinioClient } from 'minio';
import { describe, expect, it } from 'vitest';
import { createS3CompatibleObjectStorage } from '../src/providers/s3-compatible.js';

const enabled = process.env.TEST_MINIO === 'true';
const suite = enabled ? describe : describe.skip;

suite('private MinIO storage boundary', () => {
  const config = {
    endpoint: '127.0.0.1',
    port: 9000,
    useSsl: false,
    accessKey: 'trail-app',
    secretKey: 'trail-app-local-value',
    bucket: 'trail-private',
  };

  it('denies anonymous list/read and keeps app credentials bucket-scoped', async () => {
    const storage = createS3CompatibleObjectStorage(config);
    const key = `integration/${process.pid}-${Date.now()}`;
    await storage.put(key, Buffer.from('private'), 'image/jpeg');
    try {
      expect(await storage.checkHealth()).toBe('up');
      expect((await fetch('http://127.0.0.1:9000/trail-private')).status).toBe(
        403,
      );
      expect(
        (await fetch(`http://127.0.0.1:9000/trail-private/${key}`)).status,
      ).toBe(403);
      const signed = await storage.presignGet(key, 900);
      const url = new URL(signed);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(await (await fetch(signed)).text()).toBe('private');
      const postKey = `${key}-post`;
      const post = await storage.presignPost(postKey, 'image/jpeg', 5, 5, 900);
      const upload = async (
        body: Blob,
        fields: Readonly<Record<string, string>> = post.fields,
      ) => {
        const form = new FormData();
        for (const [name, value] of Object.entries(fields))
          form.append(name, value);
        form.append('file', body, 'photo');
        return fetch(post.url, { method: 'POST', body: form });
      };
      expect(
        (
          await upload(new Blob(['wrong'], { type: 'image/webp' }), {
            ...post.fields,
            'Content-Type': 'image/webp',
          })
        ).ok,
      ).toBe(false);
      expect(
        (await upload(new Blob(['four'], { type: 'image/jpeg' }))).ok,
      ).toBe(false);
      expect(
        (await upload(new Blob(['sixsix'], { type: 'image/jpeg' }))).ok,
      ).toBe(false);
      expect(
        (
          await upload(
            new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {
              type: 'image/jpeg',
            }),
          )
        ).ok,
      ).toBe(false);
      expect(
        (await upload(new Blob(['valid'], { type: 'image/jpeg' }))).ok,
      ).toBe(true);
      expect((await storage.head(postKey))?.sizeBytes).toBe(5);
      const expiringGet = await storage.presignGet(key, 1);
      const expiringPost = await storage.presignPost(
        `${key}-expired`,
        'image/jpeg',
        1,
        10 * 1024 * 1024,
        1,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_100));
      expect((await fetch(expiringGet)).status).toBe(403);
      const expiredForm = new FormData();
      for (const [name, value] of Object.entries(expiringPost.fields))
        expiredForm.append(name, value);
      expiredForm.append(
        'file',
        new Blob(['late'], { type: 'image/jpeg' }),
        'photo',
      );
      expect(
        (
          await fetch(expiringPost.url, {
            method: 'POST',
            body: expiredForm,
          })
        ).ok,
      ).toBe(false);
      const client = new MinioClient({
        endPoint: config.endpoint,
        port: config.port,
        useSSL: config.useSsl,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
      });
      await expect(client.listBuckets()).resolves.toEqual([
        expect.objectContaining({ name: 'trail-private' }),
      ]);
      await expect(
        client.statObject('unscoped-bucket', key),
      ).rejects.toBeDefined();
    } finally {
      await storage.delete(key);
      await storage.delete(`${key}-post`);
      await storage.delete(`${key}-expired`);
    }
  });
});
