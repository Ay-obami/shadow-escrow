/**
 * CLI for interacting with the ShadowEscrow contract.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Buffer } from 'node:buffer';
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
} from './network.js';
import {
  createWallet,
  persistWalletState,
  unshieldedToken,
  type WalletContext,
} from './wallet.js';
import {
  PRIVATE_STATE_ID,
  PRIVATE_STATE_STORE,
  createInitialPrivateState,
  loadShadowEscrowContract,
  zkConfigPath,
} from './shadow-escrow.js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

async function createProviders(walletCtx: WalletContext) {
  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() ||
    'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: walletCtx.shieldedSecretKeys,
          dustSecretKey: walletCtx.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      accountId,
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
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    ShadowEscrow CLI                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(
      `No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`,
    );
    rl.close();
    process.exit(1);
  }

  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({
      network,
      networkConfig,
      seed: SEED,
    });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(
        `  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`,
      );
    }

    console.log('  Syncing with network...');
    console.log('  ℹ  This may take several minutes depending on network size.');
    console.log(
      '     RPC disconnection messages during sync are normal and can be safely ignored.\n',
    );
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    if (balance === 0n && network !== 'undeployed' && networkConfig.faucet) {
      const address = walletCtx.unshieldedKeystore.getBech32Address();
      console.log('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:');
      console.log(`     ${networkConfig.faucet}`);
      console.log(`     Wallet address: ${address}\n`);
    }

    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);
    const { module: ShadowEscrow, compiledContract } =
      await loadShadowEscrowContract();
    const initialPrivateState = createInitialPrivateState(SEED);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    });

    console.log('  ✅ Connected!\n');

    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Approve milestone privately');
      console.log('  2. Read public escrow state');
      console.log('  3. Check wallet balance');
      console.log('  4. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          console.log('\n  Generating zero-knowledge approval proof...');
          try {
            const tx = await deployed.callTx.approve();
            console.log('\n  ✅ Milestone approved without revealing the approval secret.');
            if (tx?.public?.txId) {
              console.log(`  Transaction ID: ${tx.public.txId}`);
            }
            if (tx?.public?.blockHeight !== undefined) {
              console.log(`  Block height: ${tx.public.blockHeight}`);
            }
            console.log('');
          } catch (error) {
            console.error(
              '\n  ❌ Approval failed:',
              error instanceof Error ? error.message : error,
            );
          }
          break;
        }

        case '2': {
          console.log('\n  Reading public ShadowEscrow state...');
          try {
            const contractState =
              await providers.publicDataProvider.queryContractState(
                deployment.address,
              );
            if (!contractState) {
              console.log('\n  No indexed contract state found.\n');
              break;
            }

            const ledgerState = ShadowEscrow.ledger(contractState.data);
            const approvalCommitment = Buffer.from(
              ledgerState.approvalCommitment,
            ).toString('hex');
            const approved = ledgerState.approved;
            const approvalCount = Number(ledgerState.approvalCount);

            console.log(`\n  Approval commitment: 0x${approvalCommitment}`);
            console.log(`  Approved: ${approved}`);
            console.log(`  Approval count: ${approvalCount}`);
            console.log('  Private approval secret: not disclosed\n');
          } catch (error) {
            console.error(
              '\n  ❌ Read failed:',
              error instanceof Error ? error.message : error,
            );
          }
          break;
        }

        case '3': {
          console.log('\n  Checking balance...');
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const currentBalance =
            currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
          console.log(`  DUST: ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '4':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-4.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);
