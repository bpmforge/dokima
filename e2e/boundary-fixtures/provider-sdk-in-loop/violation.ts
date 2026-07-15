// Red fixture (W3-10, ARCHITECTURE.md §4 law 2): provider SDKs are gateway-egress-only
// — packages/loop may not import a provider SDK. Verified failing via
// `pnpm lint:boundary-fixtures`.
import Anthropic from '@anthropic-ai/sdk';

export const violation = Anthropic;
