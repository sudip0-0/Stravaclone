import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const [keyPath, canonicalPath, expectedHex] = process.argv.slice(2);
if (!keyPath || !canonicalPath || process.argv.length > 5) {
  console.error(
    'Usage: node backup-manifest-hmac.mjs <key-file> <canonical-file> [expected-hex]',
  );
  process.exit(2);
}

const digest = createHmac('sha256', readFileSync(keyPath))
  .update(readFileSync(canonicalPath))
  .digest();
if (expectedHex === undefined) {
  process.stdout.write(`${digest.toString('hex')}\n`);
  process.exit(0);
}
if (!/^[0-9a-f]{64}$/.test(expectedHex)) process.exit(1);
const expected = Buffer.from(expectedHex, 'hex');
if (!timingSafeEqual(digest, expected)) process.exit(1);
