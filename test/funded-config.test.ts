import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseFundedEscrowTerms,
  resolvePrivateStatePassword,
} from '../src/funded-config.js';

const VALID = {
  token: '03'.repeat(32),
  payee: '04'.repeat(32),
  refund: '05'.repeat(32),
};

function argv(...items: string[]): string[] {
  return ['node', 'deploy.ts', ...items];
}

test('funded terms parse from explicit CLI flags', () => {
  const terms = parseFundedEscrowTerms({
    argv: argv(
      '--token-color', VALID.token,
      '--amount', '25',
      '--payee', VALID.payee,
      '--refund-recipient', VALID.refund,
      '--deadline', '2000',
    ),
    env: {},
    nowSeconds: 1000n,
  });
  assert.equal(Buffer.from(terms.tokenColor).toString('hex'), VALID.token);
  assert.equal(terms.amount, 25n);
  assert.equal(Buffer.from(terms.payee.bytes).toString('hex'), VALID.payee);
  assert.equal(Buffer.from(terms.refundRecipient.bytes).toString('hex'), VALID.refund);
  assert.equal(terms.deadline, 2000n);
});

test('CLI funded terms override environment values', () => {
  const terms = parseFundedEscrowTerms({
    argv: argv('--amount=25'),
    env: {
      SHADOW_ESCROW_TOKEN_COLOR: VALID.token,
      SHADOW_ESCROW_AMOUNT: '99',
      SHADOW_ESCROW_PAYEE: VALID.payee,
      SHADOW_ESCROW_REFUND_RECIPIENT: VALID.refund,
      SHADOW_ESCROW_DEADLINE: '2000',
    },
    nowSeconds: 1000n,
  });
  assert.equal(terms.amount, 25n);
});

test('missing and malformed funded terms fail closed', () => {
  assert.throws(
    () => parseFundedEscrowTerms({ argv: argv(), env: {}, nowSeconds: 1000n }),
    /Missing funded escrow term/i,
  );
  assert.throws(
    () => parseFundedEscrowTerms({
      argv: argv('--token-color', 'aa', '--amount', '25', '--payee', VALID.payee, '--refund-recipient', VALID.refund, '--deadline', '2000'),
      env: {},
      nowSeconds: 1000n,
    }),
    /token color.*32 bytes/i,
  );
});

test('amount and deadline enforce Compact integer bounds and future deadline', () => {
  const base = ['--token-color', VALID.token, '--payee', VALID.payee, '--refund-recipient', VALID.refund];
  assert.throws(
    () => parseFundedEscrowTerms({ argv: argv(...base, '--amount', '0', '--deadline', '2000'), env: {}, nowSeconds: 1000n }),
    /amount.*positive/i,
  );
  assert.throws(
    () => parseFundedEscrowTerms({ argv: argv(...base, '--amount', String(1n << 128n), '--deadline', '2000'), env: {}, nowSeconds: 1000n }),
    /amount.*Uint128/i,
  );
  assert.throws(
    () => parseFundedEscrowTerms({ argv: argv(...base, '--amount', '25', '--deadline', '1000'), env: {}, nowSeconds: 1000n }),
    /deadline.*future/i,
  );
  assert.throws(
    () => parseFundedEscrowTerms({ argv: argv(...base, '--amount', '25', '--deadline', String(1n << 64n)), env: {}, nowSeconds: 1000n }),
    /deadline.*Uint64/i,
  );
});

test('destinations must be 32-byte, nonzero, and distinct', () => {
  const common = ['--token-color', VALID.token, '--amount', '25', '--deadline', '2000'];
  assert.throws(
    () => parseFundedEscrowTerms({ argv: argv(...common, '--payee', '00'.repeat(32), '--refund-recipient', VALID.refund), env: {}, nowSeconds: 1000n }),
    /payee.*nonzero/i,
  );
  assert.throws(
    () => parseFundedEscrowTerms({ argv: argv(...common, '--payee', VALID.payee, '--refund-recipient', VALID.payee), env: {}, nowSeconds: 1000n }),
    /destinations.*distinct/i,
  );
});

test('nonlocal private-state storage requires an explicit strong password', () => {
  assert.equal(
    resolvePrivateStatePassword('undeployed', {}),
    'Local-Devnet-Development-Placeholder-1',
  );
  assert.throws(
    () => resolvePrivateStatePassword('preview', {}),
    /PRIVATE_STATE_PASSWORD.*required/i,
  );
  assert.throws(
    () => resolvePrivateStatePassword('preprod', { PRIVATE_STATE_PASSWORD: 'too-short' }),
    /at least 16/i,
  );
  assert.equal(
    resolvePrivateStatePassword('preview', { PRIVATE_STATE_PASSWORD: 'correct-horse-battery' }),
    'correct-horse-battery',
  );
});
