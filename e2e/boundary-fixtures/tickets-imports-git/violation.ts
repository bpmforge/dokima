// Red fixture (W3-10, ARCHITECTURE.md §4 matrix): packages/tickets may not import
// packages/git. Verified failing via `pnpm lint:boundary-fixtures`.
import { something } from '@shipwright/git';

export const violation = something;
