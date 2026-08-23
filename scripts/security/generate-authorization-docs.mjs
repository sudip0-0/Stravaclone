#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sourcePath = `${root}/docs/security/authorization-matrix.json`;
const documentPath = `${root}/docs/security/authorization-matrix.md`;
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const start = '<!-- GENERATED AUTHORIZATION ROUTES: START -->';
const end = '<!-- GENERATED AUTHORIZATION ROUTES: END -->';
const rows = source.operations
  .map(
    (operation) =>
      `| \`${operation.id}\` | \`${operation.method}\` | \`${operation.path}\` | \`${operation.principal}\` |`,
  )
  .join('\n');
const generated = `${start}\n\n## Registered route index (generated)\n\nSource: \`docs/security/authorization-matrix.json\`. Regenerate with \`node scripts/security/generate-authorization-docs.mjs\`.\n\n| Operation | Method | Registered path | Principal |\n| --- | --- | --- | --- |\n${rows}\n\n${end}`;
const current = readFileSync(documentPath, 'utf8');
let expected;
if (current.includes(start) && current.includes(end)) {
  expected = current.replace(new RegExp(`${start}[\\s\\S]*?${end}`), generated);
} else {
  const firstParagraphEnd = current.indexOf(
    '\n\n',
    current.indexOf('\n\n') + 2,
  );
  expected = `${current.slice(0, firstParagraphEnd)}\n\n${generated}${current.slice(firstParagraphEnd)}`;
}

if (process.argv.includes('--check')) {
  const generatedBlock = current.slice(
    current.indexOf(start) + start.length,
    current.indexOf(end),
  );
  const documented = generatedBlock
    .split('\n')
    .filter((line) => /^\|\s*`/.test(line))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, ''));
      return {
        id: cells[0],
        method: cells[1],
        path: cells[2],
        principal: cells[3],
      };
    });
  if (JSON.stringify(documented) !== JSON.stringify(source.operations)) {
    console.error(
      'Authorization documentation is stale. Run node scripts/security/generate-authorization-docs.mjs and pnpm format',
    );
    process.exit(1);
  }
  console.log(
    `Authorization documentation matches ${source.operations.length} canonical operations.`,
  );
} else {
  writeFileSync(documentPath, expected);
  console.log(
    `Generated authorization route index for ${source.operations.length} operations.`,
  );
}
