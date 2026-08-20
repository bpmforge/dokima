/**
 * `POST /api/v1/projects/:id/ux-audit` — the design-review loop's judge
 * dispatch (W13-55, DESIGN_REVIEW_LOOP layer 3).
 *
 * CODE READS, MODEL JUDGES (the onboard-mode precedent): this route loads the
 * evidence packs W13-54's tour captured, hands them to the end-user-simulator
 * rubric through the gateway, re-greps every citation the model returns, and
 * files only the survivors into the plans funnel. A finding whose citation
 * the evidence does not contain is dropped and REPORTED — a model's claim is
 * never trusted unverified (C-2/C-3), which is precisely what makes a cheap
 * local model safe in the judge's chair.
 *
 * ROUTED AS `code-reviewer`: the persona in the prompt is the end-user
 * simulator, but the ROUTING role is an existing verifier role, so C-4's
 * mechanical maker≠verifier refusal applies to this call the same way it
 * applies to every review — no new role list to keep in sync.
 *
 * Named `routes.ts`, not `index.ts`, ON PURPOSE: validate-exports treats an
 * index.ts as barrel plumbing and discounts it as a consumer, so the judge's
 * pipeline imports would have read as no-caller gaps — this file is a real
 * consumer and carries a name the ratchet can see.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ROLE_CODE_REVIEWER } from '@dokima/gateway';
import { appendEvent, openEventLog } from '@dokima/events';
import {
  buildUxAuditPrompt,
  judgmentToPlanFields,
  parseUxAuditJudgments,
  verifyCitations,
  type UxEvidenceState,
} from '@dokima/pipeline';
import { badRequest, notFound } from '../../server/artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { resolveProjectRecord, stateDbPath } from '../../server/board-project.js';
import { computeFleetRegistryPath } from '../../projects.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../../server/board-actor.js';
import {
  fromSqlRow,
  insertRow,
  SELECT_ALL,
  type PlanItemSqlRow,
} from '../../plans-store-rows.js';
import { chatJson } from '../gateway-model-port/chat-json.js';
import { providerForConfig } from '../gateway-model-port/provider.js';
import { targetToConfig, type GatewayConfig } from '../gateway-model-port/config.js';
import { resolveModelTarget, ModelResolutionError } from '../model-resolution.js';

export interface UxAuditRoutesOptions {
  readonly home?: string;
  /** Test/e2e override, same precedence rule as pipeline-routes: the fake gateway wins. */
  readonly gatewayConfig?: GatewayConfig;
}

/** Loads every `*.evidence.json` under `dir` (recursive); the state id is the relative path minus the suffix. */
export async function loadEvidenceStates(dir: string): Promise<UxEvidenceState[]> {
  const states: UxEvidenceState[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.evidence.json')) {
        const raw = JSON.parse(await fs.readFile(full, 'utf8')) as Omit<
          UxEvidenceState,
          'id'
        >;
        const id = path
          .relative(dir, full)
          .replace(/\.evidence\.json$/, '')
          .split(path.sep)
          .join('/');
        states.push({ ...raw, id });
      }
    }
  }
  await walk(dir);
  return states;
}

export function registerUxAuditRoutes(
  app: FastifyInstance,
  opts: UxAuditRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.post(
    '/api/v1/projects/:id/ux-audit',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }
      const body = (request.body ?? {}) as { evidence_dir?: unknown };
      const evidenceDir =
        typeof body.evidence_dir === 'string' ? body.evidence_dir : 'docs/tour/img';
      const resolved = path.resolve(record.path, evidenceDir);
      if (!resolved.startsWith(path.resolve(record.path))) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'evidence_dir must stay inside the project'));
      }
      const states = await loadEvidenceStates(resolved);
      if (states.length === 0) {
        return reply
          .code(422)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(
              request,
              `no evidence packs under ${evidenceDir} — run the capture tour first ` +
                `(it writes an evidence.json beside every frame)`,
            ),
          );
      }

      let config: GatewayConfig;
      try {
        config =
          opts.gatewayConfig ??
          targetToConfig(
            await resolveModelTarget({
              projectPath: record.path,
              role: ROLE_CODE_REVIEWER,
              taskType: 'verification',
              actorId: OPERATOR_ACTOR_ID,
            }),
            process.env,
          );
      } catch (err) {
        if (err instanceof ModelResolutionError) {
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      }
      const provider = await providerForConfig(config);
      const { system, user } = buildUxAuditPrompt(states);
      const parsed = await chatJson(provider, config.model, 'ux-audit', system, user);
      const { judgments, malformed } = parseUxAuditJudgments(parsed);
      const { verified, dropped } = verifyCitations(judgments, states);

      const log = openEventLog(stateDbPath(record.path));
      const createdIds: string[] = [];
      try {
        const now = new Date().toISOString();
        ensureOperatorIdentity(log, () => now);
        const existing = new Set(
          (log.db.prepare(SELECT_ALL).all() as PlanItemSqlRow[]).map(
            (row) => fromSqlRow(row).catalogId,
          ),
        );
        for (const judgment of verified) {
          const fields = judgmentToPlanFields(judgment);
          if (existing.has(fields.catalogId)) continue;
          insertRow(log.db, {
            id: fields.catalogId,
            catalogId: fields.catalogId,
            rank: fields.rank,
            state: 'proposed',
            ticketId: null,
            verifyCriterion: fields.verifyCriterion,
            recommendation: fields.recommendation,
            severity: fields.severity,
            leverage: fields.leverage,
            lastVerifiedAt: null,
            evidence: fields.evidence,
            createdAt: now,
            firstSeenAt: now,
            attempt: 0,
          });
          createdIds.push(fields.catalogId);
        }
        // The run explains itself in the log (Law 4): what judged, what was
        // filed, and — critically — what was DROPPED and why. A silent drop
        // would be the trust boundary hiding its own work.
        appendEvent(
          log,
          {
            eventType: 'ux_audit.judged',
            actorId: OPERATOR_ACTOR_ID,
            payload: {
              statesJudged: states.length,
              model: config.model,
              verified: verified.length,
              createdIds,
              dropped: dropped.map((d) => ({
                id: d.judgment.id,
                state: d.judgment.state,
                reason: d.reason,
              })),
              malformed,
            },
          },
          { now: () => now },
        );
      } finally {
        log.close();
      }

      return reply.code(201).send({
        states_judged: states.length,
        model: config.model,
        created_ids: createdIds,
        verified: verified.length,
        dropped: dropped.map((d) => ({ id: d.judgment.id, reason: d.reason })),
        malformed,
      });
    },
  );
}
