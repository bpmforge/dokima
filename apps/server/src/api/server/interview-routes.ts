/**
 * interview-routes.ts — the adaptive follow-up the interview engine needs
 * (W13-18, AC-1).
 *
 * `docs/USER_STORIES.md` AC-1 says "Interview adapts question depth to my
 * answers; I can skip and return". The engine that does exactly that has been
 * built and tested in `packages/pipeline/src/interview` since W5-02 — depth
 * ceiling, skip, resume, NA-1 human-only enforcement — and every one of its
 * verbs sits in W12-38's buried-exports list with no production caller.
 *
 * It was unreachable for one concrete reason: `apps/web` is a browser bundle
 * and may not call a model directly (ARCHITECTURE §4 / law 6), so the
 * `nextQuestion` dep had nowhere to live. This is that place, and it is the
 * whole of what was missing.
 *
 * STATELESS ON PURPOSE. The client already sends an entire `InterviewSession`
 * to `POST .../pipeline/run`, so a follow-up request carries the topic and the
 * answers so far and gets one question back. No session store, and therefore
 * no second source of truth about where an interview has got to.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ROLE_CODING_AGENT } from '@dokima/gateway';
import { MAX_FOLLOWUP_DEPTH } from '@dokima/pipeline';
import { chatJson } from '../pipeline/gateway-model-port/chat-json.js';
import { providerForConfig } from '../pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../pipeline/gateway-model-port/config.js';
import { resolveModelTarget } from '../pipeline/model-resolution.js';
import { PROBLEM_CONTENT_TYPE } from '../problem.js';
import { badRequest, resolveProjectOrProblem } from './settings-route-helpers.js';

const SYSTEM_PROMPT = [
  'You are interviewing a person about a product they want built. You are asking',
  'about ONE topic at a time and your job is to decide whether you have enough',
  'to write that topic up, or whether one more question would materially help.',
  '',
  'Reply with only this JSON object:',
  '{"question": "your next question", "done": false}',
  'or, when you have enough:',
  '{"question": null, "done": true}',
  '',
  'Ask at most one question at a time. Ask about what is missing or ambiguous,',
  'never about something already answered. Prefer a concrete question over a',
  'broad one. If the answers so far are thin but the person clearly wants to',
  'move on, say you are done rather than pressing.',
].join('\n');

interface NextQuestionBody {
  readonly deliverable_id?: unknown;
  readonly question?: unknown;
  readonly answers?: unknown;
}

/** The role this runs as — priced, routed and metered like any other model call. */
const INTERVIEW_ROLE = 'pm-interviewer';

export function registerInterviewRoutes(
  app: FastifyInstance,
  opts: { readonly home?: string },
): void {
  /**
   * POST .../interview/next-question — one adaptive follow-up, or null.
   *
   * Returns `{ question: null }` rather than failing when no model is
   * reachable: a local-only user (C-1, D-024 option a) must still get a
   * working interview, so "no follow-up" degrades to the static question set
   * the panel already has rather than blocking the front door.
   */
  app.post(
    '/api/v1/projects/:id/interview/next-question',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;

      const body = (request.body ?? {}) as NextQuestionBody;
      const deliverableId = body.deliverable_id;
      const question = body.question;
      const answers = Array.isArray(body.answers) ? body.answers : undefined;
      if (typeof deliverableId !== 'string' || typeof question !== 'string' || !answers) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(
              request,
              '"deliverable_id", "question" and "answers" (array) are required',
            ),
          );
      }

      // The ceiling is enforced HERE as well as in the engine: this route can
      // be called directly, and a bound that only one caller honours is not a
      // bound. MAX_FOLLOWUP_DEPTH is what keeps this an interview rather than
      // an unbounded chat.
      if (answers.length >= MAX_FOLLOWUP_DEPTH) {
        return reply.send({ question: null, reason: 'depth-ceiling' });
      }

      /**
       * Routed as `pm-interviewer` first (D-025: a role names its expert), and
       * falling back to the role the project actually configured.
       *
       * Found live: a real project's matrix carries `coding-agent` rows only —
       * which is what the wizard and the Settings panel write — so asking for
       * `pm-interviewer` was unresolvable and every interview silently got no
       * follow-ups. Expecting a user to hand-configure a row per expert is not
       * a realistic contract.
       */
      let target;
      try {
        target = await resolveModelTarget({
          projectPath,
          role: INTERVIEW_ROLE,
          taskType: 'reasoning',
          actorId: 'operator',
        });
      } catch {
        try {
          target = await resolveModelTarget({
            projectPath,
            role: ROLE_CODING_AGENT,
            taskType: 'reasoning',
            actorId: 'operator',
          });
        } catch {
          // Genuinely nothing configured. Distinct from a model that failed,
          // because the fixes differ: configure a provider, versus look at why
          // the one you have did not answer.
          return reply.send({ question: null, reason: 'no-model-configured' });
        }
      }

      try {
        const provider = await providerForConfig(targetToConfig(target, process.env));
        const answered = answers
          .map((a, i) => `${i + 1}. ${typeof a === 'string' ? a : JSON.stringify(a)}`)
          .join('\n');
        const result = await chatJson(
          provider,
          target.model,
          'interview',
          SYSTEM_PROMPT,
          `Topic: ${deliverableId}\nOpening question: ${question}\n\nAnswers so far:\n${answered}`,
        );
        const next = result.question;
        return reply.send({
          question: typeof next === 'string' && next.trim() !== '' ? next : null,
        });
      } catch (err) {
        /**
         * Degraded, never fatal: a model that is unreachable, unaffordable or
         * malformed must not stop someone describing their product — the
         * opening questions still work. But the REASON is reported, because
         * the first live test of this route returned "unavailable" for a
         * routing problem, and a single catch-all that hides which of four
         * things went wrong is the silence this product exists to refuse.
         */
        request.log?.warn?.(
          { err, role: INTERVIEW_ROLE },
          'interview follow-up unavailable',
        );
        return reply.send({
          question: null,
          reason: 'unavailable',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
