import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(...parts: string[]): string {
  return readFileSync(path.resolve(process.cwd(), ...parts), 'utf8');
}

test('Midnight StateValue runtime is pinned to one 3.0.0 implementation', () => {
  const packageJson = JSON.parse(readProjectFile('package.json'));
  assert.equal(
    packageJson.overrides?.['@midnight-ntwrk/onchain-runtime-v3'],
    '3.0.0',
    'package.json must force the same onchain runtime version used by midnight-js-protocol',
  );

  const lockfile = readProjectFile('package-lock.json');
  assert.match(
    lockfile,
    /"node_modules\/@midnight-ntwrk\/onchain-runtime-v3"\s*:\s*\{\s*"version"\s*:\s*"3\.0\.0"/,
    'top-level onchain runtime must resolve to 3.0.0',
  );
  assert.doesNotMatch(
    lockfile,
    /node_modules\/@midnight-ntwrk\/midnight-js-protocol\/node_modules\/@midnight-ntwrk\/onchain-runtime-v3/,
    'nested onchain-runtime-v3 copy would create a second StateValue class identity',
  );
});
