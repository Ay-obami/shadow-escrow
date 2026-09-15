# ShadowEscrow Level 2 DApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Level 1 ShadowEscrow prototype into a reusable React/Vite DApp where a user connects Lace on Midnight Preprod, creates one browser-local private approval credential, registers only its public commitment, and proves approval from the frontend without revealing the credential.

**Architecture:** Keep one shared Compact deployment on Preprod. Each browser/Lace account stores a random 32-byte approval secret in Midnight private state scoped by the connected Lace unshielded address; the contract uses a domain-separated commitment to that secret as the cryptographic user key, rather than `ownPublicKey()`. The React frontend discovers a DApp Connector API 4.x wallet, delegates proving to Lace with `dappConnectorProofProvider`, joins the deployed contract, and renders only public commitment/approval state plus privacy-safe transaction progress.

**Tech Stack:** Compact language 0.23 / compiler 0.31.1, Midnight.js 4.1.1, DApp Connector API 4.0.1, wallet-delegated proving, React 19, Vite 7, TypeScript, Vitest + jsdom, Node 22, Vercel, Midnight Preprod.

**Spec:** `docs/superpowers/specs/2026-09-15-shadow-escrow-level-2-design.md`

## Global Constraints

- Keep `pragma language_version 0.23` and compile with Compact compiler `0.31.1`.
- Keep the Midnight.js package family pinned to `4.1.1`, DApp Connector API to `4.0.1`, and the existing `@midnight-ntwrk/onchain-runtime-v3` override at `3.0.0` unless a verified SDK compatibility issue requires an explicit migration.
- Node.js must remain `>=22.0.0`.
- Preprod is the canonical Level 2 network.
- Never use `ownPublicKey()` as caller authentication. It is prover-supplied and is not cryptographically bound to the wallet signer.
- The DApp-specific identity is `commitment(approvalSecret)`. A caller can mutate a milestone only by proving knowledge of its secret preimage.
- The raw `approvalSecret` must never be public ledger state, rendered in React, printed to console, sent to Lace as application data, committed to Git, or placed in Vercel environment variables.
- The connected Lace unshielded address is used only to scope browser private-state storage. It is not the Compact authorization primitive.
- One browser-private milestone is supported per connected Lace account; multiple milestones, token custody, payment release, and disputes stay out of Level 2 scope.
- DApp “disconnect” means clearing the application’s `ConnectedAPI`, provider, account, contract, and UI session state. The current connector API does not expose a wallet-level disconnect RPC.
- Use wallet-delegated proving through `@midnight-ntwrk/midnight-js-dapp-connector-proof-provider`; do not depend on the deprecated connector `proverServerUri` for the browser flow.
- Preserve the existing Node CLI/deployment flow so it can still deploy and verify the contract independently of the browser.
- Add at least 8 new meaningful Level 2 commits. Do not split commits artificially.
- A submission is not complete until the live DApp has been exercised with real Lace against the deployed Preprod contract and a browser-originated circuit call has succeeded.

---

## File Map

### Existing files to modify

- `contracts/shadow-escrow.compact` — replace the single global milestone with commitment-keyed registration and approval sets.
- `contracts/managed/shadow-escrow/**` — regenerated Compact JS, proving keys, verifier keys, and ZKIR for `register` and `approve`.
- `test/shadow-escrow.test.ts` — simulator/privacy tests for reusable commitment-based milestones plus source-level integration guards.
- `src/witnesses.ts` — keep the approval-secret witness type reusable by Node and browser clients.
- `src/shadow-escrow.ts` — keep Node-only contract loading/seed derivation; update types and helpers for the new circuit/ledger shape.
- `src/deploy.ts` — deploy a vacant shared registry rather than consuming the deployer’s approval secret in the constructor.
- `src/cli.ts` — register then approve the CLI wallet’s private milestone and display commitment-scoped status.
- `scripts/e2e-check.ts` — verify the new ledger and optionally the CLI wallet’s commitment state on the selected network.
- `package.json` / `package-lock.json` — add browser connector/proof-provider/React/Vite/Vitest dependencies and scripts.
- `.gitignore` — ignore browser-local build/test artifacts without ignoring committed managed ZK assets or public Preprod config.
- `README.md` — replace Level 1 submission framing with Level 2 Lace/Preprod/live-demo/privacy documentation at the final task.

### New browser files

- `frontend/index.html` — Vite HTML entry.
- `frontend/tsconfig.json` — browser TypeScript configuration.
- `frontend/vite.config.ts` — React, WASM, top-level-await, test, and build configuration with `frontend/` as Vite root.
- `frontend/src/vite-env.d.ts` — Vite env types plus `window.midnight` declaration.
- `frontend/src/main.tsx` — React bootstrap.
- `frontend/src/App.tsx` — compose wallet, milestone, and privacy panels.
- `frontend/src/styles.css` — responsive single-page presentation.
- `frontend/src/components/WalletPanel.tsx` — connect/disconnect UI only.
- `frontend/src/components/MilestoneCard.tsx` — registration/approval/public-state UI only.
- `frontend/src/components/PrivacyProof.tsx` — plain-language public/private privacy claim.
- `frontend/src/hooks/useShadowEscrow.ts` — application state machine and orchestration.
- `frontend/src/midnight/types.ts` — browser-facing `WalletSession`, public milestone state, and provider/client interfaces.
- `frontend/src/midnight/connector.ts` — discover compatible Lace wallet and create/clear application sessions.
- `frontend/src/midnight/privateState.ts` — account-scoped browser private-state provider and random secret creation.
- `frontend/src/midnight/providers.ts` — Midnight provider assembly, Lace transaction bridge, and wallet-delegated proving.
- `frontend/src/midnight/contract.ts` — compile/join wrapper, commitment projection, reads, `register()`, and `approve()`.
- `frontend/src/**/*.test.ts(x)` — focused Vitest tests next to the module being exercised.
- `frontend/.env.preprod` — created only after a real deployment; contains public network/address configuration.
- `scripts/sync-browser-zk-assets.mjs` — copy managed `keys/` and `zkir/` into Vite `public/` before dev/build.
- `vercel.json` — root-level Vercel build/output configuration.

---

### Task 1: Make the Compact Contract Reusable Per Private Commitment

**Files:**
- Modify: `contracts/shadow-escrow.compact`
- Modify: `test/shadow-escrow.test.ts`
- Regenerate: `contracts/managed/shadow-escrow/**`

**Interfaces:**
- Consumes: `approvalSecret(): Bytes<32>` witness.
- Produces: provable circuits `register(): []`, `approve(): []`; pure circuit `commitment(Bytes<32>): Bytes<32>`; public ledgers `registeredCommitments`, `approvedCommitments`, `registrationCount`, `approvalCount`.

- [ ] **Step 1: Replace the old single-user simulator tests with failing reusable-registry tests**

Keep the existing source/privacy assertions, but change the simulator to initialize an empty constructor and add `register()`. The core tests must be equivalent to:

```ts
class ShadowEscrowSimulator {
  readonly contract: Contract<TestPrivateState>;
  circuitContext: CircuitContext<TestPrivateState>;

  constructor(secret: Uint8Array) {
    this.contract = new Contract<TestPrivateState>(testWitnesses as any);
    const initial = this.contract.initialState(
      createConstructorContext({ approvalSecret: secret }, '0'.repeat(64)),
    );
    this.circuitContext = {
      currentPrivateState: initial.currentPrivateState,
      currentZswapLocalState: initial.currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        initial.currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  switchSecret(secret: Uint8Array): void {
    this.circuitContext.currentPrivateState = { approvalSecret: secret };
  }

  register(): Ledger {
    this.circuitContext = this.contract.impureCircuits.register(this.circuitContext).context;
    return this.getLedger();
  }

  approve(): Ledger {
    this.circuitContext = this.contract.impureCircuits.approve(this.circuitContext).context;
    return this.getLedger();
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}

test('constructor starts as an empty reusable registry', () => {
  const state = new ShadowEscrowSimulator(new Uint8Array(32).fill(7)).getLedger();
  assert.equal(Number(state.registrationCount), 0);
  assert.equal(Number(state.approvalCount), 0);
});

test('a private credential registers only its public commitment', () => {
  const secret = new Uint8Array(32).fill(7);
  const sim = new ShadowEscrowSimulator(secret);
  const key = sim.contract.circuits.commitment(sim.circuitContext, secret).result;
  const state = sim.register();
  assert.equal(state.registeredCommitments.member(key), true);
  assert.equal(state.approvedCommitments.member(key), false);
  assert.equal(Number(state.registrationCount), 1);
  assert.equal(JSON.stringify(state).includes(Buffer.from(secret).toString('hex')), false);
});

test('the same private credential cannot register twice', () => {
  const sim = new ShadowEscrowSimulator(new Uint8Array(32).fill(7));
  sim.register();
  assert.throws(() => sim.register(), /Milestone already registered/);
});

test('an unregistered private credential cannot approve', () => {
  const sim = new ShadowEscrowSimulator(new Uint8Array(32).fill(7));
  assert.throws(() => sim.approve(), /Milestone not registered/);
});

test('registered credentials approve exactly once and remain isolated', () => {
  const secretA = new Uint8Array(32).fill(7);
  const secretB = new Uint8Array(32).fill(9);
  const sim = new ShadowEscrowSimulator(secretA);
  sim.register();
  sim.switchSecret(secretB);
  sim.register();
  sim.switchSecret(secretA);
  sim.approve();
  assert.throws(() => sim.approve(), /Milestone already approved/);
  sim.switchSecret(secretB);
  const state = sim.approve();
  assert.equal(Number(state.registrationCount), 2);
  assert.equal(Number(state.approvalCount), 2);
});
```

Also replace the old constructor-disclosure assertion with source assertions that `register`/`approve` only disclose the commitment and that `approvalSecret()` itself is never disclosed.

- [ ] **Step 2: Run the contract tests and verify they fail before implementation**

Run:

```bash
npm test -- --test-name-pattern='registry|credential|registered|approve'
```

Expected: failures because `register`, `registeredCommitments`, and `registrationCount` do not yet exist and the generated contract still reflects Level 1.

- [ ] **Step 3: Implement the minimal commitment registry contract**

Replace `contracts/shadow-escrow.compact` with:

```compact
pragma language_version 0.23;

import CompactStandardLibrary;

export ledger registeredCommitments: Set<Bytes<32>>;
export ledger approvedCommitments: Set<Bytes<32>>;
export ledger registrationCount: Counter;
export ledger approvalCount: Counter;

witness approvalSecret(): Bytes<32>;

constructor() {}

export circuit register(): [] {
  const key = commitment(approvalSecret());
  const publicKey = disclose(key);
  assert(!registeredCommitments.member(publicKey), "Milestone already registered");
  registeredCommitments.insert(publicKey);
  registrationCount.increment(1);
}

export circuit approve(): [] {
  const key = commitment(approvalSecret());
  const publicKey = disclose(key);
  assert(registeredCommitments.member(publicKey), "Milestone not registered");
  assert(!approvedCommitments.member(publicKey), "Milestone already approved");
  approvedCommitments.insert(publicKey);
  approvalCount.increment(1);
}

export circuit commitment(secret: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([
    pad(32, "shadow-escrow:approval:v2"),
    secret
  ]);
}
```

If compiler 0.31.1 reports a concrete ADT/counter syntax mismatch, use the compiler’s exact diagnostic plus `CompactStandardLibrary` definitions to make only the syntactic correction; do not change the registry semantics or introduce `ownPublicKey()`.

- [ ] **Step 4: Regenerate managed assets and run the simulator suite**

Run:

```bash
npm run compile
npm test
```

Expected compile output includes both provable circuits `register` and `approve`. Expected tests: all updated contract/privacy tests pass.

- [ ] **Step 5: Commit the independently working contract change**

```bash
git add contracts/shadow-escrow.compact contracts/managed/shadow-escrow test/shadow-escrow.test.ts
git commit -m "feat: make ShadowEscrow reusable per private commitment"
```

---

### Task 2: Update the Node Deployment, CLI, and E2E Flow

**Files:**
- Modify: `src/shadow-escrow.ts`
- Modify: `src/deploy.ts`
- Modify: `src/cli.ts`
- Modify: `scripts/e2e-check.ts`
- Modify: `test/shadow-escrow.test.ts`

**Interfaces:**
- Consumes: Task 1 generated `register`, `approve`, `pureCircuits.commitment`, registry ledgers.
- Produces: a vacant shared deployment; CLI flow `register → approve`; network E2E that validates registry counters and queryable contract state.

- [ ] **Step 1: Write failing source/integration tests for the new Node flow**

Replace old assertions that expect constructor-bound private state with:

```ts
test('deploy script deploys a reusable empty registry', () => {
  const source = readProjectFile('src', 'deploy.ts');
  assert.match(source, /loadShadowEscrowContract\s*\(/);
  assert.doesNotMatch(source, /approvalCommitment|createInitialPrivateState\s*\(\s*SEED\s*\)/);
});

test('CLI can register and approve its private commitment', () => {
  const source = readProjectFile('src', 'cli.ts');
  assert.match(source, /callTx\.register\s*\(/);
  assert.match(source, /callTx\.approve\s*\(/);
  assert.match(source, /registeredCommitments/);
  assert.match(source, /approvedCommitments/);
  assert.match(source, /registrationCount/);
  assert.match(source, /approvalCount/);
});

test('e2e validates reusable registry state', () => {
  const source = readProjectFile('scripts', 'e2e-check.ts');
  assert.match(source, /registeredCommitments/);
  assert.match(source, /approvedCommitments/);
  assert.match(source, /registrationCount/);
  assert.match(source, /approvalCount/);
});
```

- [ ] **Step 2: Run the affected tests and verify they fail**

```bash
npm test -- --test-name-pattern='deploy script|CLI can|e2e validates'
```

Expected: FAIL because the Node scripts still assume the Level 1 ledger/constructor flow.

- [ ] **Step 3: Keep Node private-state creation but remove it from constructor identity**

Keep `deriveApprovalSecret(seedHex)` and `createInitialPrivateState(seedHex)` for CLI/e2e convenience. Update `loadShadowEscrowContract()` only as needed for the regenerated circuit type; do not add browser imports to this Node-only module.

Deploy with the same `CompiledContract.withWitnesses(witnesses)` configuration, but treat the constructor as empty. The deployment call should keep a valid private-state object for SDK plumbing while no longer publishing a commitment during construction.

- [ ] **Step 4: Update CLI state projection and actions**

Use generated `pureCircuits.commitment(privateState.approvalSecret)` to derive the wallet’s public key locally, then render:

```ts
const commitment = module.pureCircuits.commitment(initialPrivateState.approvalSecret);
const state = module.ledger(onChainState.data);
const registered = state.registeredCommitments.member(commitment);
const approved = state.approvedCommitments.member(commitment);

console.log(`Registered: ${registered}`);
console.log(`Approved:   ${approved}`);
console.log(`Global registrations: ${state.registrationCount}`);
console.log(`Global approvals:     ${state.approvalCount}`);
console.log('Private approval secret: not disclosed');
```

Expose menu actions for `register` and `approve`; guard user-facing errors so replay/registration failures are shown without ever stringifying private state.

- [ ] **Step 5: Update the E2E smoke check and run the whole Node suite**

Run:

```bash
npm test
npm run compile
npm run test:e2e
```

Expected: all tests pass; local/selected-network E2E can reconnect to the existing selected deployment if it matches the new bytecode, otherwise redeploy locally before rerunning.

- [ ] **Step 6: Commit the Node client migration**

```bash
git add src/shadow-escrow.ts src/deploy.ts src/cli.ts scripts/e2e-check.ts test/shadow-escrow.test.ts
git commit -m "feat: update ShadowEscrow clients for reusable milestones"
```

---

### Task 3: Add the React/Vite Browser Scaffold and ZK Asset Pipeline

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `frontend/index.html`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`
- Create: `frontend/src/App.test.tsx`
- Create: `scripts/sync-browser-zk-assets.mjs`

**Interfaces:**
- Produces: `npm run frontend:dev`, `npm run frontend:build`, `npm run test:frontend`, `npm run sync:zk`.
- ZK assets become available under browser paths `/keys/*` and `/zkir/*`.

- [ ] **Step 1: Add the frontend dependencies and scripts**

Add these exact package families, keeping Midnight versions aligned with the Node client:

```json
{
  "dependencies": {
    "@midnight-ntwrk/dapp-connector-api": "4.0.1",
    "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-fetch-zk-config-provider": "4.1.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "semver": "^7.7.4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/semver": "^7.7.1",
    "@vitejs/plugin-react": "^5.1.4",
    "jsdom": "^26.0.0",
    "vite": "^7.3.1",
    "vite-plugin-top-level-await": "^1.6.0",
    "vite-plugin-wasm": "^3.5.0",
    "vitest": "^3.0.0"
  }
}
```

Add scripts:

```json
{
  "sync:zk": "node scripts/sync-browser-zk-assets.mjs",
  "frontend:dev": "npm run sync:zk && vite --config frontend/vite.config.ts",
  "frontend:build": "npm run sync:zk && vite build --config frontend/vite.config.ts --mode preprod",
  "test:frontend": "vitest run --config frontend/vite.config.ts",
  "verify": "npm test && npm run test:frontend && npm run compile && npm run frontend:build"
}
```

Run `npm install` so `package-lock.json` records the exact resolved versions.

- [ ] **Step 2: Write the failing App smoke test before creating the UI**

Create `frontend/src/App.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('ShadowEscrow Level 2 shell', () => {
  it('explains the private approval demo before wallet connection', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /ShadowEscrow/i })).toBeInTheDocument();
    expect(screen.getByText(/approval credential stays private/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the frontend test and verify it fails**

```bash
npm run test:frontend
```

Expected: FAIL because the Vite config and `App.tsx` do not exist yet.

- [ ] **Step 4: Create the Vite config and minimal app shell**

`frontend/vite.config.ts` must set `root` to the frontend directory, add React/WASM/top-level-await plugins, and configure jsdom tests:

```ts
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      '@contract': fileURLToPath(new URL('../contracts/managed/shadow-escrow/contract/index.js', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

Create a minimal `App.tsx` containing the required heading/privacy sentence and a standard `main.tsx` React bootstrap.

- [ ] **Step 5: Implement deterministic ZK asset copying**

Create `scripts/sync-browser-zk-assets.mjs` that removes stale `frontend/public/keys` and `frontend/public/zkir`, recreates them, then copies the current contents of `contracts/managed/shadow-escrow/keys` and `contracts/managed/shadow-escrow/zkir` with Node `fs.cpSync(..., { recursive: true })`.

The script must exit non-zero with a clear message if managed assets are missing, directing the developer to run `npm run compile`.

- [ ] **Step 6: Verify tests and a production build**

```bash
npm run test:frontend
npm run frontend:build
```

Expected: App test PASS and `frontend/dist/` is produced with both app assets and copied ZK assets.

- [ ] **Step 7: Commit the browser scaffold**

```bash
git add package.json package-lock.json .gitignore frontend scripts/sync-browser-zk-assets.mjs
git commit -m "feat: add React Vite ShadowEscrow frontend"
```

---

### Task 4: Implement Lace Discovery, Connect, and Application Disconnect

**Files:**
- Create: `frontend/src/midnight/types.ts`
- Create: `frontend/src/midnight/connector.ts`
- Create: `frontend/src/midnight/connector.test.ts`
- Modify: `frontend/src/vite-env.d.ts`

**Interfaces:**
- Produces:
  - `type WalletSession`
  - `discoverCompatibleWallets(): InitialAPI[]`
  - `connectWallet(initialApi: InitialAPI): Promise<WalletSession>`
  - `disconnectWallet(): null`

`WalletSession` must expose only public/session values:

```ts
export type WalletSession = {
  initialApi: InitialAPI;
  connectedApi: ConnectedAPI;
  unshieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
  configuration: Awaited<ReturnType<ConnectedAPI['getConfiguration']>>;
};
```

- [ ] **Step 1: Write failing connector tests**

Mock `window.midnight` with one incompatible and one compatible wallet and test enumeration rather than a hard-coded extension key:

```ts
it('discovers API 4.x wallets regardless of window.midnight key', () => {
  Object.defineProperty(window, 'midnight', {
    configurable: true,
    value: {
      random_uuid_a: { apiVersion: '3.9.0' },
      random_uuid_b: { apiVersion: '4.0.1', connect: vi.fn() },
    },
  });
  expect(discoverCompatibleWallets()).toHaveLength(1);
});

it('connects to Preprod and returns public account/session data', async () => {
  const connectedApi = {
    getUnshieldedAddress: vi.fn().mockResolvedValue({ unshieldedAddress: 'mn_addr_preprod_test' }),
    getShieldedAddresses: vi.fn().mockResolvedValue({
      shieldedCoinPublicKey: 'coin-key',
      shieldedEncryptionPublicKey: 'enc-key',
    }),
    getConfiguration: vi.fn().mockResolvedValue({
      indexerUri: 'https://indexer.preprod.midnight.network/api/v4/graphql',
      indexerWsUri: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    }),
  };
  const initialApi = { apiVersion: '4.0.1', connect: vi.fn().mockResolvedValue(connectedApi) } as any;
  const session = await connectWallet(initialApi);
  expect(initialApi.connect).toHaveBeenCalledWith('preprod');
  expect(session.unshieldedAddress).toBe('mn_addr_preprod_test');
});
```

- [ ] **Step 2: Run the connector tests and verify failure**

```bash
npm run test:frontend -- connector.test.ts
```

Expected: FAIL because `connector.ts` does not exist.

- [ ] **Step 3: Implement API-4.x discovery and connection**

Use `semver.satisfies(wallet.apiVersion, '4.x')`. `connectWallet()` must call `initialApi.connect('preprod')`, then fetch `getUnshieldedAddress()`, `getShieldedAddresses()`, and `getConfiguration()` in parallel where safe. Throw human-readable errors for no compatible wallet, rejected authorization, or missing account data.

Do not log the ConnectedAPI object because future connector fields may include sensitive handles.

`disconnectWallet()` is intentionally application-local:

```ts
export const disconnectWallet = (): null => null;
```

The React hook will discard all session/provider/client references when it calls this function.

- [ ] **Step 4: Run connector tests and type-check the frontend**

```bash
npm run test:frontend -- connector.test.ts
npm run frontend:build
```

Expected: PASS; browser build has no Node polyfill errors from connector code.

- [ ] **Step 5: Commit the Lace connector**

```bash
git add frontend/src/midnight frontend/src/vite-env.d.ts
git commit -m "feat: connect ShadowEscrow to Lace"
```

---

### Task 5: Persist Account-Scoped Browser Private State

**Files:**
- Create: `frontend/src/midnight/privateState.ts`
- Create: `frontend/src/midnight/privateState.test.ts`
- Modify: `frontend/src/midnight/types.ts`

**Interfaces:**
- Consumes: connected Lace `unshieldedAddress` as storage scope only.
- Produces:
  - `BROWSER_PRIVATE_STATE_ID = 'shadowEscrowPrivateState'`
  - `BROWSER_PRIVATE_STATE_STORE = 'shadow-escrow-browser-state'`
  - `generatePrivateState(): ShadowEscrowPrivateState`
  - `createBrowserPrivateStateProvider(accountId: string, contractAddress: string)`
  - `getOrCreateBrowserPrivateState(provider): Promise<ShadowEscrowPrivateState>`

- [ ] **Step 1: Write failing privacy/state-isolation tests**

Test randomness, same-account restoration, and cross-account isolation with isolated browser storage. The key assertions must be:

```ts
it('generates a 32-byte credential without logging it', () => {
  const spy = vi.spyOn(console, 'log');
  const state = generatePrivateState();
  expect(state.approvalSecret).toHaveLength(32);
  expect(spy).not.toHaveBeenCalled();
});

it('restores the same state for the same account and contract', async () => {
  const a1 = await loadForTest('account-a', 'contract-1');
  const a2 = await loadForTest('account-a', 'contract-1');
  expect(a2.approvalSecret).toEqual(a1.approvalSecret);
});

it('does not reuse another Lace account private state', async () => {
  const a = await loadForTest('account-a', 'contract-1');
  const b = await loadForTest('account-b', 'contract-1');
  expect(b.approvalSecret).not.toEqual(a.approvalSecret);
});
```

- [ ] **Step 2: Run the private-state tests and verify failure**

```bash
npm run test:frontend -- privateState.test.ts
```

Expected: FAIL because the browser private-state module does not exist.

- [ ] **Step 3: Implement the Midnight browser private-state provider**

Use `levelPrivateStateProvider<ShadowEscrowPrivateState>({ ... })` with:

```ts
{
  privateStateStoreName: 'shadow-escrow-browser-state',
  accountId,
  privateStoragePasswordProvider: async () => getOrCreateStoragePassword(accountId),
}
```

Set the contract address before using `get`/`set` methods if required by the provider’s 4.1.1 interface. Generate the state with:

```ts
export const generatePrivateState = (): ShadowEscrowPrivateState => ({
  approvalSecret: crypto.getRandomValues(new Uint8Array(32)),
});
```

The storage password is also random and account-scoped. Store only that provider-encryption password under a namespaced browser key such as `shadow-escrow:private-storage-password:<accountId>`; never store the approval secret directly in `localStorage`.

- [ ] **Step 4: Verify state restoration/isolation and production build**

```bash
npm run test:frontend -- privateState.test.ts
npm run frontend:build
```

Expected: PASS. Clear-browser-data behavior is documented later as loss of local credential/recovery for this demo.

- [ ] **Step 5: Commit private-state persistence**

```bash
git add frontend/src/midnight/privateState.ts frontend/src/midnight/privateState.test.ts frontend/src/midnight/types.ts
git commit -m "feat: persist account-scoped browser private state"
```

---

### Task 6: Build Browser Midnight Providers and Contract Calls

**Files:**
- Create: `frontend/src/midnight/providers.ts`
- Create: `frontend/src/midnight/providers.test.ts`
- Create: `frontend/src/midnight/contract.ts`
- Create: `frontend/src/midnight/contract.test.ts`
- Modify: `frontend/src/midnight/types.ts`

**Interfaces:**
- Consumes: `WalletSession`, account-scoped private-state provider, Task 1 generated contract, browser ZK assets.
- Produces:
  - `buildBrowserProviders(session, privateStateProvider): Promise<BrowserShadowEscrowProviders>`
  - `connectShadowEscrow(providers, contractAddress, initialPrivateState): Promise<ShadowEscrowBrowserClient>`
  - `ShadowEscrowBrowserClient.readMyState(): Promise<PublicMilestoneState>`
  - `ShadowEscrowBrowserClient.register(): Promise<string>`
  - `ShadowEscrowBrowserClient.approve(): Promise<string>`

Define:

```ts
export type PublicMilestoneState = {
  commitmentHex: string;
  registered: boolean;
  approved: boolean;
  approvalCount: 0 | 1;
  totalRegistrations: bigint;
  totalApprovals: bigint;
};
```

- [ ] **Step 1: Write failing provider bridge tests**

Mock `ConnectedAPI` and assert wallet-delegated proving plus Lace balancing/submission are used. The important test seam is:

```ts
expect(dappConnectorProofProvider).toHaveBeenCalledWith(
  connectedApi,
  expect.anything(),
  expect.anything(),
);
```

and the transaction adapters must call:

```ts
connectedApi.balanceUnsealedTransaction(toHex(tx.serialize()));
connectedApi.submitTransaction(toHex(tx.serialize()));
```

Do not assert or use `configuration.proverServerUri`.

- [ ] **Step 2: Run provider tests and verify failure**

```bash
npm run test:frontend -- providers.test.ts
```

Expected: FAIL because `providers.ts` does not exist.

- [ ] **Step 3: Implement browser provider assembly using current DApp Connector APIs**

The implementation must follow this structure:

```ts
const zkConfigProvider = new FetchZkConfigProvider<'register' | 'approve'>(
  window.location.origin,
  fetch.bind(window),
);

const proofProvider = await dappConnectorProofProvider(
  session.connectedApi,
  zkConfigProvider,
  CostModel.initialCostModel(),
);

return {
  privateStateProvider,
  zkConfigProvider,
  proofProvider,
  publicDataProvider: indexerPublicDataProvider(
    session.configuration.indexerUri,
    session.configuration.indexerWsUri,
  ),
  walletProvider: {
    getCoinPublicKey: () => session.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => session.shieldedEncryptionPublicKey,
    balanceTx: async (tx) => {
      const received = await session.connectedApi.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
        'signature', 'proof', 'binding', fromHex(received.tx),
      );
    },
  },
  midnightProvider: {
    submitTx: async (tx) => {
      await session.connectedApi.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  },
};
```

Use `setNetworkId('preprod')` before provider/contract work.

- [ ] **Step 4: Write failing contract-client tests**

Mock `findDeployedContract`, generated `pureCircuits.commitment`, ledger projection, and `callTx`. Verify:

```ts
await client.register();
expect(handle.callTx.register).toHaveBeenCalledTimes(1);

await client.approve();
expect(handle.callTx.approve).toHaveBeenCalledTimes(1);

const state = await client.readMyState();
expect(state.commitmentHex).toMatch(/^[0-9a-f]{64}$/);
expect(state.registered).toBe(true);
expect(state.approved).toBe(false);
expect(state.approvalCount).toBe(0);
```

- [ ] **Step 5: Implement `ShadowEscrowBrowserClient`**

Load the generated browser-safe `Contract`, `ledger`, and `pureCircuits` through the Vite `@contract` alias. Create a `CompiledContract` with `witnesses`, join the configured address with `findDeployedContract`, and derive the current user commitment from the loaded private state:

```ts
const commitment = pureCircuits.commitment(privateState.approvalSecret);
const publicLedger = ledger(onChainState.data);

return {
  commitmentHex: toHex(commitment),
  registered: publicLedger.registeredCommitments.member(commitment),
  approved: publicLedger.approvedCommitments.member(commitment),
  approvalCount: publicLedger.approvedCommitments.member(commitment) ? 1 : 0,
  totalRegistrations: publicLedger.registrationCount,
  totalApprovals: publicLedger.approvalCount,
};
```

Return transaction identifiers from `register()` and `approve()` only; never return private state to UI components.

- [ ] **Step 6: Run contract/provider tests and build**

```bash
npm run test:frontend -- providers.test.ts contract.test.ts
npm run frontend:build
```

Expected: PASS and the production bundle resolves generated contract/WASM/ZK assets.

- [ ] **Step 7: Commit browser circuit integration**

```bash
git add frontend/src/midnight
 git commit -m "feat: call ShadowEscrow circuits from the browser"
```

---

### Task 7: Add the React State Machine and Privacy-Focused UI

**Files:**
- Create: `frontend/src/hooks/useShadowEscrow.ts`
- Create: `frontend/src/hooks/useShadowEscrow.test.tsx`
- Create: `frontend/src/components/WalletPanel.tsx`
- Create: `frontend/src/components/MilestoneCard.tsx`
- Create: `frontend/src/components/PrivacyProof.tsx`
- Create: `frontend/src/components/MilestoneCard.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: connector, private-state, provider, and contract-client APIs from Tasks 4–6.
- Produces: one hook exposing `status`, `wallet`, `milestone`, `error`, `connect`, `disconnect`, `register`, `approve`, `refresh`.

Use this explicit status union:

```ts
export type DappStatus =
  | 'disconnected'
  | 'connecting'
  | 'loading-state'
  | 'ready-unregistered'
  | 'registering'
  | 'ready-unapproved'
  | 'proving-approval'
  | 'approved'
  | 'error';
```

- [ ] **Step 1: Write failing hook state-transition tests**

Mock the four Midnight modules and verify the happy path:

```ts
it('runs connect → register → approve without exposing private state', async () => {
  const { result } = renderHook(() => useShadowEscrow());

  await act(async () => result.current.connect());
  expect(result.current.status).toBe('ready-unregistered');

  await act(async () => result.current.register());
  expect(result.current.status).toBe('ready-unapproved');

  await act(async () => result.current.approve());
  expect(result.current.status).toBe('approved');
  expect(JSON.stringify(result.current)).not.toContain('approvalSecret');
});

it('disconnect clears wallet, providers, client, milestone, and errors', async () => {
  const { result } = renderHook(() => useShadowEscrow());
  await act(async () => result.current.connect());
  act(() => result.current.disconnect());
  expect(result.current.status).toBe('disconnected');
  expect(result.current.wallet).toBeNull();
  expect(result.current.milestone).toBeNull();
});
```

- [ ] **Step 2: Run the hook tests and verify failure**

```bash
npm run test:frontend -- useShadowEscrow.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the orchestration hook**

`connect()` must perform this order:

```text
discover wallet
→ connected session
→ create account-scoped private-state provider
→ get/create private approval state
→ build Midnight providers
→ join configured Preprod contract
→ read commitment-scoped public state
→ set ready status
```

`register()` sets `registering`, calls `client.register()`, refreshes public state, then moves to `ready-unapproved`.

`approve()` sets `proving-approval`, calls `client.approve()`, refreshes, then moves to `approved`.

All caught errors are reduced to user-safe strings. Never concatenate serialized provider/private-state objects into errors.

- [ ] **Step 4: Write failing component tests for privacy-visible/public state**

Test that the milestone UI renders the public commitment and status but contains no secret/reveal control:

```tsx
render(<MilestoneCard state={registeredState} status="ready-unapproved" onRegister={vi.fn()} onApprove={vi.fn()} />);
expect(screen.getByText(registeredState.commitmentHex)).toBeInTheDocument();
expect(screen.getByRole('button', { name: /Approve Privately/i })).toBeEnabled();
expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
expect(screen.getByText(/never displayed/i)).toBeInTheDocument();
```

- [ ] **Step 5: Implement the three focused components and compose `App.tsx`**

The page must visibly show:

```text
PUBLIC ON PREPROD
Commitment: <64-hex public commitment>
Status: Not created | Awaiting approval | Approved
Approval count: 0 | 1
Contract: <public Preprod address>

PRIVATE IN THIS BROWSER
Approval credential: Stored locally — never displayed
```

While `status === 'proving-approval'`, the primary action copy must be `Generating zero-knowledge proof…`. While registering, use `Creating private milestone…`.

- [ ] **Step 6: Run all frontend tests and build**

```bash
npm run test:frontend
npm run frontend:build
```

Expected: PASS. Manually inspect the local page at `npm run frontend:dev`; it must remain usable on a laptop-width viewport and narrow mobile viewport.

- [ ] **Step 7: Commit the finished browser flow**

```bash
git add frontend/src
 git commit -m "feat: add private milestone web flow"
```

---

### Task 8: Deploy the Revised Contract to Preprod and Pin Public Configuration

**Files:**
- Create after successful deployment: `frontend/.env.preprod`
- Modify: `README.md` only for verified deployment metadata in this task
- Optional evidence: `screenshots/level-2-preprod-deployment.png`

**Interfaces:**
- Consumes: revised compiled contract and Node deployment flow.
- Produces: a real Preprod contract address that browser builds consume through `VITE_SHADOW_ESCROW_ADDRESS`.

- [ ] **Step 1: Run the full pre-deployment verification**

```bash
npm run compile
npm test
npm run test:frontend
npm run frontend:build
```

Expected: all commands exit 0. Do not deploy a tree that has failing tests/builds.

- [ ] **Step 2: Select Preprod and deploy**

```bash
npm run setup -- --network preprod
```

If setup creates a new Preprod wallet, fund the printed public address using the configured Preprod faucet and rerun/continue setup exactly as prompted. Do not paste recovery material into Git, README, screenshots, or chat logs intended for submission.

Expected: deployment succeeds and `.midnight-state.json` records `deployments.preprod.address`.

- [ ] **Step 3: Verify the deployed address by reconnecting**

```bash
npm run network preprod
npm run test:e2e
```

Expected: E2E reports `network: preprod`, the recorded address, and readable reusable-registry state.

- [ ] **Step 4: Generate committed public browser configuration from the verified local deployment record**

Run:

```bash
PREPROD_ADDRESS=$(node -e "const s=require('./.midnight-state.json'); const a=s.deployments?.preprod?.address; if(!a) process.exit(1); process.stdout.write(a)")
printf 'VITE_NETWORK_ID=preprod\nVITE_SHADOW_ESCROW_ADDRESS=%s\n' "$PREPROD_ADDRESS" > frontend/.env.preprod
cat frontend/.env.preprod
```

The file contains public values only and is safe to commit.

- [ ] **Step 5: Build against the exact deployed address**

```bash
npm run frontend:build
```

Expected: build succeeds with `VITE_NETWORK_ID=preprod` and the exact verified contract address.

- [ ] **Step 6: Record the verified deployment in README/evidence and commit**

Add the exact address printed by Step 4 to the README’s Level 2 deployment section and, if captured, add a terminal screenshot that shows `preprod` plus the address without secret material.

```bash
git add frontend/.env.preprod README.md screenshots/level-2-preprod-deployment.png 2>/dev/null || true
git add frontend/.env.preprod README.md
git commit -m "chore: configure verified Preprod deployment"
```

---

### Task 9: Ship to Vercel and Run a Real Lace Browser Smoke Test

**Files:**
- Create: `vercel.json`
- Modify: `README.md`
- Optional evidence: `screenshots/level-2-live-dapp.png`

**Interfaces:**
- Produces: public HTTPS demo URL whose static browser app joins the Task 8 Preprod deployment.

- [ ] **Step 1: Add Vercel build/output configuration**

Create `vercel.json`:

```json
{
  "buildCommand": "npm ci && npm run frontend:build",
  "outputDirectory": "frontend/dist",
  "framework": "vite"
}
```

Run locally:

```bash
npm ci
npm run frontend:build
```

Expected: deterministic clean build succeeds.

- [ ] **Step 2: Deploy the branch/main project to Vercel**

Use either the Vercel Git integration or Vercel CLI from the repository root. Because `frontend/.env.preprod` contains only public chain configuration and is committed, no secret environment variable is required for the Level 2 DApp.

Record the resulting HTTPS production URL immediately; do not write a guessed URL into README.

- [ ] **Step 3: Execute the real browser acceptance flow with Lace on Preprod**

In Chrome/Chromium with the current Lace extension configured for Midnight Preprod:

```text
1. Open the HTTPS Vercel URL.
2. Click Connect Lace and approve authorization.
3. Confirm the UI displays the connected account summary.
4. Click Create Private Milestone.
5. Approve the wallet transaction when Lace requests it.
6. Confirm a 64-hex public commitment appears and status becomes Awaiting approval.
7. Click Approve Privately.
8. Allow Lace/wallet proving and transaction submission.
9. Confirm status becomes Approved and approval count becomes 1.
10. Refresh the page; reconnect the same Lace account; confirm its milestone remains recognized.
11. Click Disconnect Lace; confirm the DApp returns to its disconnected state.
```

Expected: no approval secret appears in the page, browser console, network request payloads controlled by the app, or README.

- [ ] **Step 4: Record the actual live URL and commit hosting configuration**

Add the exact successful URL from Step 2 to README, optionally add a privacy-safe screenshot from Step 3, then:

```bash
git add vercel.json README.md screenshots/level-2-live-dapp.png 2>/dev/null || true
git add vercel.json README.md
git commit -m "feat: ship live Preprod DApp"
```

---

### Task 10: Finalize Level 2 Submission Evidence and Demo Video

**Files:**
- Modify: `README.md`
- Add: submission-safe screenshots/video link as available

**Interfaces:**
- Consumes: real Preprod address, real Vercel URL, successful Lace/circuit flow.
- Produces: reviewer-ready public repository and submission links.

- [ ] **Step 1: Rewrite the README around the Level 2 reviewer path**

README must include these concrete sections, filled only with values already verified in Tasks 8–9:

```markdown
# ShadowEscrow

## Level 2 demo
- Live DApp: <the actual successful Vercel URL from Task 9>
- Network: Midnight Preprod
- Contract: <the exact address from frontend/.env.preprod>
- Demo video: <the actual uploaded video URL after Step 3 below>

## Privacy claim
ShadowEscrow proves that the connected user possesses the private approval credential associated with their milestone without revealing that credential. The credential remains in browser-local private state; only its commitment and the resulting approval state are public.

## Public vs private state
## Lace connect/disconnect flow
## Create and approve a private milestone
## Local development
## Tests
## Preprod deployment
## Live deployment
## Submission evidence
```

Do not leave angle-bracket placeholders in the committed README; write each section only when its real value is known.

- [ ] **Step 2: Run final automated verification on the exact submission commit candidate**

```bash
npm ci
npm run verify
npm run network preprod
npm run test:e2e
```

Expected: all tests/compile/build pass; E2E verifies the Preprod address.

- [ ] **Step 3: Record and upload the 60–90 second demo video**

Record the live site, not localhost. The video sequence must visibly show:

```text
00:00  disconnected ShadowEscrow page
00:05  Connect Lace
00:15  connected wallet state
00:20  Create Private Milestone
00:35  public commitment visible
00:40  Approve Privately
00:55  Lace/wallet transaction/proving interaction
01:05  Approved status + approval count 1
01:10  privacy panel: credential remains private
01:15  Disconnect Lace
```

Upload it to a stable public/shareable location and verify the link in an incognito window before adding it to README.

- [ ] **Step 4: Verify the Level 2 commit-count requirement**

Run:

```bash
git log --oneline main..feat/level-2-dapp
```

Expected: at least 8 meaningful Level 2 implementation commits in addition to the design/plan commits. Review the messages for real deliverables rather than cosmetic split commits.

- [ ] **Step 5: Final privacy scan**

Run:

```bash
git grep -n -E 'approvalSecret.*(console|log)|console\.(log|debug).*approvalSecret' -- ':!docs/superpowers/*' || true
git grep -n -E 'MIDNIGHT_WALLET_(SEED|MNEMONIC)' -- ':!README.md' ':!docs/superpowers/*' || true
git status --short
```

Expected: no application logging of `approvalSecret`, no committed wallet secret values, and a clean working tree.

- [ ] **Step 6: Commit final reviewer documentation**

```bash
git add README.md screenshots
git commit -m "docs: finalize Level 2 submission evidence"
```

- [ ] **Step 7: Push and inspect the public repository as a reviewer**

```bash
git push origin feat/level-2-dapp
```

Open the public branch/repository without relying on local files and verify that README links, Preprod address, Vercel URL, video URL, generated ZK assets, and setup commands are all visible and correct.

---

## Final Acceptance Checklist

Before merging Level 2 to `main`, verify every item below against evidence rather than assumption:

- [ ] Lace connects from the live HTTPS React DApp.
- [ ] The DApp can clear/disconnect its Lace session and return to disconnected UI.
- [ ] A fresh Lace account can create exactly one browser-private milestone credential.
- [ ] Only the commitment is public; the raw credential is absent from ledger/UI/logs.
- [ ] The public commitment is visible in the DApp.
- [ ] `register()` is successfully called from the browser.
- [ ] `approve()` is successfully called from the browser and produces a ZK proof.
- [ ] Public state changes to approved with per-user approval count 1.
- [ ] Reload/reconnect with the same account restores private state.
- [ ] Switching accounts does not reuse the first account’s private state.
- [ ] Contract is deployed to Midnight Preprod and the address is verifiable/readable.
- [ ] Vercel live demo is reachable without localhost services.
- [ ] Demo video visibly shows wallet connect and successful circuit call.
- [ ] README states the privacy claim and public/private boundary.
- [ ] At least 8 meaningful Level 2 implementation commits exist.
- [ ] `npm run verify` passes on the final candidate.
- [ ] `npm run test:e2e` passes against Preprod.
