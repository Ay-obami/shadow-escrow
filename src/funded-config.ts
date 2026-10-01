import { Buffer } from 'node:buffer';
import type { NetworkId } from './network.js';

const UINT128_MAX = (1n << 128n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const HEX_32 = /^(?:0x)?[0-9a-fA-F]{64}$/;

export interface FundedEscrowTerms {
  tokenColor: Uint8Array;
  amount: bigint;
  payee: { bytes: Uint8Array };
  refundRecipient: { bytes: Uint8Array };
  deadline: bigint;
}

export interface FundedTermsOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  nowSeconds?: bigint;
}

function readFlag(argv: string[], name: string): string | undefined {
  for (let i = 2; i < argv.length; i++) {
    const value = argv[i];
    if (value === name) return argv[i + 1];
    if (value?.startsWith(`${name}=`)) return value.slice(name.length + 1);
  }
  return undefined;
}

function requiredValue(
  argv: string[],
  env: NodeJS.ProcessEnv,
  flag: string,
  envName: string,
): string {
  const value = readFlag(argv, flag) ?? env[envName];
  if (!value?.trim()) {
    throw new Error(`Missing funded escrow term ${flag} (or ${envName}).`);
  }
  return value.trim();
}

function parseHex32(label: string, raw: string): Uint8Array {
  if (!HEX_32.test(raw)) {
    throw new Error(`${label} must be exactly 32 bytes of hex (64 hex characters).`);
  }
  const hex = raw.replace(/^0x/i, '').toLowerCase();
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function parseUnsigned(label: string, raw: string, max: bigint): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${label} must be an unsigned decimal integer.`);
  }
  const value = BigInt(raw);
  if (value > max) {
    throw new Error(`${label} exceeds the Compact ${label === 'amount' ? 'Uint128' : 'Uint64'} bound.`);
  }
  return value;
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

export function parseFundedEscrowTerms(
  opts: FundedTermsOptions = {},
): FundedEscrowTerms {
  const argv = opts.argv ?? process.argv;
  const env = opts.env ?? process.env;
  const nowSeconds = opts.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));

  const tokenColor = parseHex32(
    'token color',
    requiredValue(argv, env, '--token-color', 'SHADOW_ESCROW_TOKEN_COLOR'),
  );
  const amount = parseUnsigned(
    'amount',
    requiredValue(argv, env, '--amount', 'SHADOW_ESCROW_AMOUNT'),
    UINT128_MAX,
  );
  if (amount === 0n) throw new Error('amount must be positive.');

  const payeeBytes = parseHex32(
    'payee',
    requiredValue(argv, env, '--payee', 'SHADOW_ESCROW_PAYEE'),
  );
  const refundBytes = parseHex32(
    'refund recipient',
    requiredValue(argv, env, '--refund-recipient', 'SHADOW_ESCROW_REFUND_RECIPIENT'),
  );
  if (isZero(payeeBytes)) throw new Error('payee must be a nonzero raw UserAddress.');
  if (isZero(refundBytes)) throw new Error('refund recipient must be a nonzero raw UserAddress.');
  if (Buffer.from(payeeBytes).equals(Buffer.from(refundBytes))) {
    throw new Error('payee and refund destinations must be distinct.');
  }

  const deadline = parseUnsigned(
    'deadline',
    requiredValue(argv, env, '--deadline', 'SHADOW_ESCROW_DEADLINE'),
    UINT64_MAX,
  );
  if (deadline <= nowSeconds) {
    throw new Error('deadline must be a future Unix-seconds timestamp.');
  }

  return {
    tokenColor,
    amount,
    payee: { bytes: payeeBytes },
    refundRecipient: { bytes: refundBytes },
    deadline,
  };
}

export function resolvePrivateStatePassword(
  network: NetworkId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const provided = env.PRIVATE_STATE_PASSWORD?.trim();
  if (provided) {
    if (provided.length < 16) {
      throw new Error('PRIVATE_STATE_PASSWORD must be at least 16 characters.');
    }
    return provided;
  }
  if (network === 'undeployed') {
    return 'Local-Devnet-Development-Placeholder-1';
  }
  throw new Error(
    'PRIVATE_STATE_PASSWORD is required for preview/preprod and must be at least 16 characters.',
  );
}
