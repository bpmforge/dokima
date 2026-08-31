/**
 * Back-compat adapter (P3-02, Law L4): lift the EXISTING decompose model into
 * the seam union without editing it. `InterfaceRef` ({packageName, exportName})
 * is exactly the `export` arm; the owning package's public barrel
 * (`<ownerPkg>/src/index.ts`) is where `findUnownedInterfaces`'s seam lessons
 * (W1-02: built but never re-exported) say the wiring must be visible — so
 * that barrel is the lifted evidence file.
 */

import type { InterfaceRef } from '../decompose/types.js';
import type { ExportSeam } from './types.js';

export interface FromInterfaceRefOptions {
  /** Ticket that owns the re-export (`providesInterfaces` side), if known. */
  readonly providerTicket?: string;
  /** Ticket that consumes the interface, if known — gap attribution. */
  readonly consumerTicket?: string;
}

/**
 * @param ref       the existing decompose InterfaceRef
 * @param ownerPkg  workspace path of the owning package (e.g. "packages/tickets")
 */
export function fromInterfaceRef(
  ref: InterfaceRef,
  ownerPkg: string,
  opts: FromInterfaceRefOptions = {},
): ExportSeam {
  const dir = ownerPkg.replace(/\/+$/, '');
  return {
    kind: 'export',
    id: `${ref.packageName}#${ref.exportName}`,
    packageName: ref.packageName,
    exportName: ref.exportName,
    wiring_evidence: {
      file: `${dir}/src/index.ts`,
      exportName: ref.exportName,
    },
    ...(opts.providerTicket ? { provider_ticket: opts.providerTicket } : {}),
    ...(opts.consumerTicket ? { consumer_ticket: opts.consumerTicket } : {}),
  };
}
