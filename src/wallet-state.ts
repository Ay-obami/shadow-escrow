// Account-scoped wallet sync-state persistence.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NetworkId } from './network';

export const WALLET_STATE_DIR = '.midnight-wallet-state';
export const WALLET_STATE_VERSION = 1 as const;

export type ChildKind = 'shielded' | 'unshielded' | 'dust';
export const CHILD_KINDS: readonly ChildKind[] = ['shielded', 'unshielded', 'dust'] as const;

export interface PersistedWalletState {
  shielded?: unknown;
  unshielded?: unknown;
  dust?: string;
}

export interface FsOptions {
  cwd?: string;
}

export function walletAccountScope(accountId: string): string {
  const normalized = accountId.trim();
  if (!normalized) throw new Error('wallet accountId must not be empty');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function accountDir(network: NetworkId, accountId: string, opts: FsOptions = {}): string {
  return path.join(opts.cwd ?? process.cwd(), WALLET_STATE_DIR, network, walletAccountScope(accountId));
}

function statePath(
  network: NetworkId,
  accountId: string,
  kind: ChildKind,
  opts: FsOptions = {},
): string {
  return path.join(accountDir(network, accountId, opts), `${kind}.json`);
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

interface VersionedState<T> {
  version: typeof WALLET_STATE_VERSION;
  state: T;
}

function readVersionedState<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as VersionedState<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== WALLET_STATE_VERSION) {
      return undefined;
    }
    return parsed.state;
  } catch {
    return undefined;
  }
}

function writeVersionedState<T>(file: string, state: T): void {
  const payload: VersionedState<T> = { version: WALLET_STATE_VERSION, state };
  atomicWrite(file, `${JSON.stringify(payload)}\n`);
}

export function loadWalletState(
  network: NetworkId,
  accountId: string,
  opts: FsOptions = {},
): PersistedWalletState {
  return {
    shielded: readVersionedState(statePath(network, accountId, 'shielded', opts)),
    unshielded: readVersionedState(statePath(network, accountId, 'unshielded', opts)),
    dust: readVersionedState<string>(statePath(network, accountId, 'dust', opts)),
  };
}

export function saveWalletState(
  network: NetworkId,
  accountId: string,
  state: PersistedWalletState,
  opts: FsOptions = {},
): void {
  if (state.shielded !== undefined) {
    writeVersionedState(statePath(network, accountId, 'shielded', opts), state.shielded);
  }
  if (state.unshielded !== undefined) {
    writeVersionedState(statePath(network, accountId, 'unshielded', opts), state.unshielded);
  }
  if (state.dust !== undefined) {
    writeVersionedState(statePath(network, accountId, 'dust', opts), state.dust);
  }
}

export function clearWalletState(
  network: NetworkId,
  accountId: string,
  opts: FsOptions = {},
): void {
  const dir = accountDir(network, accountId, opts);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
