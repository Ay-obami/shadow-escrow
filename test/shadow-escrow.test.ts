import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const contractPath = path.resolve(process.cwd(), 'contracts', 'shadow-escrow.compact');

function readContractSource(): string {
  assert.equal(
    existsSync(contractPath),
    true,
    'contracts/shadow-escrow.compact must exist',
  );
  return readFileSync(contractPath, 'utf8');
}

test('approval secret is declared as a private witness, never public ledger state', () => {
  const source = readContractSource();

  assert.match(source, /witness\s+approvalSecret\s*\(\s*\)\s*:\s*Bytes<32>/);
  assert.doesNotMatch(source, /export\s+ledger\s+approvalSecret\b/);
});

test('constructor deliberately discloses only the secret commitment', () => {
  const source = readContractSource();

  assert.match(
    source,
    /approvalCommitment\s*=\s*disclose\s*\(\s*commitment\s*\(\s*approvalSecret\s*\(\s*\)\s*\)\s*\)/,
  );
  assert.doesNotMatch(source, /disclose\s*\(\s*approvalSecret\s*\(\s*\)\s*\)/);
});

test('approval flow requires the private witness and rejects replay', () => {
  const source = readContractSource();

  assert.match(source, /assert\s*\(\s*!approved\s*,\s*"Milestone already approved"\s*\)/);
  assert.match(
    source,
    /approvalCommitment\s*==\s*commitment\s*\(\s*approvalSecret\s*\(\s*\)\s*\)/,
  );
  assert.match(source, /approved\s*=\s*true/);
  assert.match(source, /approvalCount\s*=\s*1/);
});
