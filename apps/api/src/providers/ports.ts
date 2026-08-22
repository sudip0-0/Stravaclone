import type { Readable } from 'node:stream';
import type { ElevationProvider } from '@trail/domain';
import type { Sql } from 'postgres';

export type {
  ElevationProvider,
  ElevationProviderRequest,
  ElevationProviderResult,
} from '@trail/domain';

export type DependencyStatus = 'up' | 'down' | 'disabled';

export interface HealthCheckable {
  checkHealth(): Promise<DependencyStatus>;
}

export interface DatabaseProvider extends HealthCheckable {
  readonly sql?: Sql;
}

export interface VerifiedIdentity {
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export interface IdentityVerifier {
  readonly enabled: boolean;
  verify(identityToken: string, nonce: string): Promise<VerifiedIdentity>;
}

export interface IdentityProviders {
  readonly apple: IdentityVerifier;
  readonly google: IdentityVerifier;
}

export interface ObjectHead {
  readonly sizeBytes: number;
  readonly contentType: string | null;
}

export interface PresignedPost {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ObjectStorageProvider extends HealthCheckable {
  readonly bucket: string;
  presignPost(
    key: string,
    contentType: string,
    minimumBytes: number,
    maximumBytes: number,
    expiresSeconds: number,
  ): Promise<PresignedPost>;
  presignGet(key: string, expiresSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  get(key: string): Promise<Readable>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
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
  readonly database: DatabaseProvider;
  readonly identity: IdentityProviders;
  readonly objectStorage: ObjectStorageProvider;
  readonly email: EmailProvider;
  readonly mapStyle: MapStyleProvider;
  readonly elevation: ElevationProvider;
  readonly routing: RoutingProvider;
  readonly telemetry: TelemetryProvider;
  close(): Promise<void>;
}
