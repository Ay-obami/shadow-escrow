# ShadowEscrow Level 2 DApp Design

## Goal

Extend the Level 1 ShadowEscrow Compact prototype into a browser DApp that satisfies the Level 2 Midnight challenge requirements:

- connect and disconnect a Lace wallet through the DApp connector;
- call a Compact circuit from the browser and handle the result;
- keep approval credentials in browser-local private state;
- demonstrate an observable privacy behavior where possession is proven without revealing the secret;
- deploy the contract to Midnight Preprod with a verifiable address;
- publish a live React demo;
- provide a README, demo video, and at least 8 meaningful Level 2 commits.

The Level 2 build reuses the ShadowEscrow privacy primitive instead of introducing an unrelated product.

## Product Scope

Each connected Lace account gets one demo milestone in a single shared ShadowEscrow contract.

The user can:

1. connect Lace;
2. create their private milestone;
3. see the public commitment recorded for that milestone;
4. approve the milestone with a zero-knowledge proof generated from a browser-local secret;
5. see the public state change to approved;
6. disconnect Lace.

The Level 2 scope intentionally excludes token custody, payment release, arbitration, multiple milestones per account, confidential messaging, and production-grade escrow economics.

## Privacy Claim

> ShadowEscrow proves that the connected user possesses the private approval credential associated with their milestone without revealing that credential. The credential remains in browser-local private state; only its commitment and the resulting approval state are public.

The raw approval secret must never be:

- written to public ledger state;
- rendered in the UI;
- logged to the console;
- sent to Lace;
- stored in Vercel environment variables;
- committed to Git.

## High-Level Architecture

```text
React + Vite DApp
      |
      +-- Lace DApp Connector
      |
      +-- browser private state
      |
      +-- Midnight.js providers
              |
              v
        ShadowEscrow
              |
              v
       Midnight Preprod
```

The contract is deployed once to Preprod. The browser reconnects to that deployment by address; it does not deploy a new contract per user.

## Contract Model

The Level 1 single-global approval model is upgraded to an account-scoped model.

Each connected account has one public record containing conceptually:

```text
UserRecord
- approvalCommitment
- approved
- approvalCount
```

The corresponding private state contains:

```text
approvalSecret: Bytes<32>
```

The exact Compact key type used to associate records with connected Lace accounts will be selected from the current supported Midnight identity/address primitives during implementation. The required behavior is fixed:

- records are stable per connected Lace account;
- another account cannot mutate a user's milestone as that user;
- each account can register at most one demo milestone;
- each milestone can be approved at most once.

## Circuit Flow

### Register milestone

When a connected account has no existing record:

1. the browser generates a cryptographically random 32-byte `approvalSecret`;
2. the secret is persisted in browser-local private state scoped to the connected account;
3. the DApp derives a commitment from the secret;
4. the register circuit writes only the commitment and initial public state;
5. the UI displays the public commitment but never the secret.

Conceptually:

```text
approvalSecret (private)
      |
      v
commitment(secret)
      |
      v
public approvalCommitment
```

### Approve milestone

When the user clicks **Approve Privately**:

1. the DApp loads the local private state for the connected account;
2. the Compact witness provides the secret to the proving flow;
3. the circuit proves that the private secret matches the registered public commitment;
4. the circuit rejects an incorrect witness;
5. the circuit rejects replay;
6. public state changes to `approved = true` and `approvalCount = 1`;
7. the UI refreshes from indexed public state.

The privacy behavior is observable because the public commitment and approval result are visible while the credential itself remains unavailable.

## Frontend Stack

Use React + Vite + TypeScript.

The frontend lives under `frontend/` and is organized into focused modules:

```text
frontend/
└── src/
    ├── components/
    │   ├── WalletPanel.tsx
    │   ├── MilestoneCard.tsx
    │   └── PrivacyProof.tsx
    ├── hooks/
    │   └── useShadowEscrow.ts
    ├── midnight/
    │   ├── connector.ts
    │   ├── providers.ts
    │   ├── contract.ts
    │   └── privateState.ts
    ├── App.tsx
    └── main.tsx
```

### Responsibilities

- `connector.ts`: discover Lace, connect, disconnect, expose current account identity, and surface connector errors.
- `providers.ts`: construct browser-compatible Midnight.js providers from the connected Lace context.
- `contract.ts`: reconnect to the configured Preprod contract and expose register/approve/read operations.
- `privateState.ts`: generate, persist, load, and clear account-scoped local private state.
- `useShadowEscrow.ts`: own the application state machine and coordinate wallet, private state, contract calls, transaction status, and public-state refreshes.
- UI components: presentation only; no wallet keys or private witness values are exposed to components.

## Frontend State Machine

```text
Disconnected
   |
   v
Connected, not registered
   |
   v
Registering
   |
   v
Connected, registered, not approved
   |
   v
Generating proof / submitting transaction
   |
   v
Approved
```

The UI must handle these intermediate statuses explicitly:

- connecting wallet;
- loading public state;
- creating private milestone;
- generating zero-knowledge proof;
- waiting for Lace transaction approval;
- submitting transaction;
- waiting for indexed confirmation;
- success;
- recoverable error.

## User Interface

The main page contains one demo card with four clear areas.

### Wallet

- Connect Lace button when disconnected.
- Connected account summary when connected.
- Disconnect Lace button when connected.

### Milestone

- status: not created, awaiting approval, or approved;
- **Create Private Milestone** action when no record exists;
- **Approve Privately** action when registered and not approved.

### Public Preprod State

Display:

- public commitment hash;
- approval status;
- approval count;
- configured Preprod contract address.

### Privacy Explanation

Display assertions such as:

- secret generated locally;
- only the commitment is public;
- approval was proven in zero knowledge;
- private credential is never displayed.

There is deliberately no "reveal secret" control.

## Local Private State

The browser generates the secret with a cryptographically secure random source.

Private state is scoped by the connected Lace account so reconnecting with the same account restores that account's credential, while switching accounts does not reuse another account's secret.

Implementation will use the browser-compatible private-state pattern supported by the current Midnight SDK. If the SDK provides an IndexedDB-backed or equivalent private-state provider, that is preferred. A custom fallback may be used only if it preserves the same interface and account isolation.

The private state must survive page refreshes so the demo can reconnect to the same milestone after a reload.

## Configuration

Only public configuration is exposed to the frontend, for example:

```text
VITE_MIDNIGHT_NETWORK=preprod
VITE_SHADOW_ESCROW_ADDRESS=<public Preprod contract address>
```

No wallet seed, approval secret, recovery material, or private database contents are environment configuration.

## Preprod Deployment

Preprod is the canonical Level 2 environment.

The deployment process will:

1. compile the revised Compact contract;
2. generate managed proving artifacts;
3. deploy the contract to Preprod;
4. record the public contract address;
5. verify the address by reconnecting and reading public state;
6. configure the live frontend with that address.

The final README must include the exact Preprod address and the live frontend URL.

## Live Hosting

The React app will be deployed to Vercel unless a deployment-specific compatibility issue makes Netlify materially easier.

The static browser application must work without a local Node server. Any proof-server or Midnight network dependency required by the browser must use the appropriate remote Preprod-compatible service configuration.

## Testing Strategy

### Contract tests

At minimum:

- registration succeeds for a new account;
- public commitment is stored;
- raw secret is absent from ledger state;
- correct private witness approves exactly once;
- incorrect witness fails;
- replay fails;
- one account cannot approve another account's milestone;
- each account is isolated from another account's record.

### Frontend/unit tests

At minimum:

- Lace unavailable state;
- connect flow;
- disconnect flow;
- account-scoped secret creation;
- local private-state restoration after reconnect;
- account switching does not leak state;
- public contract state rendering;
- register transaction state transitions;
- approval transaction state transitions;
- error states do not expose private values.

### Real Preprod smoke test

The final integration proof must be performed against the deployed Preprod contract with a real Lace connection and a successful circuit call from the browser.

Mocks are not sufficient for submission evidence.

## Demo Video Flow

Target duration: roughly 60-90 seconds.

```text
00:00  show disconnected DApp
00:05  connect Lace
00:15  show connected wallet
00:20  create private milestone
00:35  show public commitment
00:40  approve privately
00:55  approve Lace transaction
01:05  show Approved state
01:10  highlight that credential remains private
01:15  disconnect Lace
```

The demo must visibly include wallet connect and a successful circuit call.

## README Requirements

The final README will include:

- Level 2 product summary;
- architecture overview;
- setup instructions;
- Lace connection instructions;
- local development instructions;
- Preprod deployment address;
- live Vercel URL;
- demo video link;
- privacy claim;
- explanation of public versus private state;
- how to reproduce the demo;
- test commands;
- submission evidence.

## Commit Strategy

Create at least 8 new meaningful Level 2 commits even though the repository already exceeds the challenge's lifetime minimum.

Expected units include:

1. contract redesign for account-scoped milestones;
2. multi-user contract/privacy tests;
3. React/Vite frontend scaffold;
4. Lace DApp Connector integration;
5. browser private-state persistence;
6. frontend circuit integration;
7. transaction/privacy status UI;
8. Preprod deployment and verification;
9. live-hosting configuration and smoke test;
10. final README/demo evidence.

Commits must correspond to real completed work rather than artificial splitting.

## Acceptance Criteria

The Level 2 build is complete only when all of the following are true:

- Lace connect works from the live React application;
- Lace disconnect works from the live React application;
- a user can create one private milestone from the browser;
- the UI shows the resulting public commitment;
- the approval secret remains browser-local and undisclosed;
- the browser successfully calls the approval circuit;
- a successful proof updates public approval state;
- the same account can reconnect and recover its private state;
- a different account cannot use the first account's private credential;
- the contract is deployed to Preprod with a verifiable address;
- the live DApp is reachable on Vercel or equivalent hosting;
- the demo video shows wallet connect and a successful circuit call;
- the README documents the privacy claim and reproduction steps;
- at least 8 meaningful Level 2 commits exist;
- contract, frontend, and Preprod smoke tests pass.
