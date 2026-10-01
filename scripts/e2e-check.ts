/** Read-only reconnect and public-state validation for ShadowEscrow v2. */
import { Buffer } from 'node:buffer';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import {
  formatWalletBackupNotice,
  getDeployment,
  getOrCreateWallet,
  resolveNetwork,
} from '../src/network.js';
import { createWallet, persistWalletState } from '../src/wallet.js';
import {
  PRIVATE_STATE_ID,
  PRIVATE_STATE_STORE,
  createInitialPrivateState,
  loadShadowEscrowContract,
  zkConfigPath,
} from '../src/shadow-escrow.js';
import { resolvePrivateStatePassword } from '../src/funded-config.js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
const notice = formatWalletBackupNotice(WALLET, network);
if (notice) console.log(notice);

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-fA-F]+$/.test(value) &&
    value.length >= 32
  );
}

function isNonZero(bytes: Uint8Array): boolean {
  return bytes.some((byte) => byte !== 0);
}

async function main() {
  const deployment = getDeployment(network);
  if (!deployment) fail(`No deploy on file for network ${network}.`);
  if (!isHexAddress(deployment.address)) {
    fail(`Deployment address missing or invalid: ${JSON.stringify(deployment)}`);
  }

  const { module: ShadowEscrow, compiledContract } =
    await loadShadowEscrowContract();
  const initialPrivateState = createInitialPrivateState(SEED);

  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx() {
      throw new Error('e2e-check is read-only and should not balance transactions');
    },
    submitTx() {
      throw new Error('e2e-check is read-only and should not submit transactions');
    },
  } as any;

  const privateStatePassword = resolvePrivateStatePassword(network);
  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      accountId: walletCtx.accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(
      networkConfig.indexer,
      networkConfig.indexerWS,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      networkConfig.proofServer,
      zkConfigProvider,
    ),
    walletProvider,
    midnightProvider: walletProvider,
  };

  const onChainState =
    await providers.publicDataProvider.queryContractState(deployment.address);
  if (!onChainState) {
    await walletCtx.wallet.stop();
    fail(`queryContractState returned null for ${deployment.address}`);
  }

  const publicLedger = ShadowEscrow.ledger(onChainState.data);
  if (Number(publicLedger.version) !== 2) {
    await walletCtx.wallet.stop();
    fail(`expected funded contract version 2, got ${String(publicLedger.version)}`);
  }

  const expectedCommitment =
    ShadowEscrow.pureCircuits.commitment(initialPrivateState.approvalSecret);
  if (
    !Buffer.from(expectedCommitment).equals(
      Buffer.from(publicLedger.approvalCommitment),
    )
  ) {
    await walletCtx.wallet.stop();
    fail('private approval credential does not match the deployed commitment');
  }

  try {
    await findDeployedContract(providers, {
      contractAddress: deployment.address,
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    });
  } catch (error: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${error?.message ?? error}`);
  }

  if (!(publicLedger.tokenColor instanceof Uint8Array) || publicLedger.tokenColor.length !== 32) {
    await walletCtx.wallet.stop();
    fail('tokenColor must be 32 bytes');
  }
  if (publicLedger.amount <= 0n) {
    await walletCtx.wallet.stop();
    fail(`amount must be positive, got ${String(publicLedger.amount)}`);
  }
  if (
    !isNonZero(publicLedger.payee.bytes) ||
    !isNonZero(publicLedger.refundRecipient.bytes) ||
    Buffer.from(publicLedger.payee.bytes).equals(
      Buffer.from(publicLedger.refundRecipient.bytes),
    )
  ) {
    await walletCtx.wallet.stop();
    fail('payee/refund destinations are zero or not distinct');
  }

  const status = Number(publicLedger.status);
  if (!Number.isInteger(status) || status < 0 || status > 5) {
    await walletCtx.wallet.stop();
    fail(`invalid status: ${String(publicLedger.status)}`);
  }
  const count = Number(publicLedger.approvalCount);
  const expectedCount = status === 2 || status === 3 ? 1 : 0;
  if (count !== expectedCount) {
    await walletCtx.wallet.stop();
    fail(`inconsistent status/approvalCount: status=${status}, count=${count}`);
  }
  if ('approvalSecret' in (publicLedger as Record<string, unknown>)) {
    await walletCtx.wallet.stop();
    fail('private approvalSecret leaked into public ledger state');
  }

  console.log('✅ e2e-check passed');
  console.log(`   contractAddress: ${deployment.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   version:         ${publicLedger.version.toString()}`);
  console.log(`   status:          ${publicLedger.status.toString()}`);
  console.log(`   amount:          ${publicLedger.amount.toString()}`);
  console.log(`   deadline:        ${publicLedger.deadline.toString()}`);
  console.log(`   approvalCount:   ${count}`);
  console.log('   approvalSecret:  private + commitment verified');

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
