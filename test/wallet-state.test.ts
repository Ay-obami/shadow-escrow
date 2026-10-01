import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearWalletState,
  loadWalletState,
  saveWalletState,
} from '../src/wallet-state.js';

test('wallet sync caches are isolated by network and account identity', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'shadow-wallet-state-'));
  try {
    saveWalletState('preview', 'account-a', {
      shielded: { owner: 'a' },
      unshielded: { owner: 'a' },
      dust: 'dust-a',
    }, { cwd });
    saveWalletState('preview', 'account-b', {
      shielded: { owner: 'b' },
      unshielded: { owner: 'b' },
      dust: 'dust-b',
    }, { cwd });

    assert.deepEqual(loadWalletState('preview', 'account-a', { cwd }).shielded, { owner: 'a' });
    assert.deepEqual(loadWalletState('preview', 'account-b', { cwd }).shielded, { owner: 'b' });
    assert.equal(loadWalletState('preview', 'account-a', { cwd }).dust, 'dust-a');
    assert.equal(loadWalletState('preview', 'account-b', { cwd }).dust, 'dust-b');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('clearing one account cache does not erase another account on the same network', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'shadow-wallet-state-'));
  try {
    saveWalletState('preprod', 'account-a', { dust: 'dust-a' }, { cwd });
    saveWalletState('preprod', 'account-b', { dust: 'dust-b' }, { cwd });

    clearWalletState('preprod', 'account-a', { cwd });

    assert.equal(loadWalletState('preprod', 'account-a', { cwd }).dust, undefined);
    assert.equal(loadWalletState('preprod', 'account-b', { cwd }).dust, 'dust-b');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
