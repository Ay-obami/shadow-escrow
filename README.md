# ShadowEscrow

ShadowEscrow is a privacy-first milestone approval prototype built on Midnight with Compact. It demonstrates how a client can prove knowledge of a private approval credential without publishing that credential on-chain. The New Moon MVP intentionally focuses on the privacy primitive rather than token custody: a private witness authorizes a one-time public milestone approval, while the underlying secret remains local.

## Product idea

Freelance and service agreements often need an auditable milestone approval without exposing every authorization detail publicly. ShadowEscrow lets a client keep an approval credential private, prove knowledge of it in zero knowledge, and publish only the resulting milestone status. Future versions can extend the same model to escrowed payments, multiple milestones, confidential dispute evidence, selective arbitrator disclosure, and privacy-preserving reputation.

## Privacy model

ShadowEscrow separates private witness data from public ledger state.

### Private witness

`approvalSecret(): Bytes<32>` is supplied from local Midnight private state. The TypeScript client derives a deterministic 32-byte secret from the already-private wallet seed and stores it through Midnight's private-state provider. The raw secret is never written to the public ledger.

### Public ledger state

The contract exposes only:

- `approvalCommitment: Bytes<32>` — a domain-separated commitment to the private approval secret.
- `approved: Boolean` — whether the milestone has been approved.
- `approvalCount: Uint<8>` — `0` before approval and `1` after the one permitted approval.

### Deliberate disclosure

The constructor deliberately uses `disclose()` only on the commitment derived from the private witness:

```compact
approvalCommitment = disclose(commitment(approvalSecret()));
```

The raw `approvalSecret()` is never passed to `disclose()`. The `approve()` circuit proves that the current private witness matches the public commitment, rejects replay, and then changes only the public approval state.

## Contract flow

```text
private approval secret
        │
        ▼
  Compact witness
        │
        ▼
 commitment(secret) ──────► public approvalCommitment
        │
        ▼
 approve() proves equality
        │
        ▼
 approved = true
 approvalCount = 1

 raw secret never becomes public
```

## Requirements

The project has been tested with:

- Node.js 22
- Docker + Docker Compose
- Compact CLI/devtools `0.5.2`
- Compact compiler `0.31.1`

## Install

```bash
npm install
```

Verify the toolchain:

```bash
node --version
docker --version
docker compose version
compact --version
compact compile --version
```

## Compile

```bash
npm run compile
```

The compiler writes generated contract code, proving/verifying keys, and ZKIR into:

```text
contracts/managed/shadow-escrow/
├── compiler/
├── contract/
├── keys/
│   ├── approve.prover
│   └── approve.verifier
└── zkir/
    ├── approve.bzkir
    └── approve.zkir
```

The `managed/` output is intentionally committed because it is part of the New Moon submission requirements.

## Tests

Run the simulator, witness, privacy, and integration-source tests:

```bash
npm test
```

The suite covers:

- the private approval witness is not public ledger state;
- `disclose()` is limited to the commitment;
- the public ledger does not contain the raw secret;
- a valid private witness approves exactly once;
- a wrong private witness is rejected;
- replay is rejected;
- deploy/CLI/e2e flows use the same deterministic private state.

After deployment, run the network smoke test:

```bash
npm run test:e2e
```

It reconnects to the deployed contract with the same private witness state and validates the public `approvalCommitment`, `approved`, and `approvalCount` fields.

## Local development

Start the local Midnight node, indexer, and proof server, compile, and deploy:

```bash
npm run setup
```

Then verify the deployment:

```bash
npm run test:e2e
```

Interact with it:

```bash
npm run cli
```

The CLI can submit the private `approve()` proof, read public ShadowEscrow state, and inspect wallet balances.

To reset the local devnet completely:

```bash
docker compose down -v
npm run clean
```

## Preview deployment

Deploy the same contract to Midnight Preview:

```bash
npm run setup -- --network preview
```

On first use, the project creates a Preview wallet and prints its address. Fund that address with the Preview faucet when prompted; the setup process waits for tNIGHT, registers NIGHT UTXOs for DUST generation, generates the deployment proof, and records the deployed contract address locally in `.midnight-state.json`.

After deployment:

```bash
npm run test:e2e -- --network preview
npm run cli -- --network preview
```

> `.midnight-state.json`, wallet sync caches, and local private-state databases are gitignored. Never commit wallet recovery material or private witness storage.

## Networks

```bash
npm run network undeployed
npm run network preview
npm run network preprod
```

Passing `--network <name>` to a command also selects that network for subsequent commands.

## Project structure

```text
shadow-escrow/
├── contracts/
│   ├── shadow-escrow.compact
│   └── managed/shadow-escrow/
├── test/
│   └── shadow-escrow.test.ts
├── scripts/
│   └── e2e-check.ts
├── src/
│   ├── witnesses.ts
│   ├── shadow-escrow.ts
│   ├── deploy.ts
│   ├── cli.ts
│   ├── setup.ts
│   ├── network.ts
│   └── wallet.ts
├── docker-compose.yml
├── package.json
└── README.md
```

## Submission evidence

Before final submission, the repository will include:

- `screenshots/compile-success.png` — successful Compact compile with circuits listed.
- `screenshots/preview-deployment.png` — Preview deployment output with the visible contract address.

## Current MVP scope

This cycle proves the core confidential authorization primitive. It does **not** yet custody tokens, release payments, or arbitrate disputes. Those are planned extensions once the private approval mechanism is proven end-to-end on Preview.
