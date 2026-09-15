# ShadowEscrow MVP Design

## Goal

Build a small Midnight/Compact application that satisfies the New Moon cycle requirements while demonstrating a meaningful privacy primitive rather than a tutorial counter or public-message contract.

ShadowEscrow will model confidential milestone approval. A client chooses a secret approval credential off-chain. The contract stores only a public commitment to that secret. Later, the client supplies the secret privately through a Compact witness/circuit flow; the contract proves that it matches the public commitment and exposes only the approval result on the public ledger.

This cycle intentionally does **not** move real tokens. The focus is the privacy and proof primitive. Token escrow, multi-milestone agreements, disputes, and selective arbitrator disclosure are future extensions.

## Success Criteria

The submission is complete when all of the following are true:

- The Compact contract compiles successfully with the currently scaffolded toolchain.
- A real private witness is used in the approval flow.
- `disclose()` is used only where private-derived information is intentionally made public.
- The generated `contracts/managed/` directory is present in the GitHub repository, including compiler output, contract bindings, prover/verifier keys, and ZKIR.
- Automated tests cover successful approval and rejection of an invalid secret, plus a privacy-oriented assertion that the raw secret is not stored in public ledger state.
- The contract deploys locally and passes the scaffold end-to-end check.
- The final contract deploys to Midnight Preview (Preprod is acceptable if Preview is unavailable) and the public contract address is recorded in the README.
- The README contains setup instructions, the public-state/private-witness explanation, the product idea paragraph, and screenshot evidence placeholders/links.
- The repository contains at least five meaningful commits.

## Architecture

### Compact contract

Replace `contracts/hello-world.compact` with `contracts/shadow-escrow.compact`.

The contract exposes a minimal public state:

- `approvalCommitment`: the public commitment derived from the private approval secret.
- `approved`: whether the milestone has been approved.
- `approvalCount`: number of successful approvals/state transitions. For this MVP it should only move from `0` to `1`, preventing repeated approval.

The private input is the client's `approvalSecret`. The raw secret must never be written to ledger state.

### Approval flow

1. A client chooses a secret locally.
2. The application derives a commitment from that secret.
3. The commitment is deliberately made public and stored in contract ledger state.
4. The raw secret is retained only in private application state / witness input.
5. To approve the milestone, the client invokes the approval circuit with the private secret.
6. The circuit derives the same commitment and asserts equality with the public commitment.
7. If the assertion succeeds and the milestone is not already approved, the contract updates `approved` and `approvalCount`.
8. No circuit writes the raw secret to the ledger.

The exact commitment primitive will use a hash/type supported cleanly by Compact 0.31.1 and its standard library; implementation must follow the syntax and primitives supported by this pinned toolchain rather than newer-language examples.

## Public vs Private Data

### Public ledger state

The blockchain may reveal:

- the approval commitment,
- whether approval has occurred,
- the approval count,
- transaction metadata that Midnight exposes normally.

### Private data

The blockchain must not contain:

- the raw approval secret,
- private witness data used to prove knowledge of the secret.

### Deliberate disclosure

`disclose()` is only used when a value originating from a private circuit input is intentionally converted into public ledger data. The implementation should avoid wrapping unrelated values in `disclose()` merely to silence the compiler; each use must be explainable in the README.

## TypeScript integration

The existing scaffold already handles network selection, wallet creation, DUST, proof-server setup, deployment, and persistent local network state. Those pieces should be preserved unless the new contract requires a narrow adaptation.

Expected changes:

- `package.json`: compile the renamed ShadowEscrow contract and replace the placeholder `npm test` script with the real test suite.
- `src/deploy.ts`: load the ShadowEscrow managed artifacts, provide the contract/private-state configuration required for witnesses, and deploy the renamed contract.
- `src/cli.ts`: replace the hello-world message flow with small ShadowEscrow interactions (inspect state and approve with a secret).
- `scripts/e2e-check.ts`: reconnect to the deployed ShadowEscrow contract and verify expected ledger state.
- New test file(s): exercise the contract logic without requiring a public-network deployment.

Wallet/network code should remain isolated and unchanged unless required by the witness/private-state integration.

## Generated artifacts

The challenge explicitly requires the generated managed directory, while the scaffold currently ignores `contracts/managed/`. The implementation will change `.gitignore` so the final ShadowEscrow artifacts can be committed.

The generated hello-world artifacts should not be retained after the contract is renamed. The final repository should contain the generated artifacts corresponding to `shadow-escrow.compact`.

## Testing strategy

Testing will be added in layers:

1. **Compile test** — `npm run compile` must succeed and list generated circuits.
2. **Contract logic tests** — valid secret succeeds; invalid secret fails; second approval fails or leaves state unchanged according to the final circuit invariant.
3. **Privacy test** — inspect public ledger state/serialized contract data and ensure the raw test secret is not present.
4. **Local integration test** — `npm run setup` followed by `npm run test:e2e` on the bundled local devnet.
5. **Preview deployment verification** — deploy to Preview and reconnect/read state using the returned public contract address.

Because public-network deployment depends on the user's funded wallet and local proof/wallet environment, the final Preview command will be run on the user's machine after pulling the tested repository changes.

## Error handling and invariants

The contract should enforce:

- approval cannot succeed with the wrong secret;
- approval cannot be replayed after the milestone is already approved;
- the raw secret is never assigned to public ledger state;
- deployment aborts clearly when generated contract assets are missing;
- existing proof-server/network diagnostics remain intact.

No production-grade financial guarantees are claimed in this cycle because no real assets are escrowed.

## README / submission evidence

The final README will include:

- one-paragraph product idea;
- architecture and privacy model;
- explicit public-state vs private-witness section;
- explanation of each intentional `disclose()` usage;
- local setup and test commands;
- Preview deployment command;
- deployed Preview/Preprod contract address;
- screenshot references for successful compile output and public deployment output;
- note that the MVP proves confidential authorization and does not yet custody funds.

Screenshots are captured from the user's machine because the compiler, Docker stack, funded testnet wallet, and Preview deployment execute there.

## Commit strategy

Keep implementation work separated into meaningful commits, for example:

1. `docs: define ShadowEscrow MVP privacy design`
2. `feat: implement ShadowEscrow Compact contract`
3. `test: add ShadowEscrow contract and privacy tests`
4. `feat: integrate ShadowEscrow deployment and CLI flow`
5. `docs: document privacy model and local setup`
6. `build: commit generated Compact circuits and keys`
7. `docs: record Preview deployment evidence`

The existing scaffold commit and runtime-ignore cleanup remain in history, but the submission will not depend on the autogenerated scaffold commit to satisfy the five-meaningful-commits requirement.

## Deferred scope

The following are explicitly out of scope for this cycle:

- real token custody or transfer;
- multiple concurrent escrows;
- multiple milestones;
- freelancer/client identity management;
- arbitration and disputes;
- private evidence storage;
- reputation proofs;
- frontend UI.

These are natural future iterations once the private-approval primitive is stable and deployed.