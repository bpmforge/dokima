/**
 * A minimal layered (Sugiyama-style) DAG layout for `FlowchartDiagram` —
 * good enough to make the dependency/architecture diagrams this repo's
 * docs actually contain legible, not a general graph-layout engine. Ranks
 * nodes by longest path from a source, positions each rank's nodes evenly
 * spaced, then lets `direction` swap which axis is "rank" vs "lane".
 */

import type { FlowchartDiagram, FlowNode } from './parse.js';

export interface PositionedNode extends FlowNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedEdge {
  from: PositionedNode;
  to: PositionedNode;
  label: string | null;
  style: 'solid' | 'dotted' | 'thick';
}

export interface SubgraphBounds {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  subgraphs: SubgraphBounds[];
  width: number;
  height: number;
}

const RANK_GAP = 110;
const LANE_GAP = 40;
const CHAR_WIDTH = 7;
const LINE_HEIGHT = 16;
const NODE_PAD_X = 20;
const NODE_PAD_Y = 14;
const MIN_WIDTH = 70;
const MIN_HEIGHT = 40;

function nodeSize(label: string): { width: number; height: number } {
  const lines = label.split('\n');
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return {
    width: Math.max(MIN_WIDTH, longest * CHAR_WIDTH + NODE_PAD_X * 2),
    height: Math.max(MIN_HEIGHT, lines.length * LINE_HEIGHT + NODE_PAD_Y * 2),
  };
}

/** Longest-path rank from any source (in-degree 0) node; cycle-safe (bounded iteration). */
function computeRanks(diagram: FlowchartDiagram): Map<string, number> {
  const rank = new Map<string, number>(diagram.nodes.map((n) => [n.id, 0]));
  const guard = diagram.nodes.length + 1;
  for (let pass = 0; pass < guard; pass += 1) {
    let changed = false;
    for (const edge of diagram.edges) {
      const fromRank = rank.get(edge.from) ?? 0;
      const toRank = rank.get(edge.to) ?? 0;
      if (toRank < fromRank + 1) {
        rank.set(edge.to, fromRank + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

export function layoutFlowchart(diagram: FlowchartDiagram): FlowLayout {
  const ranks = computeRanks(diagram);
  const byRank = new Map<number, FlowNode[]>();
  for (const node of diagram.nodes) {
    const r = ranks.get(node.id) ?? 0;
    byRank.set(r, [...(byRank.get(r) ?? []), node]);
  }

  const horizontal = diagram.direction === 'LR' || diagram.direction === 'RL';
  const positioned = new Map<string, PositionedNode>();

  let rankCursor = 0;
  const maxRank = Math.max(0, ...Array.from(byRank.keys()));
  for (let r = 0; r <= maxRank; r += 1) {
    const laneNodes = byRank.get(r) ?? [];
    let laneCursor = 0;
    let rankExtent = 0;
    for (const node of laneNodes) {
      const size = nodeSize(node.label);
      const rankPos = rankCursor;
      const lanePos = laneCursor;
      positioned.set(node.id, {
        ...node,
        x: horizontal ? rankPos : lanePos,
        y: horizontal ? lanePos : rankPos,
        width: size.width,
        height: size.height,
      });
      laneCursor += (horizontal ? size.height : size.width) + LANE_GAP;
      rankExtent = Math.max(rankExtent, horizontal ? size.width : size.height);
    }
    rankCursor += rankExtent + RANK_GAP;
  }

  if (diagram.direction === 'BT' || diagram.direction === 'RL') {
    const axisMax = Math.max(
      0,
      ...Array.from(positioned.values()).map((n) =>
        diagram.direction === 'BT' ? n.y + n.height : n.x + n.width,
      ),
    );
    for (const node of positioned.values()) {
      if (diagram.direction === 'BT') node.y = axisMax - node.y - node.height;
      else node.x = axisMax - node.x - node.width;
    }
  }

  const nodes = Array.from(positioned.values());
  const edges: PositionedEdge[] = diagram.edges
    .map((e) => {
      const from = positioned.get(e.from);
      const to = positioned.get(e.to);
      if (!from || !to) return null;
      return { from, to, label: e.label, style: e.style };
    })
    .filter((e): e is PositionedEdge => e !== null);

  const PAD = 30;
  const subgraphs: SubgraphBounds[] = diagram.subgraphs
    .map((sg) => {
      const members = nodes.filter((n) => n.subgraphId === sg.id);
      if (members.length === 0) return null;
      const minX = Math.min(...members.map((n) => n.x)) - PAD;
      const minY = Math.min(...members.map((n) => n.y)) - PAD;
      const maxX = Math.max(...members.map((n) => n.x + n.width)) + PAD;
      const maxY = Math.max(...members.map((n) => n.y + n.height)) + PAD * 1.5;
      return {
        id: sg.id,
        label: sg.label,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    })
    .filter((s): s is SubgraphBounds => s !== null);

  const width =
    Math.max(
      1,
      ...nodes.map((n) => n.x + n.width),
      ...subgraphs.map((s) => s.x + s.width),
    ) + PAD;
  const height =
    Math.max(
      1,
      ...nodes.map((n) => n.y + n.height),
      ...subgraphs.map((s) => s.y + s.height),
    ) + PAD;

  return { nodes, edges, subgraphs, width, height };
}
