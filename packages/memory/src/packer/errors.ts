/**
 * Honest-failure error for the Context Packer: raised instead of silently
 * truncating or dropping content a caller asked to be pinned (e.g. a
 * core block over its token ceiling) — "never naive truncation" (BLUEPRINT
 * §7.2) applies to failure handling too.
 */
export class PackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackerError';
  }
}
