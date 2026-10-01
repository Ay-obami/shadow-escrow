import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CostModel,
  QueryContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type Ledger,
} from '../contracts/managed/shadow-escrow/contract/index.js';

const contractPath = path.resolve(process.cwd(), 'contracts', 'shadow-escrow.compact');

type TestPrivateState = {
  readonly approvalSecret: Uint8Array;
};

const testWitnesses = {
  approvalSecret: ({ privateState }: { privateState: TestPrivateState }): [TestPrivateState, Uint8Array] => [
    privateState,
    privateState.approvalSecret,
  ],
};

class ShadowEscrowSimulator {
  readonly contract: Contract<TestPrivateState>;
  circuitContext: CircuitContext<TestPrivateState>;

  constructor(secret: Uint8Array) {
    this.contract = new Contract<TestPrivateState>(testWitnesses as any);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext(
        { approvalSecret: secret },
        '0'.repeat(64),
      ),
      new Uint8Array(32).fill(3),
      25n,
      { bytes: new Uint8Array(32).fill(4) },
      { bytes: new Uint8Array(32).fill(5) },
      1_000n,
    );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  switchSecret(secret: Uint8Array): void {
    this.circuitContext.currentPrivateState = { approvalSecret: secret };
  }

  fund(): Ledger {
    this.circuitContext = this.contract.impureCircuits.fund(this.circuitContext).context;
    return this.getLedger();
  }

  approve(): Ledger {
    this.circuitContext = this.contract.impureCircuits.approve(this.circuitContext).context;
    return this.getLedger();
  }
}

function readProjectFile(...parts: string[]): string {
  const file = path.resolve(process.cwd(), ...parts);
  assert.equal(existsSync(file), true, `${parts.join('/')} must exist`);
  return readFileSync(file, 'utf8');
}

function readContractSource(): string {
  return readProjectFile('contracts', 'shadow-escrow.compact');
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

test('constructor stores public commitment but not the raw secret', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  const state = sim.getLedger();

  assert.equal(Number(state.status), 0);
  assert.equal(Number(state.version), 2);
  assert.equal(Number(state.approvalCount), 0);
  assert.equal(state.approvalCommitment.length, 32);

  const secretHex = Buffer.from(secret).toString('hex');
  const publicJson = JSON.stringify(state, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
    return value;
  });
  assert.equal(publicJson.includes(secretHex), false);
  assert.equal('approvalSecret' in (state as Record<string, unknown>), false);
});

test('valid private witness approves the milestone exactly once', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  sim.fund();

  const state = sim.approve();
  assert.equal(Number(state.status), 2);
  assert.equal(Number(state.approvalCount), 1);
});

test('wrong private witness is rejected', () => {
  const sim = new ShadowEscrowSimulator(new Uint8Array(32).fill(7));
  sim.fund();
  sim.switchSecret(new Uint8Array(32).fill(9));

  assert.throws(() => sim.approve(), /Invalid approval secret/);
});

test('approval cannot be replayed', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  sim.fund();
  sim.approve();

  assert.throws(() => sim.approve(), /Escrow is not Funded/);
});

test('production witness module exposes the private-state factory and witness', async () => {
  let witnessModule: any;
  try {
    witnessModule = await import('../src/witnesses.js');
  } catch {
    witnessModule = undefined;
  }

  assert.equal(
    typeof witnessModule?.createShadowEscrowPrivateState,
    'function',
    'createShadowEscrowPrivateState must be implemented',
  );
  assert.equal(
    typeof witnessModule?.witnesses?.approvalSecret,
    'function',
    'approvalSecret witness must be implemented',
  );
});

test('shared ShadowEscrow config derives stable private state from the wallet seed', async () => {
  let shadowEscrow: any;
  try {
    shadowEscrow = await import('../src/shadow-escrow.js');
  } catch {
    shadowEscrow = undefined;
  }

  assert.equal(typeof shadowEscrow?.deriveApprovalSecret, 'function');
  assert.equal(typeof shadowEscrow?.createInitialPrivateState, 'function');
  assert.equal(typeof shadowEscrow?.loadShadowEscrowContract, 'function');
  assert.equal(shadowEscrow?.PRIVATE_STATE_ID, 'shadowEscrowPrivateState');
  assert.equal(shadowEscrow?.PRIVATE_STATE_STORE, 'shadow-escrow-state');

  const seedA = '11'.repeat(64);
  const seedB = '22'.repeat(64);
  const secretA1 = shadowEscrow.deriveApprovalSecret(seedA);
  const secretA2 = shadowEscrow.deriveApprovalSecret(seedA);
  const secretB = shadowEscrow.deriveApprovalSecret(seedB);

  assert.equal(secretA1.length, 32);
  assert.deepEqual(secretA1, secretA2);
  assert.notDeepEqual(secretA1, secretB);
  assert.deepEqual(
    shadowEscrow.createInitialPrivateState(seedA).approvalSecret,
    secretA1,
  );
});

test('deploy script supplies immutable v2 terms and signs native balancing recipes', () => {
  const source = readProjectFile('src', 'deploy.ts');

  assert.match(source, /parseFundedEscrowTerms\s*\(/);
  assert.match(source, /resolvePrivateStatePassword\s*\(/);
  assert.match(source, /createInitialPrivateState\s*\(\s*SEED\s*\)/);
  assert.match(source, /signRecipe\s*\(/);
  assert.match(source, /unshieldedKeystore\.signData/);
  assert.match(source, /tokenKindsToBalance:\s*['"]all['"]/);
  for (const term of ['terms.tokenColor', 'terms.amount', 'terms.payee', 'terms.refundRecipient', 'terms.deadline']) {
    assert.match(source, new RegExp(term.replace('.', '\\.') ));
  }
  assert.doesNotMatch(source, /args:\s*\[\s*\]/);
  assert.doesNotMatch(source, /withVacantWitnesses|initialPrivateState\s*:\s*\{\s*\}/);
});

test('CLI exposes all v2 actions, verifies credential/version, and confirms indexed state', () => {
  const source = readProjectFile('src', 'cli.ts');

  for (const action of ['fund', 'approve', 'settle', 'refund', 'cancel']) {
    assert.match(source, new RegExp(`callTx\\.${action}\\s*\\(`));
  }
  assert.match(source, /pureCircuits\.commitment/);
  assert.match(source, /publicLedger\.version/);
  assert.match(source, /waitForStatus\s*\(/);
  assert.match(source, /signRecipe\s*\(/);
  assert.match(source, /refund goes only to/);
  assert.match(source, /createInitialPrivateState\s*\(\s*SEED\s*\)/);
  assert.doesNotMatch(source, /hello-world|HelloWorld|helloWorldPrivateState/);
});

test('e2e reconnects with ShadowEscrow private state and validates public ledger', () => {
  const source = readProjectFile('scripts', 'e2e-check.ts');

  assert.match(source, /from ['"]\.\.\/src\/shadow-escrow\.js['"]/);
  assert.match(source, /createInitialPrivateState\s*\(\s*SEED\s*\)/);
  assert.match(source, /approvalCommitment/);
  assert.match(source, /approvalCount/);
  assert.match(source, /publicLedger\.version/);
  assert.match(source, /publicLedger\.status/);
  assert.match(source, /publicLedger\.amount/);
  assert.match(source, /publicLedger\.deadline/);
  assert.doesNotMatch(source, /HelloWorld|hello-world|helloWorldPrivateState|withVacantWitnesses/);
});
