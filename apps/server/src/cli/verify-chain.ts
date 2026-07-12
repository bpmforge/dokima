import {
  listChainRows,
  verifyChain,
  type ChainVerificationResult,
  type EventLog,
} from '@shipwright/events';

export function checkChain(log: EventLog): ChainVerificationResult {
  return verifyChain(listChainRows(log));
}

export function renderChainResult(result: ChainVerificationResult): string {
  if (result.valid) return 'chain OK: all events verified against the hash chain';
  return `chain BROKEN at seq ${result.brokenAtSeq}: ${result.reason}`;
}
