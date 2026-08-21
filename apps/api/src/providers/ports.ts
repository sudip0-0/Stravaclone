export type DependencyStatus = 'up' | 'down' | 'disabled';

export interface HealthCheckable {
  checkHealth(): Promise<DependencyStatus>;
}

export interface ObjectStorageProvider extends HealthCheckable {
  readonly bucket: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailProvider extends HealthCheckable {
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<void>;
}

export interface MapStyleProvider {
  readonly styleUrl: string;
}

export interface ElevationPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationMetres?: number;
}

export interface ElevationProvider {
  enrich(points: readonly ElevationPoint[]): Promise<readonly ElevationPoint[]>;
}

export interface RoutingProvider {
  route(): Promise<never>;
}

export interface SafeErrorEvent {
  readonly code: string;
  readonly requestId: string;
}

export interface TelemetryProvider {
  captureException(event: SafeErrorEvent): void;
}

export interface Providers {
  readonly database: HealthCheckable;
  readonly objectStorage: ObjectStorageProvider;
  readonly email: EmailProvider;
  readonly mapStyle: MapStyleProvider;
  readonly elevation: ElevationProvider;
  readonly routing: RoutingProvider;
  readonly telemetry: TelemetryProvider;
  close(): Promise<void>;
}
