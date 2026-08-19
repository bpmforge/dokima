/**
 * useFollowUps — the adaptive half of the interview (W13-18, AC-1).
 *
 * `docs/USER_STORIES.md` AC-1 says "Interview adapts question depth to my
 * answers". The engine that does this has existed in
 * `packages/pipeline/src/interview` since W5-02 and had no production caller;
 * it was unreachable because a browser bundle may not call a model directly
 * (ARCHITECTURE §4 / law 6). `POST .../interview/next-question` is the missing
 * piece, and this is what asks it.
 *
 * ASKED FOR, NEVER AUTOMATIC. The first version fetched a follow-up on blur,
 * which meant a model call every time the cursor left a field — surprise
 * layout shifts, latency on every tab, money spent on a keystroke's worth of
 * intent, and an e2e suite that went from 30s to 1.2m with three failures. An
 * interview should ask when you want to say more, not because you tabbed.
 *
 * Split out of `InterviewPanel.tsx` at the 400-line CODE_BOOK_PROTOCOL cap.
 * The seam is real: the panel renders an interview, this decides whether there
 * is another question worth asking.
 */
import { useCallback, useState } from 'react';
import { fetchFollowUpQuestion } from './api.js';

/**
 * Mirrors the engine's own ceiling (`MAX_FOLLOWUP_DEPTH`, depth-policy.ts).
 * Redeclared rather than imported: `apps/web` is a browser bundle and cannot
 * depend on the server package. The route enforces the same bound, because a
 * limit only one caller honours is not a limit.
 */
export const MAX_FOLLOWUP_DEPTH = 4;

/** The answer key for the nth follow-up on a topic. */
export function followUpKey(deliverableId: string, index: number): string {
  return `${deliverableId}#${index}`;
}

export interface FollowUps {
  readonly byTopic: Readonly<Record<string, readonly string[]>>;
  readonly asking: string | null;
  ask(deliverableId: string, openingQuestion: string, answers: Record<string, string>): Promise<void>;
}

export function useFollowUps(projectId: string): FollowUps {
  const [byTopic, setByTopic] = useState<Record<string, string[]>>({});
  const [asking, setAsking] = useState<string | null>(null);

  const ask = useCallback(
    async (
      deliverableId: string,
      openingQuestion: string,
      answers: Record<string, string>,
    ) => {
      if (asking === deliverableId) return;
      const opening = (answers[deliverableId] ?? '').trim();
      if (opening === '') return;

      const asked = byTopic[deliverableId] ?? [];
      // The ceiling is what keeps this an interview rather than a chatbot.
      if (asked.length >= MAX_FOLLOWUP_DEPTH - 1) return;

      const given = [
        opening,
        ...asked.map((_, i) => answers[followUpKey(deliverableId, i)] ?? ''),
      ];
      // The last follow-up is unanswered — nothing new to reason about yet.
      if (given.some((a) => a.trim() === '')) return;

      setAsking(deliverableId);
      try {
        const next = await fetchFollowUpQuestion(
          projectId,
          deliverableId,
          openingQuestion,
          given,
        );
        if (next) {
          setByTopic((prev) => ({
            ...prev,
            [deliverableId]: [...(prev[deliverableId] ?? []), next],
          }));
        }
      } finally {
        setAsking(null);
      }
    },
    [asking, byTopic, projectId],
  );

  return { byTopic, asking, ask };
}
