import type { Catalog } from '../catalog/catalog.js';
import type { AccessType, PlanNode } from '../trace/events.js';
import type { Plan, PlanOp } from './plan.js';
import { toPlanNode } from './plan.js';

/**
 * MySQL の `EXPLAIN` と同じ語彙で表現したプラン (DESIGN.md 4.2)。
 * plan-consistency テストはこの構造を実 MySQL の `EXPLAIN FORMAT=JSON` と突き合わせる。
 */
export interface ExplainRow {
  readonly id: number;
  readonly select_type: 'SIMPLE';
  readonly table: string;
  readonly access_type: AccessType;
  readonly possible_keys: readonly string[] | null;
  readonly key: string | null;
  readonly rows: number;
  readonly extra: string | null;
}

function hasFilter(op: PlanOp): boolean {
  if (op.op === 'Filter') return true;
  return 'child' in op ? hasFilter(op.child) : false;
}

export function explain(planResult: Plan): ExplainRow {
  const chosen = planResult.chosen;

  // possible_keys: WHERE から使える索引 (EXPLAIN と同じく、条件を持つものだけ)
  const possible = planResult.candidates
    .filter((c) => c.index !== null && c.condition !== null)
    .map((c) => c.index as string);

  const extras: string[] = [];
  if (hasFilter(planResult.root)) extras.push('Using where');
  if (chosen.accessType !== 'ALL' && chosen.covering && chosen.index !== 'PRIMARY') {
    extras.push('Using index');
  }

  return {
    id: 1,
    select_type: 'SIMPLE',
    table: planResult.table,
    access_type: chosen.accessType,
    possible_keys: possible.length > 0 ? possible : null,
    key: chosen.index,
    rows: chosen.estimatedRows,
    extra: extras.length > 0 ? extras.join('; ') : null,
  };
}

/** `EXPLAIN FORMAT=TREE` 風の文字列。根が一番上、子はインデントして下に並ぶ。 */
export function explainTree(planResult: Plan, catalog: Catalog): string {
  const render = (node: PlanNode, depth: number): string => {
    const indent = '    '.repeat(depth);
    const lines = [`${indent}-> ${node.label}`];
    for (const child of node.children) lines.push(render(child, depth + 1));
    return lines.join('\n');
  };
  return render(toPlanNode(planResult.root, catalog), 0);
}
