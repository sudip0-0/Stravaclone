import sharp from 'sharp';
import {
  MAX_PHOTO_DIMENSION,
  MAX_PHOTO_INPUT_BYTES,
  MAX_PHOTO_OUTPUT_BYTES,
} from '@trail/contracts';
import type { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { HEIC_WORKER_SOURCE } from './heic-worker.js';

export const MAX_PHOTO_PIXELS = 40_000_000;
const PROCESSING_TIMEOUT_SECONDS = 30;

sharp.cache(false);
sharp.concurrency(2);

export type VerifiedInputMime = 'image/jpeg' | 'image/heic' | 'image/webp';

export interface ProcessedPhoto {
  readonly body: Buffer;
  readonly mime: 'image/jpeg' | 'image/webp';
  readonly width: number;
  readonly height: number;
}

export class InvalidPhotoError extends Error {
  constructor(
    readonly safeCode:
      | 'malformed_photo'
      | 'unsupported_media_type'
      | 'normalized_photo_too_large',
  ) {
    super(safeCode);
  }
}

export async function readBoundedPhoto(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const timer = setTimeout(
    () => stream.destroy(new Error('photo_read_timeout')),
    30_000,
  );
  try {
    for await (const chunk of stream) {
      const chunkValue: unknown = chunk;
      if (!Buffer.isBuffer(chunkValue) && typeof chunkValue !== 'string')
        throw new InvalidPhotoError('malformed_photo');
      const value = Buffer.from(chunkValue);
      bytes += value.length;
      if (bytes > MAX_PHOTO_INPUT_BYTES) {
        stream.destroy();
        throw new InvalidPhotoError('malformed_photo');
      }
      chunks.push(value);
    }
    if (bytes === 0) throw new InvalidPhotoError('malformed_photo');
    return Buffer.concat(chunks, bytes);
  } finally {
    clearTimeout(timer);
  }
}

function detectJpeg(input: Buffer): boolean {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return false;
  const end = input.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (end < 2) return false;
  for (let index = end + 2; index < input.length; index += 1) {
    const byte = input[index]!;
    if (byte !== 0 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32)
      return false;
  }
  return true;
}

function detectWebp(input: Buffer): boolean {
  return (
    input.length >= 12 &&
    input.toString('ascii', 0, 4) === 'RIFF' &&
    input.toString('ascii', 8, 12) === 'WEBP' &&
    input.readUInt32LE(4) + 8 === input.length
  );
}

function detectHeic(input: Buffer): boolean {
  if (input.length < 16 || input.toString('ascii', 4, 8) !== 'ftyp')
    return false;
  const brands = new Set([
    'heic',
    'heix',
    'hevc',
    'hevx',
    'heim',
    'heis',
    'mif1',
  ]);
  const ftypSize = input.readUInt32BE(0);
  if (ftypSize < 16 || ftypSize > input.length) return false;
  let hasHeicBrand = false;
  for (let offset = 8; offset + 4 <= ftypSize; offset += 4) {
    if (brands.has(input.toString('ascii', offset, offset + 4)))
      hasHeicBrand = true;
  }
  if (!hasHeicBrand) return false;
  let offset = 0;
  while (offset < input.length) {
    if (offset + 8 > input.length) return false;
    let size = input.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > input.length) return false;
      const wide = input.readBigUInt64BE(offset + 8);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      size = Number(wide);
      header = 16;
    }
    if (size < header || offset + size > input.length) return false;
    offset += size;
  }
  return offset === input.length;
}

export function detectPhotoMime(input: Buffer): VerifiedInputMime {
  if (detectJpeg(input)) return 'image/jpeg';
  if (detectWebp(input)) return 'image/webp';
  if (detectHeic(input)) return 'image/heic';
  throw new InvalidPhotoError('unsupported_media_type');
}

interface DecodedHeic {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

export async function decodeHeic(
  input: Buffer,
  options: {
    readonly timeoutMs?: number;
    readonly workerUrl?: URL;
  } = {},
): Promise<DecodedHeic> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(options.workerUrl ?? HEIC_WORKER_SOURCE, {
      eval: options.workerUrl === undefined,
      stderr: true,
      stdout: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 8,
      },
    });
    worker.stderr?.resume();
    worker.stdout?.resume();
    const timer = setTimeout(
      () => {
        void worker.terminate();
        reject(new InvalidPhotoError('malformed_photo'));
      },
      options.timeoutMs ?? PROCESSING_TIMEOUT_SECONDS * 1_000,
    );
    worker.once(
      'message',
      (result: {
        readonly data?: Uint8ClampedArray;
        readonly width?: number;
        readonly height?: number;
        readonly error?: string;
      }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (!result.data || !result.width || !result.height || result.error) {
          reject(new InvalidPhotoError('malformed_photo'));
          return;
        }
        resolve({
          data: Buffer.from(result.data),
          width: result.width,
          height: result.height,
        });
      },
    );
    worker.once('error', () => {
      clearTimeout(timer);
      void worker.terminate();
      reject(new InvalidPhotoError('malformed_photo'));
    });
    worker.postMessage(input);
  });
}

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const mime = detectPhotoMime(input);
  try {
    const decoded = mime === 'image/heic' ? await decodeHeic(input) : null;
    const image = decoded
      ? sharp(decoded.data, {
          raw: {
            width: decoded.width,
            height: decoded.height,
            channels: 4,
          },
          limitInputPixels: MAX_PHOTO_PIXELS,
        })
      : sharp(input, {
          failOn: 'warning',
          limitInputPixels: MAX_PHOTO_PIXELS,
          pages: 1,
        });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > 20_000 ||
      metadata.height > 20_000 ||
      metadata.width * metadata.height > MAX_PHOTO_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new InvalidPhotoError('malformed_photo');
    }
    const pipeline = image
      .rotate()
      .resize({
        width: MAX_PHOTO_DIMENSION,
        height: MAX_PHOTO_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .timeout({ seconds: PROCESSING_TIMEOUT_SECONDS });
    const output =
      mime === 'image/webp'
        ? pipeline.webp({ quality: 85, effort: 4 })
        : pipeline.jpeg({ quality: 85, mozjpeg: true });
    const result = await output.toBuffer({ resolveWithObject: true });
    if (!result.info.width || !result.info.height)
      throw new InvalidPhotoError('malformed_photo');
    if (result.data.length > MAX_PHOTO_OUTPUT_BYTES)
      throw new InvalidPhotoError('normalized_photo_too_large');
    return {
      body: result.data,
      mime: mime === 'image/webp' ? 'image/webp' : 'image/jpeg',
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof InvalidPhotoError) throw error;
    throw new InvalidPhotoError('malformed_photo');
  }
}
