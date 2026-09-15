/**
 * End-to-end smoke check for ShadowEscrow.
 *
 * Reconnects with the same deterministic private witness state used at deploy
 * time, reads public ledger state, and exits 0 on success.
 */
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import {
  resolveNetwork,
  getOrCreateWallet,
  formatWalletBackupNotice,
  getDeployment,
} from '../src/network.js';
import { createWallet, persistWalletState } from '../src/wallet.js';
import {
  PRIVATE_STATE_ID,
  PRIVATE_STATE_STORE,
  createInitialPrivateState,
  loadShadowEscrowContract,
  zkConfigPath,
} from '../src/shadow-escrow.js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length >= 32;
}

async function main() {
  const deployment = getDeployment(network);
  if (!deployment) {
    fail(`No deploy on file for network ${network}.`);
  }
  if (!isHexAddress(deployment.address)) {
    fail(
      `Deployment address missing or invalid: ${JSON.stringify(deployment, null, 2)}`,
    );
  }

  const { module: ShadowEscrow, compiledContract } =
    await loadShadowEscrowContract();
  const initialPrivateState = createInitialPrivateState(SEED);

  const walletCtx = await createWallet({
    network,
    networkConfig,
    seed: SEED,
  });
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

  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() ||
    'Local-Devnet-Development-Placeholder-1';

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
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

  try {
    await findDeployedContract(providers, {
      contractAddress: deployment.address,
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    });
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  const onChainState =
    await providers.publicDataProvider.queryContractState(deployment.address);
  if (!onChainState) {
    await walletCtx.wallet.stop();
    fail(`queryContractState returned null for ${deployment.address}`);
  }

  const publicLedger = ShadowEscrow.ledger(onChainState.data);
  const { approvalCommitment, approvalCount, approved } = publicLedger;

  if (!(approvalCommitment instanceof Uint8Array) || approvalCommitment.length !== 32) {
    await walletCtx.wallet.stop();
    fail('approvalCommitment is missing or is not 32 bytes');
  }

  const count = Number(approvalCount);
  if (count !== 0 && count !== 1) {
    await walletCtx.wallet.stop();
    fail(`approvalCount should be 0 or 1, got ${String(approvalCount)}`);
  }
  if (typeof approved !== 'boolean') {
    await walletCtx.wallet.stop();
    fail(`approved should be boolean, got ${typeof approved}`);
  }
  if ((approved && count !== 1) || (!approved && count !== 0)) {
    await walletCtx.wallet.stop();
    fail(`inconsistent public state: approved=${approved}, approvalCount=${count}`);
  }
  if ('approvalSecret' in (publicLedger as Record<string, unknown>)) {
    await walletCtx.wallet.stop();
    fail('private approvalSecret leaked into public ledger state');
  }

  console.log('✅ e2e-check passed');
  console.log(`   contractAddress: ${deployment.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   approved:        ${approved}`);
  console.log(`   approvalCount:   ${count}`);
  console.log('   approvalSecret:  private');

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
