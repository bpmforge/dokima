// Red fixture (W3-10, TECH_STACK.md repository conventions): packages export via
// `exports` maps only — a deep import into another package's internals bypasses that
// and must fail lint. Verified failing via `pnpm lint:boundary-fixtures`.
import { deep } from '@shipwright/events/dist/internal';

export const violation = deep;
