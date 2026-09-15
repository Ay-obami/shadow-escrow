# ShadowEscrow Level 2 DApp Design

## Goal

Extend the Level 1 ShadowEscrow Compact prototype into a browser DApp that satisfies the Level 2 Midnight challenge:

- Lace wallet connect and disconnect through the DApp Connector;
- successful Compact circuit call from the frontend;
- browser-managed local private state;
- observable privacy behavior where possession is proven without revealing the secret;
- contract deployed to Midnight Preprod with a verifiable address;
- public live React demo;
- README, demo video, and at least 8 meaningful new Level 2 commits.

The Level 2 build reuses the ShadowEscrow privacy primitive instead of creating an unrelated project.

## Current SDK Baseline

Implementation will target the current Midnight documentation and compatibility matrix at build time. The current documentation exposes the DApp Connector API, a React wallet-connector guide, and a full-stack leaderboard tutorial covering React, Lace, browser contract interaction, Preprod, and Vercel. Version compatibility will be checked before dependencies are changed so the Level 1 runtime pin is not blindly carried into the browser stack.

## Product Scope

Each connected Lace account gets one demo milestone in one shared ShadowEscrow contract.

The user can:

1. connect Lace;
2. create one private milestone;
3. see the public commitment for that milestone;
4. approve it with a zero-knowledge proof based on a browser-local credential;
5. see public state change to approved;
6. disconnect Lace.

Out of scope: token custody, payment release, arbitration, multiple milestones per account, confidential messaging, and production escrow economics.

## Privacy Claim

> ShadowEscrow proves that the connected user possesses the private approval credential associated with their milestone without revealing that credential. The credential remains in browser-local private state; only its commitment and the resulting approval state are public.

The raw approval secret must never be written to public ledger state, rendered in the UI, logged, sent to Lace, stored in hosting environment variables, or committed to Git.

## Architecture

```text
React + Vite DApp
      |
      +-- Lace DApp Connector
      +-- browser private state
      +-- Midnight.js providers
              |
              v
        ShadowEscrow
              |
              v
       Midnight Preprod
```

The contract is deployed once to Preprod. The browser reconnects to that known deployment; it does not deploy a contract per user.

## Contract Model

The Level 1 global approval state becomes account-scoped state. Each user has one public record containing conceptually:

```text
UserRecord
- approvalCommitment
- approved
- approvalCount
```

The corresponding local private state contains:

```text
approvalSecret: Bytes<32>
```

### Account ownership rule

Before implementing the multi-user ledger key, the first contract task must verify the ownership/address pattern supported by the current Compact compiler and Midnight DApp Connector. The implementation must use the official supported identity/ownership primitive rather than inventing a caller abstraction.

Regardless of the concrete Compact type, these behaviors are mandatory:

- the record is stably associated with the connected Lace account;
- a second account cannot mutate the first account's milestone as that user;
- an account can register at most one demo milestone;
- a milestone can be approved at most once.

If the current official ownership pattern cannot safely express those behaviors, implementation stops and the contract design is revised before frontend work proceeds.

## Circuit Flow

### Register milestone

For a connected account without a record:

1. the browser generates a cryptographically random 32-byte `approvalSecret`;
2. it persists the secret in browser-local private state scoped to that account;
3. the DApp derives the contract-compatible commitment;
4. the registration circuit writes only the commitment and initial public state;
5. the UI displays the public commitment but never the secret.

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

When the user selects **Approve Privately**:

1. the DApp loads that account's local private state;
2. the witness supplies the secret to the proving flow;
3. the circuit proves the secret matches the account's public commitment;
4. incorrect witnesses and replay are rejected;
5. public state becomes `approved = true`, `approvalCount = 1`;
6. the frontend refreshes from indexed public state.

The privacy behavior is observable because the commitment and approval result are public while the credential remains unavailable.

## Frontend Stack

Use React + Vite + TypeScript under `frontend/`.

```text
frontend/src/
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

Responsibilities:

- `connector.ts`: Lace discovery, connect, disconnect, account identity, connector errors.
- `providers.ts`: browser-compatible Midnight.js providers from the connected wallet context.
- `contract.ts`: reconnect to the configured Preprod contract and expose register/approve/read operations.
- `privateState.ts`: generate, persist, load, and isolate account-scoped private state.
- `useShadowEscrow.ts`: application state machine coordinating wallet, private state, contract calls, transaction status, and public-state refreshes.
- UI components: presentation only; private witness values are never passed into display components.

## Frontend State Machine

```text
Disconnected
   |
Connected, not registered
   |
Registering
   |
Connected, registered, not approved
   |
Generating proof / awaiting wallet / submitting / confirming
   |
Approved
```

Recoverable states must exist for missing Lace, rejected wallet access, proof failure, transaction rejection, network mismatch, and indexer delay.

## User Interface

The page has four clear sections.

### Wallet

- Connect Lace when disconnected.
- Show a shortened connected account identifier.
- Disconnect Lace when connected.

### Milestone

- status: not created, awaiting approval, or approved;
- **Create Private Milestone** when no record exists;
- **Approve Privately** when registered and not approved.

### Public Preprod state

Display the public commitment hash, approval status, approval count, network, and configured Preprod contract address.

### Privacy explanation

Display that the secret was generated locally, only the commitment is public, approval is proven in zero knowledge, and the credential is never displayed. There is no reveal-secret control.

## Browser Private State

The browser uses a cryptographically secure random source for the approval secret.

Private state is scoped by connected account. Reconnecting with the same account restores that credential; switching accounts must not reuse or expose another account's state. The state must survive a page refresh.

Use the browser-compatible private-state pattern supported by the current Midnight SDK. Prefer the official persistent browser provider when available. A fallback is acceptable only if it preserves account isolation and the provider contract expected by the current SDK.

## Public Configuration

Frontend configuration contains only public data:

```text
VITE_MIDNIGHT_NETWORK=preprod
VITE_SHADOW_ESCROW_ADDRESS=<set from the successful Preprod deployment before hosting>
```

The address value is intentionally produced by the deployment step; it is not a secret. Wallet seeds, recovery material, approval secrets, and private-state database contents are never environment configuration.

## Preprod Deployment

Preprod is the canonical Level 2 environment.

Deployment will:

1. compile the revised Compact contract;
2. regenerate managed proving assets;
3. deploy to Preprod;
4. record the public contract address;
5. reconnect and verify public state;
6. set the frontend's public contract-address configuration;
7. run a browser smoke test with Lace against that deployment.

## Live Hosting

Deploy the static React application to Vercel unless a concrete compatibility issue makes Netlify materially safer. The hosted DApp must not depend on a developer laptop or local Node server. Browser network/proving configuration must use the current Preprod-compatible services required by the official Midnight browser pattern.

## Testing

### Contract tests

At minimum:

- new account registration succeeds;
- commitment becomes public;
- raw secret is absent from ledger state;
- correct private witness approves exactly once;
- wrong witness fails;
- replay fails;
- second account cannot mutate the first account's milestone;
- account records remain isolated.

### Frontend tests

At minimum:

- Lace unavailable state;
- connect and disconnect;
- account-scoped secret generation;
- private-state restoration after reconnect/refresh;
- account switching does not leak state;
- public contract state rendering;
- registration transaction states;
- approval transaction states;
- errors do not expose private values.

### Real Preprod smoke test

The final integration proof uses a real Lace connection against the deployed Preprod contract and successfully calls the privacy circuit from the browser. Mocks do not count as final submission evidence.

## Demo Video

Target 60-90 seconds:

```text
00:00  disconnected DApp
00:05  connect Lace
00:15  connected state
00:20  create private milestone
00:35  show public commitment
00:40  approve privately
00:55  Lace transaction interaction
01:05  show Approved state
01:10  highlight credential remains private
01:15  disconnect Lace
```

## README and Submission Evidence

The final README contains the product summary, architecture, setup, Lace instructions, local development, Preprod address, live URL, demo video, privacy claim, public-vs-private explanation, reproduction steps, tests, and submission evidence.

## Commit Strategy

Create at least 8 new meaningful Level 2 commits. Expected work units include:

1. contract ownership/privacy tests;
2. account-scoped contract redesign;
3. React/Vite scaffold;
4. Lace DApp Connector integration;
5. browser private-state persistence;
6. frontend circuit integration;
7. transaction/privacy UI;
8. Preprod deployment and verification;
9. live-hosting configuration/smoke test;
10. final README/demo evidence.

Commits correspond to completed units of work rather than artificial splitting.

## Acceptance Criteria

Level 2 is complete only when:

- Lace connects and disconnects from the live React app;
- a connected user can create one private milestone;
- the public commitment is visible;
- the approval secret remains browser-local and undisclosed;
- the browser successfully invokes the approval circuit;
- a successful proof updates public approval state;
- the same account can reconnect and restore private state;
- a different account cannot use the first account's credential;
- the contract is deployed to Preprod with a verifiable address;
- the DApp is publicly hosted;
- the demo video shows wallet connect and a successful circuit call;
- the README documents the privacy claim and reproduction steps;
- at least 8 meaningful Level 2 commits exist;
- contract, frontend, and real Preprod smoke tests pass.
