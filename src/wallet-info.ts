/** Offline public wallet identity helper for configuring escrow recipients. */
import {
  formatWalletBackupNotice,
  getOrCreateWallet,
  resolveNetwork,
} from './network.js';
import { deriveWalletPublicIdentity } from './wallet.js';

function main(): void {
  const { network, config, source } = resolveNetwork();
  const wallet = getOrCreateWallet(network);
  const notice = formatWalletBackupNotice(wallet, network);
  if (notice) process.stdout.write(notice);

  const identity = deriveWalletPublicIdentity(config, wallet.seed);

  process.stdout.write('\nShadowEscrow wallet info (offline; no RPC/indexer sync)\n');
  process.stdout.write(`Network:              ${network} (${source})\n`);
  process.stdout.write(`Unshielded Bech32:    ${identity.accountId}\n`);
  process.stdout.write(`Raw UserAddress hex:  0x${identity.userAddressHex}\n`);
  process.stdout.write('\nUse the raw UserAddress hex with --payee or --refund-recipient.\n');
  process.stdout.write('No raw seed, private key, or approval secret is printed.\n');
  process.stdout.write('If this command created a public-network wallet, back up the mnemonic notice shown above.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
