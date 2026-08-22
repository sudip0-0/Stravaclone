import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { createLocalProviders } from '../src/providers/local.js';
import { validEnvironment } from './fixtures.js';

const describeWithMailpit =
  process.env.TEST_MAILPIT === 'true' ? describe : describe.skip;

describeWithMailpit('Mailpit email adapter', () => {
  it('delivers through the configured SMTP provider into Mailpit', async () => {
    const apiUrl = process.env.TEST_MAILPIT_API_URL ?? 'http://127.0.0.1:8025';
    const before = await fetch(`${apiUrl}/api/v1/messages`);
    expect(before.ok).toBe(true);
    const beforeBody = (await before.json()) as { total: number };
    const providers = createLocalProviders(
      parseConfig({
        ...validEnvironment,
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ?? validEnvironment.DATABASE_URL,
        EMAIL_MODE: 'smtp',
        EMAIL_PROVIDER: 'mailpit',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_FROM: 'test@trail.local',
        READINESS_TIMEOUT_MS: '1000',
      }),
    );
    try {
      await providers.email.send({
        to: 'mailpit-worker-test@trail.local',
        subject: 'Trail outbox adapter test',
        text: 'Synthetic local-only adapter evidence.',
      });
      const after = await fetch(`${apiUrl}/api/v1/messages`);
      expect(after.ok).toBe(true);
      const afterBody = (await after.json()) as { total: number };
      expect(afterBody.total).toBeGreaterThan(beforeBody.total);
    } finally {
      await providers.close();
    }
  });
});
