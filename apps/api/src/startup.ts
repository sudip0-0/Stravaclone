import type { ApiConfig } from './config.js';
import {
  startTelemetry,
  type TelemetryLifecycle,
} from './telemetry/bootstrap.js';

interface RuntimeModule {
  startRuntime(config: ApiConfig, telemetry: TelemetryLifecycle): Promise<void>;
}

interface BootstrapDependencies {
  readonly startTelemetry: (config: ApiConfig) => Promise<TelemetryLifecycle>;
  readonly loadRuntime: () => Promise<RuntimeModule>;
}

const defaultDependencies: BootstrapDependencies = {
  startTelemetry,
  loadRuntime: () => import('./runtime.js'),
};

export async function bootstrapApplication(
  config: ApiConfig,
  dependencies: BootstrapDependencies = defaultDependencies,
): Promise<void> {
  const telemetry = await dependencies.startTelemetry(config);
  const runtime = await dependencies.loadRuntime();
  await runtime.startRuntime(config, telemetry);
}
