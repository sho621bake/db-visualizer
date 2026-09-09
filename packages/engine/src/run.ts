import { Catalog, type Row } from './catalog/catalog.js';
import { buildIterator, type ExecContext } from './executor/executor.js';
import { type ExplainRow, explain, explainTree } from './planner/explain.js';
import { type Plan, type PlanOptions, plan, toPlanCandidates, toPlanNode } from './planner/plan.js';
import { BufferPool } from './storage/buffer-pool.js';
import { Database } from './storage/database.js';
import { TraceCollector } from './trace/collector.js';
import type { Trace } from './trace/events.js';

export interface RunOptions extends PlanOptions {
  /** バッファプール容量 (ページ数)。既定は総ページ数の 25%。 */
  readonly bufferPoolCapacity?: number;
}

export interface RunResult {
  readonly sql: string;
  readonly plan: Plan;
  readonly explain: ExplainRow;
  readonly explainTree: string;
  readonly rows: readonly Row[];
  readonly trace: Trace;
}

/**
 * SQL 1本を最後まで実行し、Trace を全件生成して返す。
 * ストリーミングしないのは、スクラブ (任意位置へのジャンプ) を O(1) にするため
 * (DESIGN.md 3)。
 */
export function run(sql: string, options: RunOptions = {}): RunResult {
  const catalog = Catalog.default();
  const db = Database.build(catalog);
  const trace = new TraceCollector();
  const pool = new BufferPool(db, trace, options.bufferPoolCapacity);

  const planned = plan(sql, catalog, db, options);
  const root = planned.root;

  trace.emit({
    type: 'plan.selected',
    nodeId: root.id,
    planTree: toPlanNode(root, catalog),
    candidates: [...toPlanCandidates(planned)],
  });

  const ctx: ExecContext = { catalog, db, pool, trace, rowsExamined: 0 };
  const iterator = buildIterator(root, ctx);

  const rows: Row[] = [];
  iterator.open();
  try {
    for (;;) {
      const row = iterator.next();
      if (!row) break;
      rows.push(row);
      trace.emit({ type: 'row.emit', nodeId: root.id, row });
    }
  } finally {
    iterator.close();
  }

  const stats = pool.stats;
  trace.emit({
    type: 'stats',
    nodeId: root.id,
    pagesRead: stats.pagesRead,
    diskReads: stats.diskReads,
    rowsExamined: ctx.rowsExamined,
    rowsReturned: rows.length,
  });

  return {
    sql,
    plan: planned,
    explain: explain(planned),
    explainTree: explainTree(planned, catalog),
    rows,
    trace: trace.toTrace(),
  };
}

/** 実行せずにプランと EXPLAIN だけを得る (plan-consistency テスト用)。 */
export function explainOnly(sql: string, options: PlanOptions = {}): ExplainRow {
  const catalog = Catalog.default();
  const db = Database.build(catalog);
  return explain(plan(sql, catalog, db, options));
}
