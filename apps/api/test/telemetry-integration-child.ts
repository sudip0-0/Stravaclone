import { createServer } from 'node:http';
import { trace } from '@opentelemetry/api';
import { startTelemetry } from '../src/telemetry/bootstrap.js';
import { testConfig } from './fixtures.js';

const requests: Array<{
  method: string | undefined;
  url: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}> = [];
const collector = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    requests.push({
      method: request.method,
      url: request.url,
      contentType: request.headers['content-type'],
      body: Buffer.concat(chunks),
    });
    response.writeHead(200).end();
  });
});
await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
const collectorAddress = collector.address();
if (!collectorAddress || typeof collectorAddress === 'string')
  throw new Error('Missing collector TCP address');

// Do not inject a test exporter: this exercises the production OTLP HTTP
// exporter and its serialization of the detached ReadableSpan representation.
const telemetry = await startTelemetry({
  ...testConfig,
  OTEL_ENABLED: true,
  OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorAddress.port}`,
});

// Import the production Fastify app only after auto-instrumentation is active,
// then exercise a real listening server and the production trusted-route hook.
const [{ buildApp }, { createTestProviders }] = await Promise.all([
  import('../src/app.js'),
  import('../src/providers/test.js'),
]);
const app = buildApp({
  config: testConfig,
  providers: createTestProviders(),
  logger: false,
});
app.get('/private/:resourceId', async (_request, reply) => {
  trace.getActiveSpan()?.setAttributes({
    'db.statement': 'select * from private_table where token = request-secret',
    'cloud.provider': 'private-provider-value',
    'http.request.body': 'private-body-value',
    'http.route': '/private/instrumentation-route-secret',
    'url.path': '/private/instrumentation-path-secret',
  });
  return reply.code(204).send();
});
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string')
  throw new Error('Missing TCP address');

const privateId = '7d94c382-1d6b-4f1d-9f7a-3d7bc2b1a411';
const response = await fetch(
  `http://127.0.0.1:${address.port}/private/${privateId}?token=query-token&signed_url=query-signature`,
  {
    headers: {
      authorization: 'Bearer header-access-token',
      cookie: 'session=header-cookie-secret',
      'x-request-id': 'sensitive-request-id',
    },
  },
);
if (response.status !== 204)
  throw new Error(`Unexpected matched-route status ${response.status}`);

const unmatchedSecret = 'unmatched-path-secret-token';
const unmatchedResponse = await fetch(
  `http://127.0.0.1:${address.port}/missing/${unmatchedSecret}`,
);
if (unmatchedResponse.status !== 404) {
  throw new Error(
    `Unexpected unmatched-route status ${unmatchedResponse.status}`,
  );
}
await app.close();
await telemetry.shutdown();
await new Promise<void>((resolve, reject) =>
  collector.close((error) => (error ? reject(error) : resolve())),
);

console.log(
  `OTEL_REQUESTS=${JSON.stringify(
    requests.map((request) => ({
      method: request.method,
      url: request.url,
      contentType: request.contentType,
      bodyBase64: request.body.toString('base64'),
    })),
  )}`,
);
