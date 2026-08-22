import { buildApp } from './app.js';
import { drainEmailOutbox } from './auth/service.js';
import type { ApiConfig } from './config.js';
import { createLocalProviders } from './providers/local.js';
import type { TelemetryLifecycle } from './telemetry/bootstrap.js';

export async function startRuntime(
  config: ApiConfig,
  telemetry: TelemetryLifecycle,
): Promise<void> {
  const providers = createLocalProviders(config);
  const app = buildApp({ config, providers });
  let stopping = false;
  let drainingEmail = false;
  const emailOutboxTimer = setInterval(() => {
    if (drainingEmail || stopping) return;
    drainingEmail = true;
    void drainEmailOutbox(providers, config)
      .catch(() => {
        providers.telemetry.captureException({
          code: 'email_outbox_worker_failed',
          requestId: 'email-outbox',
        });
      })
      .finally(() => {
        drainingEmail = false;
      });
  }, 30_000).unref();

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(emailOutboxTimer);
    app.log.info({ signal }, 'Graceful shutdown started');
    const forceExit = setTimeout(() => process.exit(1), 10_000).unref();
    try {
      await app.close();
      await telemetry.shutdown();
      clearTimeout(forceExit);
      process.exitCode = 0;
    } catch {
      app.log.error({ code: 'shutdown_failed' }, 'Graceful shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch {
    app.log.fatal({ code: 'startup_failed' }, 'API startup failed');
    await app.close();
    await telemetry.shutdown();
    process.exitCode = 1;
  }
}
