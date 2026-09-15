import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { Ledger } from '../contracts/managed/shadow-escrow/contract/index.js';

export type ShadowEscrowPrivateState = {
  readonly approvalSecret: Uint8Array;
};

export const createShadowEscrowPrivateState = (
  approvalSecret: Uint8Array,
): ShadowEscrowPrivateState => ({ approvalSecret });

export const witnesses = {
  approvalSecret: ({
    privateState,
  }: WitnessContext<Ledger, ShadowEscrowPrivateState>): [
    ShadowEscrowPrivateState,
    Uint8Array,
  ] => [privateState, privateState.approvalSecret],
};
