import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config.js';
import { validEnvironment } from './fixtures.js';

const mocks = vi.hoisted(() => ({
  statObject: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('minio', () => ({
  Client: class {
    statObject = mocks.statObject;
  },
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
}));
vi.mock('postgres', () => ({
  default: () => {
    const sql = async () => [{ '?column?': 1 }];
    return Object.assign(sql, { end: async () => undefined });
  },
}));

import { createLocalProviders } from '../src/providers/local.js';

describe('local providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({
      close: vi.fn(),
      sendMail: mocks.sendMail,
      verify: mocks.verify,
    });
    mocks.verify.mockResolvedValue(true);
    mocks.statObject.mockRejectedValue({ code: 'NoSuchKey' });
  });

  it('reports inaccessible object storage as down', async () => {
    mocks.statObject.mockRejectedValue({ code: 'AccessDenied' });
    const providers = createLocalProviders(parseConfig(validEnvironment));

    await expect(providers.objectStorage.checkHealth()).resolves.toBe('down');
    await providers.close();
  });

  it('uses the provider-neutral elevation boundary without adapter payloads', async () => {
    const providers = createLocalProviders(parseConfig(validEnvironment));

    await expect(
      providers.elevation.getElevations({
        points: [
          { latitude: 51.5, longitude: -0.1 },
          { latitude: 51.6, longitude: -0.2 },
        ],
      }),
    ).resolves.toEqual({ elevationsM: [null, null] });
    await providers.close();
  });

  it('uses unauthenticated non-TLS SMTP only for explicit Mailpit mode', async () => {
    const providers = createLocalProviders(
      parseConfig({
        ...validEnvironment,
        EMAIL_MODE: 'smtp',
        EMAIL_PROVIDER: 'mailpit',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        SMTP_FROM: 'test@example.test',
      }),
    );

    expect(mocks.createTransport).toHaveBeenCalledWith({
      connectionTimeout: 50,
      greetingTimeout: 50,
      host: 'localhost',
      port: 1025,
      requireTLS: false,
      secure: false,
      socketTimeout: 50,
    });
    await expect(providers.email.checkHealth()).resolves.toBe('up');
    await providers.email.send({
      subject: 'Local test',
      text: 'No credentials',
      to: 'recipient@example.test',
    });
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: 'test@example.test',
      subject: 'Local test',
      text: 'No credentials',
      to: 'recipient@example.test',
    });
    await providers.close();
  });
});
