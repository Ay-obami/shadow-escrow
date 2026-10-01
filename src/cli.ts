/** Interactive CLI for the version-2 funded ShadowEscrow lifecycle. */
import { Buffer } from 'node:buffer';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
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
import { resolvePrivateStatePassword } from './funded-config.js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
const notice = formatWalletBackupNotice(WALLET, network);
if (notice) console.log(notice);

const STATUS_NAMES = [
  'Created',
  'Funded',
  'Approved',
  'Settled',
  'Refunded',
  'Cancelled',
] as const;

function statusName(status: bigint | number): string {
  return STATUS_NAMES[Number(status)] ?? `Unknown(${String(status)})`;
}

async function createProviders(walletCtx: WalletContext) {
  const privateStatePassword = resolvePrivateStatePassword(network);
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
        {
          ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
          tokenKindsToBalance: 'all',
        },
      );
      const signedRecipe = await walletCtx.wallet.signRecipe(
        recipe,
        (payload) => walletCtx.unshieldedKeystore.signData(payload),
      );
      return walletCtx.wallet.finalizeRecipe(signedRecipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  return {
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
}

function bytesHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function assertV2Credential(ShadowEscrow: any, publicLedger: any, privateState: any): void {
  if (Number(publicLedger.version) !== 2) {
    throw new Error(
      `Deployment is not ShadowEscrow v2 (version=${String(publicLedger.version)}). Refusing funded commands.`,
    );
  }

  const expected = ShadowEscrow.pureCircuits.commitment(privateState.approvalSecret);
  if (!Buffer.from(expected).equals(Buffer.from(publicLedger.approvalCommitment))) {
    throw new Error(
      'Private approval credential does not match the deployed v2 commitment. Refusing to reconnect.',
    );
  }
}

async function queryLedger(providers: any, ShadowEscrow: any, address: string) {
  const contractState = await providers.publicDataProvider.queryContractState(address);
  if (!contractState) throw new Error(`No indexed contract state found for ${address}.`);
  const publicLedger = ShadowEscrow.ledger(contractState.data);
  if (Number(publicLedger.version) !== 2) {
    throw new Error(
      `Deployment is not ShadowEscrow v2 (version=${String(publicLedger.version)}).`,
    );
  }
  return { contractState, publicLedger };
}

async function waitForStatus(
  providers: any,
  ShadowEscrow: any,
  address: string,
  expected: number,
  attempts = 30,
) {
  for (let i = 0; i < attempts; i++) {
    const { publicLedger } = await queryLedger(providers, ShadowEscrow, address);
    if (Number(publicLedger.status) === expected) return publicLedger;
    if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `Transaction was submitted, but the indexer did not confirm ${STATUS_NAMES[expected] ?? expected}. Check authoritative state before retrying.`,
  );
}

function printTxMetadata(tx: any): void {
  if (tx?.public?.txId) console.log(`  Transaction ID: ${tx.public.txId}`);
  if (tx?.public?.blockHeight !== undefined) {
    console.log(`  Block height: ${tx.public.blockHeight}`);
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║               ShadowEscrow v2 funded CLI                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(
      `No deploy on file for network ${network}. Run \`npm run setup -- --network ${network} ...terms\` first.`,
    );
    rl.close();
    process.exit(1);
  }

  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network:  ${network}\n`);

  try {
    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(
        `  Restored ${restoredCount}/3 account-scoped child wallet caches.`,
      );
    }

    console.log('  Syncing with network...');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const walletState = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');
    await persistWalletState(network, walletCtx);

    const tNightBalance = walletState.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  tNight balance: ${tNightBalance.toLocaleString()}\n`);

    const providers = await createProviders(walletCtx);
    const { module: ShadowEscrow, compiledContract } =
      await loadShadowEscrowContract();
    const initialPrivateState = createInitialPrivateState(SEED);

    const initialRead = await queryLedger(
      providers,
      ShadowEscrow,
      deployment.address,
    );
    assertV2Credential(
      ShadowEscrow,
      initialRead.publicLedger,
      initialPrivateState,
    );

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    });

    console.log(
      `  ✅ Connected to v2; public status: ${statusName(initialRead.publicLedger.status)}\n`,
    );

    const runAndConfirm = async (
      label: string,
      expectedStatus: number,
      action: () => Promise<any>,
    ) => {
      const tx = await action();
      const confirmed = await waitForStatus(
        providers,
        ShadowEscrow,
        deployment.address,
        expectedStatus,
      );
      console.log(`\n  ✅ ${label}; indexed state is ${statusName(confirmed.status)}.`);
      printTxMetadata(tx);
      console.log('');
      return confirmed;
    };

    let running = true;
    while (running) {
      const { publicLedger } = await queryLedger(
        providers,
        ShadowEscrow,
        deployment.address,
      );

      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log(`  Current status: ${statusName(publicLedger.status)}`);
      console.log('  1. Fund escrow');
      console.log('  2. Approve milestone privately');
      console.log('  3. Settle approved escrow');
      console.log('  4. Refund expired funded escrow');
      console.log('  5. Cancel expired unfunded escrow');
      console.log('  6. Read public escrow state');
      console.log('  7. Check wallet balance');
      console.log('  8. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          console.log('\n  Funding disclosure:');
          console.log(
            `  • This call requires exactly ${publicLedger.amount.toString()} units of token 0x${bytesHex(publicLedger.tokenColor)}.`,
          );
          console.log(
            '  • Funding is permissionless: any wallet can satisfy the required input.',
          );
          console.log(
            `  • If the funded escrow expires before approval, refund goes only to 0x${bytesHex(publicLedger.refundRecipient.bytes)} — not necessarily the funding wallet.`,
          );
          const consent = await rl.question('  Type FUND to authorize this wallet to fund: ');
          if (consent.trim() !== 'FUND') {
            console.log('  Funding cancelled.\n');
            break;
          }
          try {
            await runAndConfirm('Escrow funded', 1, () => deployed.callTx.fund());
          } catch (error) {
            console.error('\n  ❌ Funding failed:', error instanceof Error ? error.message : error, '\n');
          }
          break;
        }

        case '2': {
          console.log('\n  Generating zero-knowledge approval proof...');
          try {
            await runAndConfirm(
              'Milestone approved without revealing the approval secret',
              2,
              () => deployed.callTx.approve(),
            );
          } catch (error) {
            console.error('\n  ❌ Approval failed:', error instanceof Error ? error.message : error, '\n');
          }
          break;
        }

        case '3': {
          try {
            await runAndConfirm(
              'Approved escrow settled to the fixed payee',
              3,
              () => deployed.callTx.settle(),
            );
          } catch (error) {
            console.error('\n  ❌ Settlement failed:', error instanceof Error ? error.message : error, '\n');
          }
          break;
        }

        case '4': {
          try {
            await runAndConfirm(
              'Expired funded escrow refunded to the fixed refund recipient',
              4,
              () => deployed.callTx.refund(),
            );
          } catch (error) {
            console.error('\n  ❌ Refund failed:', error instanceof Error ? error.message : error, '\n');
          }
          break;
        }

        case '5': {
          try {
            await runAndConfirm(
              'Expired unfunded escrow cancelled',
              5,
              () => deployed.callTx.cancel(),
            );
          } catch (error) {
            console.error('\n  ❌ Cancellation failed:', error instanceof Error ? error.message : error, '\n');
          }
          break;
        }

        case '6': {
          try {
            const { contractState, publicLedger: latest } = await queryLedger(
              providers,
              ShadowEscrow,
              deployment.address,
            );
            const tokenRaw = bytesHex(latest.tokenColor);
            const escrowBalance = [...contractState.balance.entries()].find(
              ([token]: any) => token?.tag === 'unshielded' && token.raw === tokenRaw,
            )?.[1] ?? 0n;

            console.log('\n  Public ShadowEscrow v2 state:');
            console.log(`  Version:          ${latest.version.toString()}`);
            console.log(`  Status:           ${statusName(latest.status)}`);
            console.log(`  Token color:      0x${tokenRaw}`);
            console.log(`  Amount:           ${latest.amount.toString()}`);
            console.log(`  Escrow balance:   ${escrowBalance.toString()}`);
            console.log(`  Payee:            0x${bytesHex(latest.payee.bytes)}`);
            console.log(`  Refund recipient: 0x${bytesHex(latest.refundRecipient.bytes)}`);
            console.log(`  Deadline:         ${latest.deadline.toString()}`);
            console.log(`  Approval count:   ${latest.approvalCount.toString()}`);
            console.log(`  Approval commit:  0x${bytesHex(latest.approvalCommitment)}`);
            console.log('  Approval secret:  private\n');
          } catch (error) {
            console.error('\n  ❌ Read failed:', error instanceof Error ? error.message : error, '\n');
          }
          break;
        }

        case '7': {
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const tokenRaw = bytesHex(publicLedger.tokenColor);
          const configuredBalance = currentState.unshielded.balances[tokenRaw] ?? 0n;
          const currentTNight =
            currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  Configured token 0x${tokenRaw}: ${configuredBalance.toLocaleString()}`);
          console.log(`  tNight: ${currentTNight.toLocaleString()}`);
          console.log(`  DUST:   ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '8':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-8.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
