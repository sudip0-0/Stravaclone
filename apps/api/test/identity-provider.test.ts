import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConfiguredIdentityVerifier,
  createIdentityProviders,
} from '../src/providers/identity.js';
import { testConfig } from './fixtures.js';

describe('JOSE identity providers', () => {
  let server: Server;
  let privateKey: CryptoKey;
  let jwksUrl: string;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const publicKey = await exportJWK(keys.publicKey);
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          keys: [{ ...publicKey, alg: 'RS256', kid: 'test-key', use: 'sig' }],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('JWKS test server failed');
    jwksUrl = `http://127.0.0.1:${address.port}/jwks`;
  });

  afterAll(
    async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );

  async function token(
    overrides: {
      audience?: string | string[];
      authorizedParty?: string;
      nonce?: string;
      expiry?: string;
    } = {},
  ) {
    return new SignJWT({
      email: 'Relay@privaterelay.appleid.com',
      email_verified: true,
      nonce: overrides.nonce ?? 'nonce',
      ...(overrides.authorizedParty ? { azp: overrides.authorizedParty } : {}),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://issuer.example.test')
      .setAudience(overrides.audience ?? 'client-id')
      .setSubject('provider-subject')
      .setIssuedAt()
      .setExpirationTime(overrides.expiry ?? '5m')
      .sign(privateKey);
  }

  it('disables absent provider configuration and strictly verifies configured claims and nonce', async () => {
    expect(createIdentityProviders(testConfig).apple.enabled).toBe(false);
    const verifier = createConfiguredIdentityVerifier({
      audience: 'client-id',
      issuer: 'https://issuer.example.test',
      jwksUrl,
    });
    const verified = await verifier.verify(await token(), 'nonce');
    expect(verified).toEqual({
      subject: 'provider-subject',
      email: 'relay@privaterelay.appleid.com',
      emailVerified: true,
    });
    await expect(
      verifier.verify(await token({ audience: 'wrong' }), 'nonce'),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      verifier.verify(await token(), 'wrong-nonce'),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      verifier.verify(await token({ expiry: '0s' }), 'nonce'),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      verifier.verify(
        await token({ audience: ['client-id', 'other-client'] }),
        'nonce',
      ),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      verifier.verify(
        await token({
          audience: ['client-id', 'other-client'],
          authorizedParty: 'client-id',
        }),
        'nonce',
      ),
    ).resolves.toMatchObject({ subject: 'provider-subject' });
  });
});
