/**
 * Feature map (P6-01): give the plan a SHAPE before tickets exist as a flat
 * list. Decomposition so far emitted tickets with lanes and dependencies but
 * no statement of how the product hangs together — which tickets are one
 * feature, which stories they serve, and how features connect to each other.
 *
 * The grouping is DETERMINISTIC, no model judgment anywhere:
 *   - a ticket's cited stories are the US-/FR- ids appearing in its title or
 *     acceptance text, extracted with `deriveRequirementIds` (the SAME
 *     extractor the requirement ledger uses — one regex, one truth) and
 *     restricted to the SRS-derived denominator;
 *   - tickets sharing any cited story are the same feature (union-find);
 *   - a seam whose provider and consumer tickets land in different features
 *     creates a `connects_to` edge with a stated reason — it does NOT merge
 *     them, because a connection is not an identity;
 *   - tickets citing no story land in the explicit `F-unmapped` feature,
 *     which `featureGaps` reports (the A-1 class inverted: a ticket serving
 *     no story), alongside every story no feature picked up.
 */

import { deriveRequirementIds } from '../assembler/ledger.js';
import type { Seam } from '../seams/types.js';
import type { DecomposedTicket, Feature, FeatureGap } from './types.js';

export const UNMAPPED_FEATURE_ID = 'F-unmapped';

/** Numeric-aware requirement-id compare so US-9 sorts before US-10. */
function compareStoryIds(a: string, b: string): number {
  const as = a.split('-');
  const bs = b.split('-');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i += 1) {
    const av = as[i] ?? '';
    const bv = bs[i] ?? '';
    if (av === bv) continue;
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isInteger(an) && Number.isInteger(bn)) return an - bn;
    return av < bv ? -1 : 1;
  }
  return 0;
}

/** Union-find with path compression; deterministic because tickets are
 * visited in input order and roots are re-pointed, never re-ranked. */
function findRoot(parent: Map<string, string>, id: string): string {
  let root = id;
  while (parent.get(root) !== root) root = parent.get(root) ?? root;
  let cursor = id;
  while (cursor !== root) {
    const next = parent.get(cursor) ?? root;
    parent.set(cursor, root);
    cursor = next;
  }
  return root;
}

/**
 * Group tickets into features by shared story citation, then express seam
 * producer→consumer pairs that cross feature lines as `connects_to` edges.
 * Same input twice → identical output (order and all).
 */
export function deriveFeatures(
  tickets: readonly DecomposedTicket[],
  requirementIds: readonly string[],
  seams: readonly Seam[] = [],
): Feature[] {
  const denominator = new Set(requirementIds);

  // (a) cited stories per ticket — title + acceptance text, denominator-only.
  const citedByTicket = new Map<string, string[]>();
  for (const ticket of tickets) {
    const text = [ticket.title, ...ticket.acceptance.map((ac) => ac.text)].join('\n');
    const cited = deriveRequirementIds(text).filter((id) => denominator.has(id));
    citedByTicket.set(ticket.id, cited);
  }

  // (b) union-find: tickets sharing any story id belong to the same feature.
  const parent = new Map<string, string>();
  for (const ticket of tickets) parent.set(ticket.id, ticket.id);
  const storyOwner = new Map<string, string>();
  for (const ticket of tickets) {
    for (const story of citedByTicket.get(ticket.id) ?? []) {
      const owner = storyOwner.get(story);
      if (owner === undefined) {
        storyOwner.set(story, ticket.id);
      } else {
        parent.set(findRoot(parent, ticket.id), findRoot(parent, owner));
      }
    }
  }

  // Collect groups in ticket input order; unmapped tickets go to F-unmapped.
  const groupTickets = new Map<string, DecomposedTicket[]>();
  const unmapped: DecomposedTicket[] = [];
  for (const ticket of tickets) {
    if ((citedByTicket.get(ticket.id) ?? []).length === 0) {
      unmapped.push(ticket);
      continue;
    }
    const root = findRoot(parent, ticket.id);
    const members = groupTickets.get(root);
    if (members === undefined) groupTickets.set(root, [ticket]);
    else members.push(ticket);
  }

  // (d) feature id = F- + the lowest story id in the group (stable); title
  // from the group's first ticket (input order) — the closest deterministic
  // stand-in for "what this feature is about" — or the story id itself.
  const features: Feature[] = [];
  const featureIdByTicket = new Map<string, string>();
  for (const members of groupTickets.values()) {
    const stories = [
      ...new Set(members.flatMap((t) => citedByTicket.get(t.id) ?? [])),
    ].sort(compareStoryIds);
    const lowest = stories[0] ?? '';
    const id = `F-${lowest}`;
    for (const t of members) featureIdByTicket.set(t.id, id);
    features.push({
      id,
      title: members[0]?.title ?? lowest,
      stories,
      tickets: members.map((t) => t.id),
      seams: [],
      connects_to: [],
    });
  }
  features.sort((a, b) => compareStoryIds(a.id, b.id));

  // (e) the explicit unmapped feature — present only when it has members.
  if (unmapped.length > 0) {
    for (const t of unmapped) featureIdByTicket.set(t.id, UNMAPPED_FEATURE_ID);
    features.push({
      id: UNMAPPED_FEATURE_ID,
      title: 'Unmapped',
      stories: [],
      tickets: unmapped.map((t) => t.id),
      seams: [],
      connects_to: [],
    });
  }

  // (c) seams: list on every feature they touch; a cross-feature
  // producer→consumer pair becomes a connects_to edge on the producer's
  // feature — a connection, not a merge.
  const seamIdsByFeature = new Map<string, string[]>();
  const edgesByFeature = new Map<string, { feature: string; reason: string }[]>();
  for (const seam of seams) {
    const producerFeature =
      seam.provider_ticket === undefined
        ? undefined
        : featureIdByTicket.get(seam.provider_ticket);
    const consumerFeature =
      seam.consumer_ticket === undefined
        ? undefined
        : featureIdByTicket.get(seam.consumer_ticket);
    for (const featureId of new Set(
      [producerFeature, consumerFeature].filter((f) => f !== undefined),
    )) {
      const ids = seamIdsByFeature.get(featureId) ?? [];
      if (!ids.includes(seam.id)) ids.push(seam.id);
      seamIdsByFeature.set(featureId, ids);
    }
    if (
      producerFeature !== undefined &&
      consumerFeature !== undefined &&
      producerFeature !== consumerFeature
    ) {
      const reason = `seam ${seam.id}: ${seam.provider_ticket} -> ${seam.consumer_ticket}`;
      const edges = edgesByFeature.get(producerFeature) ?? [];
      if (!edges.some((e) => e.feature === consumerFeature && e.reason === reason)) {
        edges.push({ feature: consumerFeature, reason });
      }
      edgesByFeature.set(producerFeature, edges);
    }
  }

  return features.map((feature) => ({
    ...feature,
    seams: seamIdsByFeature.get(feature.id) ?? [],
    connects_to: edgesByFeature.get(feature.id) ?? [],
  }));
}

/**
 * The feature map's gap check. Every ticket landing in exactly one feature
 * is structural (deriveFeatures assigns each ticket once); the GAPS are:
 *   - any ticket in F-unmapped — a ticket serving no story (A-1 inverted);
 *   - any requirement id with zero features — a story the plan dropped.
 * `requirementIds` is THE DENOMINATOR (deriveRequirementIds over SRS text),
 * the same discipline as `requirementClosureGaps` — deriving it from the
 * features would make the second check a tautology.
 */
export function featureGaps(
  features: readonly Feature[],
  requirementIds: readonly string[],
): FeatureGap[] {
  const gaps: FeatureGap[] = [];
  const unmappedFeature = features.find((f) => f.id === UNMAPPED_FEATURE_ID);
  for (const ticketId of unmappedFeature?.tickets ?? []) {
    gaps.push({
      kind: 'ticket-serves-no-story',
      subject: ticketId,
      detail: `${ticketId} cites no user story or requirement — it serves no story`,
    });
  }
  const covered = new Set(features.flatMap((f) => f.stories));
  for (const requirementId of requirementIds) {
    if (covered.has(requirementId)) continue;
    gaps.push({
      kind: 'story-has-no-feature',
      subject: requirementId,
      detail: `${requirementId} maps to no feature — no ticket cites it`,
    });
  }
  return gaps;
}
