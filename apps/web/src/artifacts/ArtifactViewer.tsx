/**
 * Barrel — `App.tsx` imports `ArtifactViewer` from this exact path
 * (outside this ticket's write_scope, so the import site can't move); the
 * implementation lives in `ArtifactViewerRoot.tsx` + `ArtifactDocPane.tsx`
 * / `ArtifactReceiptsPane.tsx` (this ticket's AC4 file-size split).
 */
export { ArtifactViewer } from './ArtifactViewerRoot.js';
export type { ArtifactViewerProps } from './ArtifactViewerRoot.js';
