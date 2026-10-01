import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import {
  CostModel,
  QueryContext,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type ContractState,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
} from '../contracts/managed/shadow-escrow/contract/index.js';

type PrivateState = { readonly approvalSecret: Uint8Array };
type Terms = {
  token: Uint8Array;
  amount: bigint;
  payee: { bytes: Uint8Array };
  refund: { bytes: Uint8Array };
  deadline: bigint;
};

const SECRET = new Uint8Array(32).fill(7);
const WRONG_SECRET = new Uint8Array(32).fill(9);
const DEFAULT_TERMS: Terms = {
  token: new Uint8Array(32).fill(3),
  amount: 25n,
  payee: { bytes: new Uint8Array(32).fill(4) },
  refund: { bytes: new Uint8Array(32).fill(5) },
  deadline: 1_000n,
};

const witnesses = {
  approvalSecret: ({ privateState }: { privateState: PrivateState }): [PrivateState, Uint8Array] => [
    privateState,
    privateState.approvalSecret,
  ],
};

function cloneTerms(overrides: Partial<Terms> = {}): Terms {
  return {
    token: overrides.token ?? DEFAULT_TERMS.token,
    amount: overrides.amount ?? DEFAULT_TERMS.amount,
    payee: overrides.payee ?? DEFAULT_TERMS.payee,
    refund: overrides.refund ?? DEFAULT_TERMS.refund,
    deadline: overrides.deadline ?? DEFAULT_TERMS.deadline,
  };
}

function construct(overrides: Partial<Terms> = {}, secret = SECRET) {
  const terms = cloneTerms(overrides);
  const contract = new Contract<PrivateState>(witnesses as any);
  const initial = contract.initialState(
    createConstructorContext({ approvalSecret: secret }, '0'.repeat(64)),
    terms.token,
    terms.amount,
    terms.payee,
    terms.refund,
    terms.deadline,
  );
  return { contract, initial, terms };
}

class Harness {
  readonly contract: Contract<PrivateState>;
  readonly terms: Terms;
  state: ContractState;
  balance = 0n;
  tokenType: any | undefined;

  constructor(overrides: Partial<Terms> = {}) {
    const { contract, initial, terms } = construct(overrides);
    this.contract = contract;
    this.state = initial.currentContractState;
    this.terms = terms;
  }

  get publicState(): Ledger {
    return ledger(this.state.data);
  }

  private context(time: bigint, secret = SECRET) {
    this.state.balance = this.tokenType === undefined || this.balance === 0n
      ? new Map()
      : new Map([[this.tokenType, this.balance]]);
    return createCircuitContext(
      sampleContractAddress(),
      '0'.repeat(64),
      this.state,
      { approvalSecret: secret },
      undefined,
      CostModel.initialCostModel(),
      Number(time),
    );
  }

  private apply(context: any): void {
    this.state.data = context.currentQueryContext.state;
  }

  fund(time: bigint) {
    const result = this.contract.impureCircuits.fund(this.context(time));
    const inputs = [...result.context.currentQueryContext.effects.unshieldedInputs.entries()];
    assert.equal(inputs.length, 1);
    this.tokenType = inputs[0]![0];
    assert.equal(inputs[0]![1], this.terms.amount);
    this.apply(result.context);
    this.balance += this.terms.amount;
    return result;
  }

  approve(time: bigint, secret = SECRET) {
    const result = this.contract.impureCircuits.approve(this.context(time, secret));
    this.apply(result.context);
    return result;
  }

  settle(time: bigint) {
    const result = this.contract.impureCircuits.settle(this.context(time));
    this.apply(result.context);
    this.balance -= this.terms.amount;
    return result;
  }

  refund(time: bigint) {
    const result = this.contract.impureCircuits.refund(this.context(time));
    this.apply(result.context);
    this.balance -= this.terms.amount;
    return result;
  }

  cancel(time: bigint) {
    const result = this.contract.impureCircuits.cancel(this.context(time));
    this.apply(result.context);
    return result;
  }
}

test('constructor records immutable public terms and version 2 without exposing the secret', () => {
  const { initial, terms } = construct();
  const state = ledger(initial.currentContractState.data);
  assert.deepEqual(state.tokenColor, terms.token);
  assert.equal(state.amount, terms.amount);
  assert.deepEqual(state.payee.bytes, terms.payee.bytes);
  assert.deepEqual(state.refundRecipient.bytes, terms.refund.bytes);
  assert.equal(state.deadline, terms.deadline);
  assert.equal(Number(state.status), 0);
  assert.equal(Number(state.approvalCount), 0);
  assert.equal(Number(state.version), 2);
  assert.equal('approvalSecret' in (state as Record<string, unknown>), false);
});

test('constructor rejects zero amount, zero/equal/malformed destinations, and integer overflow', () => {
  assert.throws(() => construct({ amount: 0n }), /Amount must be positive/);
  assert.throws(() => construct({ payee: { bytes: new Uint8Array(32) } }), /Payee required/);
  assert.throws(() => construct({ refund: { bytes: new Uint8Array(32) } }), /Refund recipient required/);
  assert.throws(() => construct({ refund: DEFAULT_TERMS.payee }), /Recipients must differ/);
  assert.throws(() => construct({ payee: { bytes: new Uint8Array(31) } }), /Bytes<32>|length|byte/i);
  assert.throws(() => construct({ amount: 1n << 128n }), /Uint<0\.\.|type error/i);
  assert.throws(() => construct({ deadline: 1n << 64n }), /Uint<0\.\.|type error/i);
});

test('funding is only Created-before-deadline and requires the exact configured native asset and amount', () => {
  const h = new Harness();
  const funded = h.fund(999n);
  assert.equal(Number(h.publicState.status), 1);
  assert.equal(h.balance, h.terms.amount);

  const [[tokenType, amount]] = [...funded.context.currentQueryContext.effects.unshieldedInputs.entries()];
  assert.equal(amount, h.terms.amount);
  assert.equal(tokenType.tag, 'unshielded');
  assert.equal(tokenType.raw, Buffer.from(h.terms.token).toString('hex'));
  assert.throws(() => h.fund(999n), /Escrow is not Created/);
});

test('funding is rejected at the exact deadline', () => {
  const h = new Harness();
  assert.throws(() => h.fund(h.terms.deadline), /Funding deadline reached/);
  assert.equal(Number(h.publicState.status), 0);
  assert.equal(h.balance, 0n);
});

test('approval requires funding, the correct private witness, and time strictly before deadline', () => {
  const unstarted = new Harness();
  assert.throws(() => unstarted.approve(900n), /Escrow is not Funded/);

  const wrong = new Harness();
  wrong.fund(900n);
  assert.throws(() => wrong.approve(950n, WRONG_SECRET), /Invalid approval secret/);
  assert.equal(Number(wrong.publicState.status), 1);

  const expired = new Harness();
  expired.fund(900n);
  assert.throws(() => expired.approve(expired.terms.deadline), /Approval deadline reached/);
  assert.equal(Number(expired.publicState.status), 1);
});

test('valid approval happens once and vests the payee even after the deadline', () => {
  const h = new Harness();
  h.fund(900n);
  h.approve(999n);
  assert.equal(Number(h.publicState.status), 2);
  assert.equal(Number(h.publicState.approvalCount), 1);
  assert.throws(() => h.approve(999n), /Escrow is not Funded/);

  const settled = h.settle(1_500n);
  assert.equal(Number(h.publicState.status), 3);
  assert.equal(h.balance, 0n);
  const spends = [...settled.context.currentQueryContext.effects.claimedUnshieldedSpends.entries()];
  assert.equal(spends.length, 1);
  assert.equal(spends[0]![0][1].tag, 'user');
  assert.equal(spends[0]![0][1].address, Buffer.from(h.terms.payee.bytes).toString('hex'));
  assert.equal(spends[0]![1], h.terms.amount);
});

test('settlement requires the full escrow balance and cannot be replayed', () => {
  const h = new Harness();
  h.fund(900n);
  h.approve(950n);
  h.balance = h.terms.amount - 1n;
  assert.throws(() => h.settle(1_200n), /Insufficient escrow balance/);
  assert.equal(Number(h.publicState.status), 2);

  h.balance = h.terms.amount;
  h.settle(1_200n);
  assert.throws(() => h.settle(1_201n), /Escrow is not Approved/);
  assert.throws(() => h.refund(1_201n), /Escrow is not Funded/);
});

test('refund is Funded-only, opens exactly at deadline, and pays only the fixed refund recipient', () => {
  const h = new Harness();
  h.fund(900n);
  assert.throws(() => h.refund(999n), /Refund not available yet/);
  assert.equal(Number(h.publicState.status), 1);

  const refunded = h.refund(h.terms.deadline);
  assert.equal(Number(h.publicState.status), 4);
  assert.equal(h.balance, 0n);
  const spends = [...refunded.context.currentQueryContext.effects.claimedUnshieldedSpends.entries()];
  assert.equal(spends.length, 1);
  assert.equal(spends[0]![0][1].tag, 'user');
  assert.equal(spends[0]![0][1].address, Buffer.from(h.terms.refund.bytes).toString('hex'));
  assert.equal(spends[0]![1], h.terms.amount);
  assert.throws(() => h.refund(h.terms.deadline + 1n), /Escrow is not Funded/);
  assert.throws(() => h.settle(h.terms.deadline + 1n), /Escrow is not Approved/);
});

test('refund rejects insufficient native balance without changing terminal state', () => {
  const h = new Harness();
  h.fund(900n);
  h.balance = h.terms.amount - 1n;
  assert.throws(() => h.refund(h.terms.deadline), /Insufficient escrow balance/);
  assert.equal(Number(h.publicState.status), 1);
});

test('unfunded escrow can cancel only at or after deadline and cancellation has no payout', () => {
  const h = new Harness();
  assert.throws(() => h.cancel(999n), /Cancellation not available yet/);
  const cancelled = h.cancel(h.terms.deadline);
  assert.equal(Number(h.publicState.status), 5);
  assert.equal(cancelled.context.currentQueryContext.effects.unshieldedOutputs.size, 0);
  assert.equal(cancelled.context.currentQueryContext.effects.claimedUnshieldedSpends.size, 0);
  assert.throws(() => h.cancel(h.terms.deadline + 1n), /Escrow is not Created/);
});

test('funded escrow cannot use the unfunded cancellation path', () => {
  const h = new Harness();
  h.fund(900n);
  assert.throws(() => h.cancel(h.terms.deadline), /Escrow is not Created/);
});

test('approval commitment circuit rejects a changed private credential after reconnect', () => {
  const h = new Harness();
  h.fund(900n);
  assert.throws(() => h.approve(950n, WRONG_SECRET), /Invalid approval secret/);
  h.approve(950n, SECRET);
  assert.equal(Number(h.publicState.status), 2);
});

test('generated commitment circuit authenticates reconnect credential without exposing it', () => {
  const { initial } = construct({}, SECRET);
  const publicState = ledger(initial.currentContractState.data);
  const correct = pureCircuits.commitment(SECRET);
  const wrong = pureCircuits.commitment(WRONG_SECRET);

  assert.deepEqual(correct, publicState.approvalCommitment);
  assert.notDeepEqual(wrong, publicState.approvalCommitment);
  assert.equal('approvalSecret' in (publicState as Record<string, unknown>), false);
});

test('a stale Created-state funding transcript is rejected against Funded state', () => {
  const { contract, initial } = construct();
  const address = sampleContractAddress();
  const createdContext = createCircuitContext(
    address,
    '0'.repeat(64),
    initial.currentContractState,
    { approvalSecret: SECRET },
    undefined,
    CostModel.initialCostModel(),
    900,
  );
  const funded = contract.impureCircuits.fund(createdContext);
  const replayContext = new QueryContext(
    funded.context.currentQueryContext.state,
    address,
  );
  replayContext.block = {
    ...replayContext.block,
    secondsSinceEpoch: 900n,
    lastBlockTime: 899n,
  };

  assert.throws(() =>
    replayContext.runTranscript(
      {
        gas: funded.gasCost,
        effects: funded.context.currentQueryContext.effects,
        program: funded.proofData.publicTranscript,
      },
      CostModel.initialCostModel(),
    ),
  );
});
