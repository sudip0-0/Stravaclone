import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  InvalidPhotoError,
  decodeHeic,
  detectPhotoMime,
  processPhoto,
} from '../src/photos/processor.js';

describe('private photo normalization', () => {
  const heicTest = process.env.TEST_HEIC === 'true' ? it : it.skip;

  heicTest(
    'decodes a real metadata-bearing HEIC through the worker',
    async () => {
      const fixture = await fetch(
        'https://raw.githubusercontent.com/strukturag/libheif/1a3583bcce77de6d3f8701c0758e3954863681ba/tests/data/rainbow-451x461.heic',
      );
      expect(fixture.ok).toBe(true);
      const output = await processPhoto(
        Buffer.from(await fixture.arrayBuffer()),
      );
      const metadata = await sharp(output.body).metadata();
      expect(output).toMatchObject({
        mime: 'image/jpeg',
        width: 451,
        height: 461,
      });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    },
  );
  it('normalizes orientation, bounds dimensions, and removes EXIF', async () => {
    const source = await sharp({
      create: {
        width: 5000,
        height: 1000,
        channels: 3,
        background: '#336699',
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'private' } } })
      .toBuffer();

    const output = await processPhoto(source);
    const metadata = await sharp(output.body).metadata();
    expect(output.mime).toBe('image/jpeg');
    expect(Math.max(output.width, output.height)).toBeLessThanOrEqual(4096);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it('uses verified bytes rather than a filename or declared content type', async () => {
    const webp = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    })
      .webp()
      .toBuffer();
    expect(detectPhotoMime(webp)).toBe('image/webp');
    expect((await processPhoto(webp)).mime).toBe('image/webp');
  });

  it('bounds HEIC worker failures and timeouts', async () => {
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write('ftyp', 4, 'ascii');
    ftyp.write('heic', 8, 'ascii');
    ftyp.writeUInt32BE(0, 12);
    ftyp.write('mif1', 16, 'ascii');
    ftyp.write('heic', 20, 'ascii');
    await expect(processPhoto(ftyp)).rejects.toBeInstanceOf(InvalidPhotoError);

    const workerUrl = new URL(
      `data:text/javascript,${encodeURIComponent("import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => setInterval(() => {}, 1000));")}`,
    );
    await expect(
      decodeHeic(Buffer.from('input'), { timeoutMs: 20, workerUrl }),
    ).rejects.toBeInstanceOf(InvalidPhotoError);
  });

  it('rejects malformed and practical trailing-data polyglots', async () => {
    const jpeg = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .toBuffer();
    expect(() => detectPhotoMime(Buffer.from('not-an-image'))).toThrow(
      InvalidPhotoError,
    );
    expect(() =>
      detectPhotoMime(
        Buffer.concat([jpeg, Buffer.from('<script>payload</script>')]),
      ),
    ).toThrow(InvalidPhotoError);
  });
});
