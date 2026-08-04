import { useCallback, useEffect, useState } from 'react';
import type { PaletteMode } from '../palette/index.js';
import { pushTraceViewUrl, readTraceTicketId } from '../trace/urlParams.js';

export type View =
  | 'settings'
  | 'wizard'
  | 'roster'
  | 'notifications'
  | 'plans'
  | 'trace'
  // W10-54: where a user describes their own idea. Until this existed the only
  // path that could start a pipeline was the guided sample, on a canned idea.
  | 'interview'
  // W10-72: the founder-decision slates. `DecisionsBoard` shipped in W5-14 and
  // was imported by nothing outside its own directory — built, never mounted —
  // so a run paused on a decision had no surface anywhere to answer it.
  | 'decisions'
  | null;

/** `?project=`/`?view=` are the URL's source of truth (no router lib yet) — absent project means Fleet is the entry view (UX_SPEC §2); `view=settings`/`view=wizard`/`view=roster`/`view=notifications`/`view=plans`/`view=trace` layer over either Fleet or a project. */
function readProjectId(): string | null {
  return new URLSearchParams(window.location.search).get('project');
}

const VALID_VIEWS = [
  'settings',
  'wizard',
  'roster',
  'notifications',
  'plans',
  'trace',
  'interview',
  'decisions',
];

function readView(): View {
  const view = new URLSearchParams(window.location.search).get('view');
  return view !== null && VALID_VIEWS.includes(view) ? (view as View) : null;
}

export interface AppNavigation {
  projectId: string | null;
  view: View;
  traceTicketId: string | null;
  openTicketId: string | null;
  setOpenTicketId: (id: string | null) => void;
  modeNotice: string | null;
  setModeNotice: (notice: string | null) => void;
  openProject: (id: string) => void;
  backToFleet: () => void;
  openView: (next: Exclude<View, null>) => void;
  closeView: () => void;
  openTraceView: (ticketId: string) => void;
  onSelectPaletteMode: (mode: PaletteMode) => void;
}

/** View routing chapter: URL-derived state (project/view) plus every navigation callback that mutates it, as one hook. */
export function useAppNavigation(): AppNavigation {
  const [projectId, setProjectId] = useState<string | null>(() => readProjectId());
  const [view, setView] = useState<View>(() => readView());
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  // Derived at render time, not mirrored into state (same "URL is the source of truth" discipline as readProjectId/readView).
  const traceTicketId = view === 'trace' ? readTraceTicketId() : null;

  useEffect(() => {
    const onPopState = () => {
      setProjectId(readProjectId());
      setView(readView());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openProject = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    url.searchParams.delete('view');
    window.history.pushState({}, '', url);
    setProjectId(id);
    setView(null);
  }, []);

  const backToFleet = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    url.searchParams.delete('view');
    window.history.pushState({}, '', url);
    setProjectId(null);
    setView(null);
  }, []);

  const openView = useCallback((next: Exclude<View, null>) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.pushState({}, '', url);
    setView(next);
  }, []);

  const closeView = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.delete('ticket');
    window.history.pushState({}, '', url);
    setView(null);
  }, []);

  /** Opens the session-trace view for a ticket (BLUEPRINT §12.4) and closes any open drawer. */
  const openTraceView = useCallback((ticketId: string) => {
    pushTraceViewUrl(ticketId);
    setOpenTicketId(null);
    setView('trace');
  }, []);

  /**
   * Palette mode picker (UX_SPEC §2a "What are we doing today?"). New
   * Product / Onboard existing repo are real, already-wired flows — this
   * is just the fastest path to the same `FirstRunWizard` the header's
   * Settings entry already opens, so it drops any open project in one
   * history entry rather than two. Feature/Improve have no dispatcher
   * anywhere in this app yet (no chat-send endpoint exists —
   * `chat/fixtures.ts`'s module header — so there is nothing to send a
   * `/sdlc feature`/`/sdlc improve` command to); refusing to fabricate one,
   * this surfaces an honest notice instead (HANDOFF: a future chat-dispatch
   * ticket wires these two for real).
   */
  const onSelectPaletteMode = useCallback((mode: PaletteMode) => {
    if (mode === 'new' || mode === 'onboard') {
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      url.searchParams.set('view', 'wizard');
      window.history.pushState({}, '', url);
      setProjectId(null);
      setView('wizard');
      setModeNotice(null);
    } else {
      setModeNotice(
        `"${mode === 'feature' ? 'Feature' : 'Improve'}" isn't wired to a workflow dispatcher yet — no chat-send endpoint exists in this app to carry it.`,
      );
    }
  }, []);

  return {
    projectId,
    view,
    traceTicketId,
    openTicketId,
    setOpenTicketId,
    modeNotice,
    setModeNotice,
    openProject,
    backToFleet,
    openView,
    closeView,
    openTraceView,
    onSelectPaletteMode,
  };
}
