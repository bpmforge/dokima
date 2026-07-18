/**
 * Copilot provider consent gate (D-019, AC6): default-off; enabling requires
 * a plain-language account-risk acknowledgement minted as a ledgered event
 * (FR-G6 ack pattern, mirrored from packages/gateway/src/fitness/events.ts —
 * see settings-events.ts's header). The matrix flags Copilot-backed roles
 * while enabled (matrix-routes.ts's `copilot_backed`).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { badRequest, resolveProjectOrProblem } from './settings-route-helpers.js';
import { appendCopilotConsentAck } from './settings-events.js';
import { getProjectSettings, putProjectSetting } from './settings-scope.js';

export const COPILOT_RISK_WARNING =
  'The Copilot adapter uses an undocumented internal API (copilot_internal). ' +
  'GitHub can permanently ban the account used for this flow at their sole discretion. ' +
  'This is not GitHub-sanctioned API usage — enable only if you accept that risk for this account.';

export interface ConsentRoutesOptions {
  home?: string;
}

export function registerConsentRoutes(
  app: FastifyInstance,
  opts: ConsentRoutesOptions = {},
): void {
  app.get(
    '/api/v1/projects/:id/copilot-consent',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const settings = await getProjectSettings(projectPath);
      return reply.send({
        enabled: settings.copilotEnabled === true,
        warning: COPILOT_RISK_WARNING,
      });
    },
  );

  app.post(
    '/api/v1/projects/:id/copilot-consent',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      if (body?.acknowledge !== true) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            badRequest(
              request,
              'enabling Copilot requires "acknowledge": true — the account-risk warning must be explicitly accepted (D-019)',
            ),
          );
      }
      const event = appendCopilotConsentAck(projectPath, COPILOT_RISK_WARNING);
      await putProjectSetting(projectPath, 'copilotEnabled', true);
      return reply.send({ enabled: true, acknowledged_at: event.occurredAt });
    },
  );

  app.delete(
    '/api/v1/projects/:id/copilot-consent',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      await putProjectSetting(projectPath, 'copilotEnabled', false);
      return reply.send({ enabled: false });
    },
  );
}
