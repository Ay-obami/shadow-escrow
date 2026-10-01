import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(
  path.resolve(process.cwd(), 'contracts', 'shadow-escrow.compact'),
  'utf8',
);

test('contract declares the funded escrow public terms and version marker', () => {
  for (const field of ['tokenColor', 'amount', 'payee', 'refundRecipient', 'deadline', 'status', 'version']) {
    assert.match(source, new RegExp(`export\\s+ledger\\s+${field}\\b`), `missing ledger field ${field}`);
  }
  assert.match(source, /version\s*=\s*2\s*;/);
});

test('contract exposes the complete five-action funded lifecycle', () => {
  for (const circuit of ['fund', 'approve', 'settle', 'refund', 'cancel']) {
    assert.match(source, new RegExp(`export\\s+circuit\\s+${circuit}\\s*\\(`), `missing circuit ${circuit}`);
  }
});

test('private approval credential remains witness-only', () => {
  assert.match(source, /witness\s+approvalSecret\s*\(\s*\)\s*:\s*Bytes<32>/);
  assert.doesNotMatch(source, /export\s+ledger\s+approvalSecret\b/);
  assert.doesNotMatch(source, /disclose\s*\(\s*approvalSecret\s*\(\s*\)\s*\)/);
});

test('generated contract API exposes all funded lifecycle calls', async () => {
  const generated = await import('../contracts/managed/shadow-escrow/contract/index.js');
  const contract = new generated.Contract<any>({
    approvalSecret: ({ privateState }: any) => [privateState, privateState.approvalSecret],
  });
  for (const circuit of ['fund', 'approve', 'settle', 'refund', 'cancel']) {
    assert.equal(typeof (contract.impureCircuits as any)[circuit], 'function', `missing generated ${circuit}`);
  }
});
