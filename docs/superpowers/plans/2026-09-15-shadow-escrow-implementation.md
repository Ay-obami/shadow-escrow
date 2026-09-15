# ShadowEscrow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generated Midnight hello-world contract with a tested ShadowEscrow MVP that proves confidential milestone approval with a private witness, commits generated ZK artifacts, and deploys to Preview with submission evidence.

**Architecture:** The Compact contract stores a public commitment, an `approved` flag, and a one-shot approval count. A 32-byte approval secret lives only in Midnight private state and is supplied by a Compact witness. The constructor deliberately discloses only a persistent-hash commitment; `approve()` proves the private witness hashes to that public commitment and never discloses the secret. Existing wallet, DUST, faucet, network-selection, and proof-server plumbing remain intact.

**Tech Stack:** Compact language 0.23 / compiler 0.31.1, Midnight.js 4.1.1, `@midnight-ntwrk/compact-runtime` 0.16.0, wallet SDK 1.2.0, Node.js 22+, TypeScript 6, `tsx`, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-15-shadow-escrow-design.md`

## Global Constraints

- Keep Node.js `>=22.0.0`.
- Keep Compact compiler `0.31.1` and language version `0.23` compatibility.
- Keep Midnight.js packages at `4.1.1`, compact runtime at `0.16.0`, and wallet SDK at `1.2.0`.
- Never write the raw approval secret to public ledger state, logs intended for screenshots, or README content.
- Use `disclose()` only for the private-derived public commitment.
- Invalid approval secrets must fail; a second successful approval attempt must fail.
- Preserve existing wallet sync, DUST, faucet, network, and proof-server behavior unless a narrow ShadowEscrow adaptation requires a change.
- Do not add token custody, multi-milestone logic, disputes, identities, reputation, or frontend UI in this cycle.
- Final `contracts/managed/shadow-escrow/` output must be committed, including compiler output, bindings, prover/verifier keys, and ZKIR.
- Preview is the target public network; Preprod is only the fallback if Preview is unavailable.

---

## File Structure

**Create**
- `contracts/shadow-escrow.compact` — contract source.
- `src/witnesses.ts` — private-state type + witness implementation.
- `src/shadow-escrow.ts` — shared artifact/private-state configuration.
- `test/shadow-escrow.test.ts` — simulator behavior/privacy tests.
- `docs/screenshots/compile-success.png` — added after real compile.
- `docs/screenshots/preview-deployment.png` — added after real Preview deploy.

**Modify**
- `package.json`
- `src/deploy.ts`
- `src/cli.ts`
- `scripts/e2e-check.ts`
- `.gitignore`
- `README.md`

**Remove**
- `contracts/hello-world.compact`
- local `contracts/managed/hello-world/` before committing generated artifacts.

---

### Task 1: Replace Hello World with ShadowEscrow Compact

**Files:**
- Create: `contracts/shadow-escrow.compact`
- Remove: `contracts/hello-world.compact`
- Modify: `package.json`

**Interfaces:**
- Ledger: `approvalCommitment: Bytes<32>`, `approved: Boolean`, `approvalCount: Uint<8>`.
- Witness: `approvalSecret(): Bytes<32>`.
- Circuits: `approve(): []`, `commitment(secret: Bytes<32>): Bytes<32>`.

- [ ] **Step 1: Change the compile target**

Set:

```json
"compile": "compact compile contracts/shadow-escrow.compact contracts/managed/shadow-escrow"
```

- [ ] **Step 2: Add the contract**

Create `contracts/shadow-escrow.compact`:

```compact
pragma language_version 0.23;

import CompactStandardLibrary;

export ledger approvalCommitment: Bytes<32>;
export ledger approved: Boolean;
export ledger approvalCount: Uint<8>;

witness approvalSecret(): Bytes<32>;

constructor() {
  approvalCommitment = disclose(commitment(approvalSecret()));
  approved = false;
  approvalCount = 0;
}

export circuit approve(): [] {
  assert(!approved, "Milestone already approved");
  assert(
    approvalCommitment == commitment(approvalSecret()),
    "Invalid approval secret"
  );

  approved = true;
  approvalCount = 1;
}

export circuit commitment(secret: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([
    pad(32, "shadow-escrow:approval:v1"),
    secret
  ]);
}
```

- [ ] **Step 3: Remove the tutorial source**

```bash
rm contracts/hello-world.compact
```

- [ ] **Step 4: Compile and verify the Compact assumptions**

```bash
npm run compile
find contracts/managed/shadow-escrow -maxdepth 3 -type f | sort
```

Expected: compiler exits `0` and generates `compiler/`, `contract/`, `keys/`, and `zkir/`. If 0.31.1 rejects any syntax, adjust only to the equivalent supported 0.31.1 form before proceeding.

- [ ] **Step 5: Commit source only**

```bash
git add contracts/shadow-escrow.compact contracts/hello-world.compact package.json
git commit -m "feat: implement ShadowEscrow Compact contract"
```

Do not add generated managed output yet.

---

### Task 2: Add the real private witness and contract tests

**Files:**
- Create: `src/witnesses.ts`
- Create: `test/shadow-escrow.test.ts`
- Modify: `package.json`

**Interfaces:**
- `ShadowEscrowPrivateState = { readonly approvalSecret: Uint8Array }`
- `createShadowEscrowPrivateState(secret: Uint8Array): ShadowEscrowPrivateState`
- `witnesses.approvalSecret(...) => [privateState, approvalSecret]`

- [ ] **Step 1: Implement the witness**

Create `src/witnesses.ts`:

```ts
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { Ledger } from '../contracts/managed/shadow-escrow/contract/index.js';

export type ShadowEscrowPrivateState = {
  readonly approvalSecret: Uint8Array;
};

export const createShadowEscrowPrivateState = (
  approvalSecret: Uint8Array,
): ShadowEscrowPrivateState => ({ approvalSecret });

export const witnesses = {
  approvalSecret: ({
    privateState,
  }: WitnessContext<Ledger, ShadowEscrowPrivateState>): [
    ShadowEscrowPrivateState,
    Uint8Array,
  ] => [privateState, privateState.approvalSecret],
};
```

- [ ] **Step 2: Write simulator tests**

Create `test/shadow-escrow.test.ts` with a `ShadowEscrowSimulator` modeled on Midnight's generated-contract simulator pattern using `Contract<ShadowEscrowPrivateState>`, `createConstructorContext`, `QueryContext`, `sampleContractAddress`, and `CostModel.initialCostModel()`.

The suite must include these exact behaviors:

```ts
test('constructor stores only the public commitment', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  const state = sim.getLedger();

  assert.equal(state.approved, false);
  assert.equal(Number(state.approvalCount), 0);
  assert.equal(state.approvalCommitment.length, 32);
});

test('valid private witness approves exactly once', () => {
  const sim = new ShadowEscrowSimulator(new Uint8Array(32).fill(7));
  const state = sim.approve();
  assert.equal(state.approved, true);
  assert.equal(Number(state.approvalCount), 1);
});

test('wrong private witness is rejected', () => {
  const sim = new ShadowEscrowSimulator(new Uint8Array(32).fill(7));
  sim.switchSecret(new Uint8Array(32).fill(9));
  assert.throws(() => sim.approve(), /Invalid approval secret/);
});

test('approval cannot be replayed and raw secret is absent from public state', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  sim.approve();
  assert.throws(() => sim.approve(), /Milestone already approved/);

  const state = sim.getLedger() as Record<string, unknown>;
  assert.equal('approvalSecret' in state, false);
  const secretHex = Buffer.from(secret).toString('hex');
  const publicJson = JSON.stringify(state, (_key, value) =>
    value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value,
  );
  assert.equal(publicJson.includes(secretHex), false);
});
```

- [ ] **Step 3: Replace the placeholder npm test script**

Set:

```json
"test": "npm run compile && tsx --test test/shadow-escrow.test.ts"
```

- [ ] **Step 4: Run the test cycle**

```bash
npm test
```

Expected: four passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/witnesses.ts test/shadow-escrow.test.ts package.json
git commit -m "test: add ShadowEscrow witness and privacy tests"
```

---

### Task 3: Wire ShadowEscrow into deploy, CLI, and e2e

**Files:**
- Create: `src/shadow-escrow.ts`
- Modify: `src/deploy.ts`
- Modify: `src/cli.ts`
- Modify: `scripts/e2e-check.ts`

**Interfaces:**
- `PRIVATE_STATE_ID = 'shadowEscrowPrivateState'`
- `PRIVATE_STATE_STORE = 'shadow-escrow-state'`
- `deriveApprovalSecret(seedHex: string): Uint8Array`
- `createInitialPrivateState(seedHex: string): ShadowEscrowPrivateState`
- `zkConfigPath`
- `loadShadowEscrowContract()`

- [ ] **Step 1: Add shared contract/private-state configuration**

Create `src/shadow-escrow.ts`:

```ts
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {
  createShadowEscrowPrivateState,
  witnesses,
  type ShadowEscrowPrivateState,
} from './witnesses.js';

export const PRIVATE_STATE_ID = 'shadowEscrowPrivateState';
export const PRIVATE_STATE_STORE = 'shadow-escrow-state';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(
  __dirname,
  '..',
  'contracts',
  'managed',
  'shadow-escrow',
);

export function deriveApprovalSecret(seedHex: string): Uint8Array {
  return createHash('sha256')
    .update('shadow-escrow:approval-secret:v1\0', 'utf8')
    .update(Buffer.from(seedHex, 'hex'))
    .digest();
}

export function createInitialPrivateState(
  seedHex: string,
): ShadowEscrowPrivateState {
  return createShadowEscrowPrivateState(deriveApprovalSecret(seedHex));
}

export async function loadShadowEscrowContract() {
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) {
    throw new Error('Contract not compiled! Run: npm run compile');
  }

  const module = await import(pathToFileURL(contractPath).href);
  const compiledContract = CompiledContract.make(
    'shadow-escrow',
    module.Contract,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as any),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );

  return { module, compiledContract };
}
```

The Node SHA-256 derivation only derives the local private credential from the already-private wallet seed. It does not replace the Compact `persistentHash` commitment.

- [ ] **Step 2: Adapt `src/deploy.ts`**

Remove hello-world artifact loading and `withVacantWitnesses`. Import the shared ShadowEscrow helpers. Use `PRIVATE_STATE_STORE` in `levelPrivateStateProvider`, and deploy with:

```ts
const { compiledContract } = await loadShadowEscrowContract();

const deployed = await deployContract(providers, {
  compiledContract: compiledContract as any,
  args: [],
  privateStateId: PRIVATE_STATE_ID,
  initialPrivateState: createInitialPrivateState(SEED),
});
```

Keep all existing DUST/faucet/retry/recordDeployment logic.

- [ ] **Step 3: Adapt `src/cli.ts`**

Connect with the same shared compiled contract and `createInitialPrivateState(SEED)`. Replace the menu with:

```text
1. Approve milestone privately
2. Read public escrow state
3. Check wallet balance
4. Exit
```

Approval calls:

```ts
const tx = await deployed.callTx.approve();
```

State reading decodes `module.ledger(contractState.data)` and prints only commitment hex, `approved`, and `approvalCount`. Never print the raw approval secret.

- [ ] **Step 4: Adapt `scripts/e2e-check.ts`**

Use the shared compiled contract/private-state configuration. After `queryContractState`, decode the ledger and assert:

```ts
assert.equal(ledgerState.approvalCommitment.length, 32);
assert.equal(typeof ledgerState.approved, 'boolean');
assert.ok([0, 1].includes(Number(ledgerState.approvalCount)));
assert.equal('approvalSecret' in ledgerState, false);
```

Success output must include contract address, network, approved state, and approval count.

- [ ] **Step 5: Verify types, tests, local deploy, and e2e**

```bash
npm test
npx tsc --noEmit
npm run setup -- --network undeployed
npm run test:e2e
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shadow-escrow.ts src/deploy.ts src/cli.ts scripts/e2e-check.ts
git commit -m "feat: integrate ShadowEscrow deployment and CLI flow"
```

---

### Task 4: Document the product/privacy model and allow required artifacts

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Make managed artifacts trackable**

Remove:

```gitignore
contracts/managed/
```

Keep exactly one copy of each local-secret/runtime ignore:

```gitignore
.midnight-state.json
.midnight-wallet-state/
midnight-level-db/
```

- [ ] **Step 2: Rewrite README around ShadowEscrow**

Opening paragraph:

> ShadowEscrow is a privacy-preserving milestone approval prototype on Midnight. A client keeps an approval credential private, while the contract stores only a public commitment. When the client approves a milestone, a Compact witness supplies the credential privately and the zero-knowledge circuit proves it matches the public commitment; only the approval result becomes public. This New Moon MVP focuses on confidential authorization rather than token custody, with payments, multi-milestone agreements, disputes, and selective disclosure left for later cycles.

- [ ] **Step 3: Add Public State vs Private Witness**

Document:

```text
Public ledger
- approvalCommitment: Bytes<32>
- approved: Boolean
- approvalCount: Uint<8> (0 or 1)

Private local state / witness
- approvalSecret: Bytes<32>
```

Explain that `approvalSecret()` is implemented in TypeScript and read during proof generation; its raw value is not stored on-chain.

- [ ] **Step 4: Explain deliberate disclosure**

Show and explain:

```compact
approvalCommitment = disclose(commitment(approvalSecret()));
```

The commitment is intentionally public so later proofs have a public reference value. `approve()` compares against a private-derived commitment without disclosing the secret.

- [ ] **Step 5: Replace setup/test/deployment instructions**

Local commands:

```bash
npm install
npm run compile
npm test
npm run setup -- --network undeployed
npm run test:e2e
npm run cli
```

Preview commands:

```bash
npm run setup -- --network preview
npm run test:e2e
```

Explain first-run faucet funding and that the deployed address is printed by setup.

- [ ] **Step 6: Commit**

```bash
git add .gitignore README.md
git commit -m "docs: document ShadowEscrow privacy model and setup"
```

---

### Task 5: Generate and commit managed ZK artifacts + compile evidence

**Files:**
- Generate/commit: `contracts/managed/shadow-escrow/compiler/**`
- Generate/commit: `contracts/managed/shadow-escrow/contract/**`
- Generate/commit: `contracts/managed/shadow-escrow/keys/**`
- Generate/commit: `contracts/managed/shadow-escrow/zkir/**`
- Create: `docs/screenshots/compile-success.png`
- Modify: `README.md`

- [ ] **Step 1: Pull to the machine with Compact 0.31.1**

```bash
git pull
compact compile --version
```

Expected: `0.31.1`.

- [ ] **Step 2: Regenerate from a clean contract output directory**

```bash
rm -rf contracts/managed/hello-world contracts/managed/shadow-escrow
npm run compile
```

Capture the successful terminal output, with circuit names visible, to `docs/screenshots/compile-success.png`.

- [ ] **Step 3: Verify artifact families**

```bash
find contracts/managed/shadow-escrow -maxdepth 3 -type f | sort
```

Must include files under `compiler/`, `contract/`, `keys/`, and `zkir/`.

- [ ] **Step 4: Verify against the freshly generated bindings**

```bash
npm test
npx tsc --noEmit
npm run setup -- --network undeployed
npm run test:e2e
```

- [ ] **Step 5: Add compile evidence to README**

Add:

```markdown
## Submission Evidence

### Successful Compact compile

![Compact compile output](docs/screenshots/compile-success.png)
```

- [ ] **Step 6: Commit and push**

```bash
git add contracts/managed/shadow-escrow docs/screenshots/compile-success.png README.md
git commit -m "build: commit ShadowEscrow circuits and proving assets"
git push
```

This task runs on the user's machine because generated prover/verifier files are binary and cannot be safely created through the connected GitHub text API.

---

### Task 6: Deploy to Preview and record final evidence

**Files:**
- Create: `docs/screenshots/preview-deployment.png`
- Modify: `README.md`

- [ ] **Step 1: Deploy final source to Preview**

```bash
npm run setup -- --network preview
```

Fund the printed wallet from the printed Preview faucet if required. Wait for:

```text
✅ Contract deployed successfully!
Contract Address: <actual address printed by setup>
```

Do not include any mnemonic or raw approval credential in screenshots.

- [ ] **Step 2: Capture deployment evidence**

Save a screenshot showing `network: preview`, deployment success, and the actual contract address as:

```text
docs/screenshots/preview-deployment.png
```

- [ ] **Step 3: Verify Preview reconnect/read-back**

```bash
npm run test:e2e
```

Expected: same contract address, `network: preview`, and valid decoded ShadowEscrow state.

- [ ] **Step 4: Add the real deployment section to README**

Add exactly the address printed by setup:

```markdown
### Preview deployment

**Network:** Preview  
**Contract address:** `<actual address printed by setup>`

![Preview deployment output](docs/screenshots/preview-deployment.png)
```

- [ ] **Step 5: Final verification**

```bash
npm test
npm run test:e2e
git status
git log --oneline --decorate -10
```

Verify the working tree is clean after the final commit, at least five meaningful commits exist beyond the scaffold, managed assets are tracked, and local wallet/runtime state is not tracked.

- [ ] **Step 6: Commit and push final evidence**

```bash
git add README.md docs/screenshots/preview-deployment.png
git commit -m "docs: record Preview deployment evidence"
git push
```

---

## Final Acceptance Checklist

- [ ] `compact compile` succeeds with compiler 0.31.1.
- [ ] `npm test` is a real passing suite.
- [ ] Valid private witness approves.
- [ ] Invalid witness rejects.
- [ ] Replay approval rejects.
- [ ] Raw secret is absent from public ledger state.
- [ ] Local setup and e2e pass.
- [ ] `contracts/managed/shadow-escrow/{compiler,contract,keys,zkir}` is committed.
- [ ] Compile screenshot is committed and linked.
- [ ] Preview deployment succeeds with a visible public contract address.
- [ ] Preview e2e read-back succeeds.
- [ ] Preview screenshot is committed with no sensitive material visible.
- [ ] README explains public state, private witness, and the deliberate `disclose()`.
- [ ] README contains setup instructions and the initial product idea.
- [ ] Repository has at least five meaningful commits.