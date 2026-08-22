import { emailSchema } from '@trail/contracts';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type {
  IdentityProviders,
  IdentityVerifier,
  VerifiedIdentity,
} from './ports.js';

const appleIssuer = 'https://appleid.apple.com';
const appleJwksUrl = 'https://appleid.apple.com/auth/keys';
const googleIssuer = 'https://accounts.google.com';
const googleJwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';

interface VerifierConfig {
  readonly audience: string | undefined;
  readonly issuer: string;
  readonly jwksUrl: string;
}

function unavailableVerifier(): IdentityVerifier {
  return {
    enabled: false,
    async verify(): Promise<never> {
      throw new ApplicationError({
        code: 'provider_unavailable',
        statusCode: 503,
        publicMessage: 'Identity provider is unavailable',
      });
    },
  };
}

export function createConfiguredIdentityVerifier(
  config: VerifierConfig,
): IdentityVerifier {
  if (!config.audience) return unavailableVerifier();
  const audience = config.audience;
  const keys = createRemoteJWKSet(new URL(config.jwksUrl));
  return {
    enabled: true,
    async verify(identityToken, nonce): Promise<VerifiedIdentity> {
      try {
        const { payload } = await jwtVerify(identityToken, keys, {
          algorithms: ['RS256'],
          audience,
          issuer: config.issuer,
        });
        const audiences = Array.isArray(payload.aud)
          ? payload.aud
          : payload.aud
            ? [payload.aud]
            : [];
        if (
          !payload.sub ||
          payload.nonce !== nonce ||
          (audiences.length > 1 && payload.azp !== audience)
        ) {
          throw new Error('Required identity claim is invalid');
        }
        const parsedEmail =
          typeof payload.email === 'string'
            ? emailSchema.safeParse(payload.email)
            : undefined;
        const email = parsedEmail?.success ? parsedEmail.data : null;
        const emailVerified =
          email !== null &&
          (payload.email_verified === true ||
            payload.email_verified === 'true');
        return { subject: payload.sub, email, emailVerified };
      } catch {
        throw new ApplicationError({
          code: 'invalid_credentials',
          statusCode: 401,
          publicMessage: 'Authentication failed',
        });
      }
    },
  };
}

export function createIdentityProviders(config: ApiConfig): IdentityProviders {
  return {
    apple: createConfiguredIdentityVerifier({
      audience: config.APPLE_CLIENT_ID,
      issuer: appleIssuer,
      jwksUrl: appleJwksUrl,
    }),
    google: createConfiguredIdentityVerifier({
      audience: config.GOOGLE_CLIENT_ID,
      issuer: googleIssuer,
      jwksUrl: googleJwksUrl,
    }),
  };
}
