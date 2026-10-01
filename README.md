# ShadowEscrow

ShadowEscrow is a funded milestone escrow prototype on Midnight built with Compact. Version 2 combines real native-token custody with a privacy-preserving approval credential: the escrow terms and lifecycle are public, while the credential that authorizes approval stays in Midnight private state.

## What v2 proves

The current contract has a complete single-milestone lifecycle:

```text
Created ──fund()──> Funded ──approve()──> Approved ──settle()──> Settled
   │                   │
   │                   └── deadline reached ──refund()──> Refunded
   └── deadline reached ──cancel()──> Cancelled
```

The immutable public terms are `tokenColor`, `amount`, `payee`, `refundRecipient`, and `deadline`. Funding must provide exactly the configured unshielded asset and amount. Approval requires the private witness before the deadline. Once approval succeeds, settlement remains available after the deadline because the payee's claim has vested.

## Privacy model

`approvalSecret(): Bytes<32>` is a private witness derived deterministically from the wallet seed. The constructor publishes only a domain-separated commitment:

```compact
approvalCommitment = disclose(commitment(approvalSecret()));
```

The raw approval secret is never a ledger field and is never disclosed. `approve()` proves that the private witness matches the public commitment, changes `status` from `Funded` to `Approved`, and sets `approvalCount` to 1.

Public state includes:

- immutable escrow terms: token, amount, payee, refund recipient, deadline;
- lifecycle `status` and `version = 2`;
- `approvalCommitment` and `approvalCount`.

## Historical v1 Preview evidence

The original milestone-only v1 contract was deployed and exercised on Midnight Preview during the hackathon:

- network: `preview`
- v1 contract: `d50e59633dae38c7f515aa17322743e6324fd8cceba06233180647f56b449ce9`
- approval transaction: `007e7524d6625deeb6bf568b591437e46f0f08a2dab4cc84de3b40a7b7ca0b41bb`
- approval block: `874555`

That address is **v1 only**. The v2 CLI and e2e check deliberately reject it because v2 has different constructor arguments and public state. The archived v1 Compact source is kept at `contracts/archive/v1/shadow-escrow.compact`.

## Requirements

Tested toolchain:

- Node.js 22
- Docker + Docker Compose
- Compact CLI/devtools 0.5.2
- Compact compiler 0.31.1

Install dependencies with `npm install`.

## Build and test

Compile Compact and regenerate the managed contract artifacts:

```bash
npm run compile
```

The tracked managed output includes generated TypeScript/JavaScript, ZKIR, and prover/verifier keys for `fund`, `approve`, `settle`, `refund`, and `cancel`.

Run TypeScript validation and the full regression suite:

```bash
npm run build
npm run typecheck:all
npm test
```

The current suite has 38 passing tests covering constructor bounds, exact funding inputs, deadline edges, witness rejection, replay prevention, settlement, refund, cancellation, generated API parity, account-scoped wallet cache persistence, and legacy privacy regressions.

## Configure a funded escrow

Recipient arguments are raw 32-byte Midnight `UserAddress` values, not Bech32 strings. To print the current wallet's public identity without syncing to the network:

```bash
npm run wallet-info -- --network preview
```

A newly generated public-network wallet may print its recovery phrase once so it can be backed up. The command never prints the raw seed, private key, or approval secret.

Deploy requires all immutable terms, supplied either as CLI flags or environment variables:

```bash
npm run deploy -- \
  --network preview \
  --token-color <64-hex> \
  --amount <uint128> \
  --payee <64-hex-user-address> \
  --refund-recipient <64-hex-user-address> \
  --deadline <future-unix-seconds>
```

Equivalent environment variables are `SHADOW_ESCROW_TOKEN_COLOR`, `SHADOW_ESCROW_AMOUNT`, `SHADOW_ESCROW_PAYEE`, `SHADOW_ESCROW_REFUND_RECIPIENT`, and `SHADOW_ESCROW_DEADLINE`.

For `preview` or `preprod`, set a private-state storage password of at least 16 characters:

```bash
export PRIVATE_STATE_PASSWORD='use-a-local-secret-manager-value'
```

Do not commit that value.

`npm run setup -- ...` forwards the same flags after starting the required local services and compiling the contract.

## Local development

Example local deployment:

```bash
npm run setup -- \
  --token-color <64-hex> \
  --amount <uint128> \
  --payee <64-hex-user-address> \
  --refund-recipient <64-hex-user-address> \
  --deadline <future-unix-seconds>
```

Then use:

```bash
npm run cli
npm run test:e2e
```

The CLI exposes the full v2 lifecycle and displays the authoritative indexed state before each action. Funding requires explicit `FUND` confirmation and warns that an expired refund always goes to the immutable refund recipient, which may differ from the wallet that funded the contract.

To reset local runtime state:

```bash
docker compose down -v
npm run clean
```

## Public-network operation

Select a network with either `--network preview|preprod` or:

```bash
npm run network preview
```

Public-network wallet recovery material and deployment metadata live in `.midnight-state.json`; wallet sync caches live under `.midnight-wallet-state/`. Both are gitignored. Private-state databases are also gitignored.

The funded v2 deployment is intentionally not represented by the historical v1 Preview address. After a v2 deployment, `npm run test:e2e -- --network <network>` verifies:

- the deployed contract reports `version = 2`;
- the local private approval credential matches the public commitment;
- token color, amount, recipients, deadline, status, and approval count are structurally valid;
- the raw approval secret is absent from public ledger state.

## Project structure

```text
contracts/
  shadow-escrow.compact
  archive/v1/shadow-escrow.compact
  managed/shadow-escrow/
scripts/
  e2e-check.ts
src/
  cli.ts
  deploy.ts
  funded-config.ts
  network.ts
  setup.ts
  shadow-escrow.ts
  wallet-info.ts
  wallet-state.ts
  wallet.ts
test/
  funded-config.test.ts
  funded-contract-regression.test.ts
  funded-lifecycle.test.ts
  runtime-dependency.test.ts
  shadow-escrow.test.ts
  wallet-state.test.ts
```

## Security and operational notes

- Funding is permissionless, but the asset, amount, refund recipient, and deadline are fixed at deployment.
- A funding wallet does not gain refund rights; refund always pays `refundRecipient`.
- Approval is only possible while `status == Funded` and before the deadline.
- Approved funds cannot be refunded; they can only settle to the immutable payee.
- Unapproved funded escrow becomes refundable at the deadline.
- Unfunded escrow becomes cancellable at the deadline.
- Transaction submission may succeed before the indexer reflects the new state. The CLI waits for indexed confirmation and tells the operator to inspect authoritative state before retrying if confirmation times out.
- Preview/preprod private-state storage requires an explicit password; the development placeholder is accepted only on the local undeployed network.

This repository is a prototype and testnet-oriented reference implementation, not an audited production escrow service.
