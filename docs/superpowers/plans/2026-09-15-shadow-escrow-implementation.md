# ShadowEscrow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generated Midnight hello-world contract with a tested ShadowEscrow MVP that proves confidential milestone approval with a private witness, commits the generated ZK artifacts, and deploys to Preview with submission evidence.

**Architecture:** The Compact contract stores a public commitment, an `approved` flag, and a one-shot approval count. A 32-byte approval secret lives only in Midnight private state and is supplied through a Compact witness; the constructor deliberately discloses only a persistent hash commitment, and the approval circuit proves the witness secret matches that commitment without disclosing the secret. The existing wallet/network/proof-server scaffold stays intact while deployment, CLI, and e2e code are narrowly adapted to the new compiled contract and private state.

**Tech Stack:** Compact language 0.23 / compiler 0.31.1, Midnight.js 4.1.1, `@midnight-ntwrk/compact-runtime` 0.16.0, wallet SDK 1.2.0, Node.js 22+, TypeScript 6, `tsx`, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-15-shadow-escrow-design.md`

## Global Constraints

- Node.js must remain `>=22.0.0`.
- Compact compiler target is `0.31.1`; contract syntax must stay compatible with language version `0.23`.
- Midnight.js packages remain pinned at `4.1.1`, `@midnight-ntwrk/compact-runtime` remains `0.16.0`, and `@midnight-ntwrk/wallet-sdk` remains `1.2.0`.
- The raw approval secret must never be written to public ledger state or README output.
- `disclose()` must only mark the private-derived approval commitment public; the approval proof itself must not disclose the secret.
- Approval is one-shot: invalid secrets fail and a second approval attempt fails.
- Preserve existing wallet sync, DUST, faucet, network-selection, and proof-server diagnostics unless a narrow ShadowEscrow adaptation requires a change.
- No real token custody, multi-milestone logic, dispute system, identity management, reputation system, or frontend is added in this cycle.
- Final `contracts/managed/shadow-escrow/` output, including prover/verifier keys and ZKIR, must be committed even though generated files are normally ignored.
- Preview is the target public network; Preprod is only the fallback if Preview is unavailable.

---

## File Structure

### Create

- `contracts/shadow-escrow.compact` — Compact source for the commitment + private-witness approval primitive.
- `src/witnesses.ts` — ShadowEscrow private-state type and Compact witness implementation.
- `src/shadow-escrow.ts` — shared contract constants, deterministic local approval-secret derivation, compiled-contract loader, and private-state constructor used by deploy/CLI/e2e.
- `test/shadow-escrow.test.ts` — simulator-level contract behavior and privacy tests.
- `docs/screenshots/` — final compile/deployment evidence files added after local/Preview runs.

### Modify

- `package.json` — compile ShadowEscrow and make `npm test` run the real tests.
- `src/deploy.ts` — load ShadowEscrow artifacts/witnesses and deploy with the private approval state.
- `src/cli.ts` — replace message storage with state inspection and private approval.
- `scripts/e2e-check.ts` — reconnect to ShadowEscrow and validate its public ledger shape.
- `.gitignore` — stop ignoring `contracts/managed/` so required generated artifacts can be committed.
- `README.md` — product idea, privacy model, deliberate disclosure, local/test/Preview instructions, address and evidence.

### Remove

- `contracts/hello-world.compact` — replaced by the actual submission contract.
- Any locally generated `contracts/managed/hello-world/` directory before the final artifact commit.

---

### Task 1: Replace Hello World with the ShadowEscrow Compact contract

**Files:**
- Create: `contracts/shadow-escrow.compact`
- Remove: `contracts/hello-world.compact`
- Modify: `package.json`

**Interfaces:**
- Produces ledger fields: `approvalCommitment: Bytes<32>`, `approved: Boolean`, `approvalCount: Uint<8>`.
- Produces witness declaration: `approvalSecret(): Bytes<32>`.
- Produces circuits: `approve(): []` and `commitment(secret: Bytes<32>): Bytes<32>`.
- Later tasks depend on generated bindings under `contracts/managed/shadow-escrow/contract/index.js`.

- [ ] **Step 1: Point the compile script at the new contract**

Change the package script to:

```json
"compile": "compact compile contracts/shadow-escrow.compact contracts/managed/shadow-escrow"
```

Do not change dependency versions.

- [ ] **Step 2: Add the Compact contract**

Create `contracts/shadow-escrow.compact` with the following implementation:

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

This follows the Compact 0.31.x pattern used by official examples: witnesses return private `Bytes<32>` values, `persistentHash` domain-separates commitments, and constructor code may deliberately `disclose()` a public key/commitment derived from a witness.

- [ ] **Step 3: Remove the tutorial source**

Delete only the source file:

```bash
rm contracts/hello-world.compact
```

Do not commit local `contracts/managed/hello-world/` output.

- [ ] **Step 4: Compile to verify the language/API assumptions**

Run:

```bash
npm run compile
```

Expected result: exit code `0`, generated `contracts/managed/shadow-escrow/`, and compiler output listing at least the `approve` circuit. If the compiler rejects `Boolean`, `persistentHash`, `pad`, witness use in the constructor, or `Uint<8>` assignment, stop and adapt only to the syntax supported by Compact 0.31.1 before continuing.

- [ ] **Step 5: Inspect generated artifacts**

Run:

```bash
find contracts/managed/shadow-escrow -maxdepth 3 -type f | sort
```

Expected groups: `compiler/`, `contract/`, `keys/`, and `zkir/`.

- [ ] **Step 6: Commit the source change**

```bash
git add contracts/shadow-escrow.compact contracts/hello-world.compact package.json
git commit -m "feat: implement ShadowEscrow Compact contract"
```

Do not add `contracts/managed/` in this commit; generated artifacts get their own later commit.

---

### Task 2: Add private-state witnesses and simulator tests

**Files:**
- Create: `src/witnesses.ts`
- Create: `test/shadow-escrow.test.ts`
- Modify: `package.json`

**Interfaces:**
- `ShadowEscrowPrivateState = { readonly approvalSecret: Uint8Array }`
- `createShadowEscrowPrivateState(secret: Uint8Array): ShadowEscrowPrivateState`
- `witnesses.approvalSecret(context): [ShadowEscrowPrivateState, Uint8Array]`
- Tests consume generated `Contract`, `Ledger`, and `ledger()` from `contracts/managed/shadow-escrow/contract/index.js`.

- [ ] **Step 1: Add the private-state/witness implementation**

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

- [ ] **Step 2: Write tests before wiring application integration**

Create `test/shadow-escrow.test.ts` using `node:test` and `node:assert/strict`. Build a simulator context with `Contract<ShadowEscrowPrivateState>`, `createConstructorContext`, `QueryContext`, `sampleContractAddress`, and `CostModel.initialCostModel()` in the same shape as Midnight's official simulator examples.

The test file must include these four cases:

```ts
test('constructor stores only the public commitment', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  const state = sim.getLedger();

  assert.equal(state.approved, false);
  assert.equal(Number(state.approvalCount), 0);
  assert.equal(state.approvalCommitment.length, 32);
});

test('valid private witness approves the milestone exactly once', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);

  const state = sim.approve();
  assert.equal(state.approved, true);
  assert.equal(Number(state.approvalCount), 1);
});

test('wrong private witness is rejected', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  sim.switchSecret(new Uint8Array(32).fill(9));

  assert.throws(() => sim.approve(), /Invalid approval secret/);
});

test('approval cannot be replayed and raw secret is absent from public ledger', () => {
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

The `ShadowEscrowSimulator` in the same test file must initialize the generated contract with the real witnesses and expose `getLedger()`, `switchSecret(secret)`, and `approve()`.

- [ ] **Step 3: Make `npm test` run a real suite**

Set:

```json
"test": "npm run compile && tsx --test test/shadow-escrow.test.ts"
```

- [ ] **Step 4: Run the test suite and confirm failures are real contract failures**

Run:

```bash
npm test
```

Expected result after implementation: four passing tests. If generated numeric fields are emitted as `bigint`, keep `Number(state.approvalCount)` in assertions rather than changing the contract type.

- [ ] **Step 5: Commit witnesses and tests**

```bash
git add src/witnesses.ts test/shadow-escrow.test.ts package.json
git commit -m "test: add ShadowEscrow witness and privacy tests"
```

---

### Task 3: Share ShadowEscrow contract/private-state configuration across deploy, CLI, and e2e

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
- `zkConfigPath: string`
- `loadShadowEscrowContract(): Promise<{ module; compiledContract }>`

- [ ] **Step 1: Add one shared configuration module**

Create `src/shadow-escrow.ts` so deploy, CLI, and e2e cannot silently drift onto different artifact paths or private-state IDs:

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

The SHA-256 derivation does **not** replace the Compact commitment. It only deterministically derives a local 32-byte private approval credential from the already-private wallet seed so deploy and reconnect paths recover the same witness state without adding another secret file. The public commitment is still computed inside Compact with `persistentHash`.

- [ ] **Step 2: Adapt deployment without changing wallet/network behavior**

In `src/deploy.ts`:

- remove the hello-world artifact loader and `withVacantWitnesses` setup;
- import `PRIVATE_STATE_ID`, `PRIVATE_STATE_STORE`, `createInitialPrivateState`, `loadShadowEscrowContract`, and `zkConfigPath` from `./shadow-escrow.js`;
- use `PRIVATE_STATE_STORE` in `levelPrivateStateProvider`;
- load `{ compiledContract }` before deployment;
- keep constructor `args: []`;
- replace `initialPrivateState: {}` with `initialPrivateState: createInitialPrivateState(SEED)`.

The deployment call must end up equivalent to:

```ts
const { compiledContract } = await loadShadowEscrowContract();

const deployed = await deployContract(providers, {
  compiledContract: compiledContract as any,
  args: [],
  privateStateId: PRIVATE_STATE_ID,
  initialPrivateState: createInitialPrivateState(SEED),
});
```

Preserve the existing DUST retry loop and `recordDeployment(...)` flow.

- [ ] **Step 3: Replace the hello-world CLI actions**

In `src/cli.ts`:

- load the ShadowEscrow compiled contract from the shared module;
- connect with `initialPrivateState: createInitialPrivateState(SEED)`;
- replace `Store a message` with `Approve milestone privately`;
- replace `Read current message` with `Read public escrow state`;
- keep wallet-balance and exit options.

Approval action:

```ts
const tx = await deployed.callTx.approve();
console.log('\n  ✅ Milestone approved with a private witness');
console.log(`  Transaction ID: ${tx.public.txId}`);
console.log(`  Block height: ${tx.public.blockHeight}\n`);
```

Public-state read action must use the generated module's `ledger(contractState.data)` and print:

```text
approvalCommitment: <hex>
approved: true|false
approvalCount: 0|1
```

Never print `deriveApprovalSecret(SEED)` or the raw private state.

- [ ] **Step 4: Strengthen e2e to validate ShadowEscrow state**

In `scripts/e2e-check.ts`:

- use the shared artifact path, compiled contract, witness setup, private-state ID/store, and initial private state;
- after `queryContractState`, decode with `module.ledger(onChainState.data)`;
- assert `approvalCommitment` is 32 bytes;
- assert `approved` is a boolean;
- assert `approvalCount` is `0` or `1`;
- assert the decoded ledger object has no `approvalSecret` property.

Success output must include:

```text
✅ e2e-check passed
   contractAddress: <address>
   network:         <network>
   approved:        <true|false>
   approvalCount:   <0|1>
```

- [ ] **Step 5: Run static/unit/local integration checks**

Run in order:

```bash
npm test
npm run build
npm run setup -- --network undeployed
npm run test:e2e
```

Expected: tests pass, TypeScript completes without a new ShadowEscrow error, local deployment returns an address, and e2e reads the new ledger.

- [ ] **Step 6: Commit integration**

```bash
git add src/shadow-escrow.ts src/deploy.ts src/cli.ts scripts/e2e-check.ts
git commit -m "feat: integrate ShadowEscrow deployment and CLI flow"
```

---

### Task 4: Make the repository submission-ready and document the privacy model

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- README becomes the submission entry point.
- `contracts/managed/shadow-escrow/` becomes intentionally trackable.

- [ ] **Step 1: Allow generated contract artifacts to be committed**

Remove this ignore entry from `.gitignore`:

```gitignore
contracts/managed/
```

Keep all wallet/runtime secret paths ignored:

```gitignore
.midnight-state.json
.midnight-wallet-state/
midnight-level-db/
```

Also remove the duplicated `.midnight-state.json` and `.midnight-wallet-state/` lines while preserving one copy of each.

- [ ] **Step 2: Rewrite the README opening around the actual product**

The first product paragraph must say, in substance:

> ShadowEscrow is a privacy-preserving milestone approval prototype on Midnight. A client keeps an approval credential private, while the contract stores only a public commitment. When the client approves a milestone, a Compact witness supplies the credential privately and the zero-knowledge circuit proves it matches the public commitment; only the approval result becomes public. This New Moon MVP focuses on confidential authorization rather than token custody, with payments, multi-milestone agreements, disputes, and selective disclosure left for later cycles.

- [ ] **Step 3: Add an explicit Public State vs Private Witness section**

Document exactly:

```text
Public ledger:
- approvalCommitment (Bytes<32>)
- approved (Boolean)
- approvalCount (Uint<8>, constrained to 0 or 1)

Private local state / witness:
- approvalSecret (Bytes<32>)
```

Explain that `approvalSecret()` is implemented in TypeScript and read by Compact during proof generation; its raw value is not written to the public ledger.

- [ ] **Step 4: Explain deliberate disclosure precisely**

README must identify the constructor line:

```compact
approvalCommitment = disclose(commitment(approvalSecret()));
```

Explain that the hash commitment is intentionally public so later proofs have a public value to match, while `approve()` compares the private-derived commitment without disclosing the secret.

- [ ] **Step 5: Replace hello-world setup text and add validation commands**

README local flow:

```bash
npm install
npm run compile
npm test
npm run setup -- --network undeployed
npm run test:e2e
npm run cli
```

Preview flow:

```bash
npm run setup -- --network preview
npm run test:e2e
```

Document that the first Preview setup prints a wallet address and faucet URL, waits for tNIGHT, generates DUST, deploys, and records the contract address locally.

- [ ] **Step 6: Add evidence section with fixed filenames**

Add:

```markdown
## Submission Evidence

### Successful Compact compile

![Compact compile output](docs/screenshots/compile-success.png)

### Preview deployment

**Network:** Preview  
**Contract address:** `PENDING_PREVIEW_DEPLOYMENT`

![Preview deployment output](docs/screenshots/preview-deployment.png)
```

`PENDING_PREVIEW_DEPLOYMENT` is allowed only until Task 6. It must not remain in the final submitted README.

- [ ] **Step 7: Commit documentation/configuration**

```bash
git add .gitignore README.md
git commit -m "docs: document ShadowEscrow privacy model and setup"
```

---

### Task 5: Generate, verify, and commit the required managed ZK artifacts

**Files:**
- Generate/commit: `contracts/managed/shadow-escrow/compiler/**`
- Generate/commit: `contracts/managed/shadow-escrow/contract/**`
- Generate/commit: `contracts/managed/shadow-escrow/keys/**`
- Generate/commit: `contracts/managed/shadow-escrow/zkir/**`

**Interfaces:**
- These files are consumed by `NodeZkConfigProvider`, `CompiledContract.withCompiledFileAssets`, deploy, CLI, tests, and the challenge reviewer.

- [ ] **Step 1: Pull source changes onto the machine with Compact 0.31.1**

```bash
git pull
compact compile --version
```

Expected compiler version:

```text
0.31.1
```

- [ ] **Step 2: Remove obsolete local hello-world output and regenerate**

```bash
rm -rf contracts/managed/hello-world contracts/managed/shadow-escrow
npm run compile
```

Capture the terminal after the successful compile, with the generated circuit names visible, as:

```text
docs/screenshots/compile-success.png
```

- [ ] **Step 3: Verify the exact artifact families required by the challenge**

```bash
find contracts/managed/shadow-escrow -maxdepth 3 -type f | sort
```

The result must include files under all four directories:

```text
compiler/
contract/
keys/
zkir/
```

- [ ] **Step 4: Re-run tests against the just-generated bindings**

```bash
npm test
npm run setup -- --network undeployed
npm run test:e2e
```

Expected: all unit tests pass, local deployment succeeds, and e2e prints the ShadowEscrow public state.

- [ ] **Step 5: Commit generated artifacts and compile screenshot**

```bash
git add contracts/managed/shadow-escrow docs/screenshots/compile-success.png
git commit -m "build: commit ShadowEscrow circuits and proving assets"
git push
```

This step must run on the user's machine because `.prover`/`.verifier` outputs are generated binary artifacts and the connected GitHub text-file API cannot safely synthesize them.

---

### Task 6: Deploy to Preview and record final evidence

**Files:**
- Create: `docs/screenshots/preview-deployment.png`
- Modify: `README.md`

**Interfaces:**
- Produces the public Preview contract address required by the challenge submission.

- [ ] **Step 1: Deploy the final committed source to Preview**

Run:

```bash
npm run setup -- --network preview
```

On first run, use the printed Preview faucet URL to fund the printed wallet address. Let setup continue until it prints:

```text
✅ Contract deployed successfully!
Contract Address: <hex address>
```

Do not expose the wallet recovery phrase or `.midnight-state.json` in screenshots.

- [ ] **Step 2: Capture deployment evidence**

Save a screenshot showing all of the following together where possible:

```text
network: preview
Contract deployed successfully
Contract Address: <address>
```

Save it as:

```text
docs/screenshots/preview-deployment.png
```

Crop out any mnemonic/recovery phrase and raw private credentials.

- [ ] **Step 3: Verify reconnect/read-back on Preview**

```bash
npm run test:e2e
```

Expected output includes the same contract address, `network: preview`, and decoded ShadowEscrow public state.

- [ ] **Step 4: Replace the README placeholder with the real address**

Change:

```markdown
**Contract address:** `PENDING_PREVIEW_DEPLOYMENT`
```

into:

```markdown
**Contract address:** `<actual Preview address>`
```

Do not paste wallet addresses, mnemonics, or the approval secret into the README.

- [ ] **Step 5: Final repository verification**

Run:

```bash
npm test
npm run test:e2e
git status
git log --oneline --decorate -10
```

Verify:

- real test suite passes;
- Preview e2e check passes;
- working tree is clean after evidence commit;
- at least five meaningful commits exist beyond the generated scaffold commit;
- `README.md` has no `PENDING_PREVIEW_DEPLOYMENT`;
- `contracts/managed/shadow-escrow/` is tracked;
- `.midnight-state.json`, `.midnight-wallet-state/`, and `midnight-level-db/` are not tracked.

- [ ] **Step 6: Commit final public deployment evidence**

```bash
git add README.md docs/screenshots/preview-deployment.png
git commit -m "docs: record Preview deployment evidence"
git push
```

---

## Final Acceptance Checklist

- [ ] `compact compile` succeeds with compiler `0.31.1`.
- [ ] `npm test` is a real passing test suite, not the scaffold placeholder.
- [ ] Valid witness secret approves.
- [ ] Invalid witness secret rejects.
- [ ] Replay approval rejects.
- [ ] Raw secret is absent from public ledger state.
- [ ] `npm run setup -- --network undeployed` succeeds.
- [ ] `npm run test:e2e` succeeds locally.
- [ ] `contracts/managed/shadow-escrow/{compiler,contract,keys,zkir}` is committed.
- [ ] Compile screenshot is committed.
- [ ] Preview deployment succeeds and returns a visible public contract address.
- [ ] Preview e2e read-back succeeds.
- [ ] Preview deployment screenshot is committed with no mnemonic/private secret visible.
- [ ] README explains public state, private witness, and the single deliberate `disclose()` use.
- [ ] README contains the initial product idea and setup instructions.
- [ ] Repository has at least five meaningful commits.