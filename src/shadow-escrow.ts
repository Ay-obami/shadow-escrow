import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {
  createShadowEscrowPrivateState,
  witnesses,
  type ShadowEscrowPrivateState,
} from './witnesses.js';

export const PRIVATE_STATE_ID = 'shadowEscrowPrivateState';
export const PRIVATE_STATE_STORE = 'shadow-escrow-state';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkConfigPath = path.resolve(
  __dirname,
  '..',
  'contracts',
  'managed',
  'shadow-escrow',
);

/**
 * Derive a stable 32-byte approval credential from the already-private wallet
 * seed. This keeps reconnect/deploy flows deterministic without introducing a
 * second secret file. The public on-chain commitment is still computed inside
 * Compact with persistentHash.
 */
export function deriveApprovalSecret(seedHex: string): Uint8Array {
  return createHash('sha256')
    .update('shadow-escrow:approval-secret:v1\0', 'utf8')
    .update(Buffer.from(seedHex, 'hex'))
    .digest();
}

export function createInitialPrivateState(
  seedHex: string,
): ShadowEscrowPrivateState {
  return createShadowEscrowPrivateState(deriveApprovalSecret(seedHex));
}

export async function loadShadowEscrowContract() {
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) {
    throw new Error('Contract not compiled! Run: npm run compile');
  }

  const module = await import(pathToFileURL(contractPath).href);
  const compiledContract = CompiledContract.make(
    'shadow-escrow',
    module.Contract,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as any),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );

  return { module, compiledContract };
}
