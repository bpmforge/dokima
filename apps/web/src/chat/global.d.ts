export {};

declare global {
  interface Window {
    /** Injected into the served SPA shell by `apps/server/src/api/server.ts` (API_DESIGN §1). */
    __DOKIMA_TOKEN__?: string;
  }
}
