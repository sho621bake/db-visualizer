export const ENGINE_NAME = 'DB Visualizer Engine';

export { Catalog, type Row, type TableStats, type Value } from './catalog/catalog.js';
export { PRIMARY, TABLES, type TableDef } from './catalog/schema.js';
export { buildIterator, type ExecContext, type RowIterator } from './executor/executor.js';
export {
  type ColumnRef,
  type Predicate,
  type SelectStatement,
  UnsupportedSqlError,
} from './parser/ast.js';
export { parse } from './parser/parse.js';
export type { AccessPath } from './planner/access-path.js';
export { IO_COST, ROW_EVAL_COST } from './planner/cost.js';
export { type ExplainRow, explain, explainTree } from './planner/explain.js';
export { type Plan, type PlanOp, type PlanOptions, plan } from './planner/plan.js';
export { explainOnly, type RunOptions, type RunResult, run } from './run.js';
export { SCENARIOS, type Scenario, scenarioByFixture } from './scenarios.js';
export { BTree } from './storage/btree.js';
export { BUFFER_POOL_RATIO, BufferPool } from './storage/buffer-pool.js';
export { Database } from './storage/database.js';
export {
  compareKeys,
  INTERNAL_FANOUT,
  LEAF_ENTRIES,
  type Page,
  type PageId,
} from './storage/page.js';
export { TraceCollector } from './trace/collector.js';
export {
  type AccessType,
  M1_EVENT_TYPES,
  type PlanCandidate,
  type PlanNode,
  type StepEvent,
  type StepEventType,
  stepEventSchema,
  type Trace,
  traceSchema,
} from './trace/events.js';
