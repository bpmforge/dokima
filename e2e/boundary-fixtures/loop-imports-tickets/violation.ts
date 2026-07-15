// Red fixture (W3-10, ARCHITECTURE.md §4 matrix): packages/loop may not import
// packages/tickets. Verified failing via `pnpm lint:boundary-fixtures`.
import { something } from '@shipwright/tickets';

export const violation = something;
