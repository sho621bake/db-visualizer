import type { Catalog, Row, Value } from '../catalog/catalog.js';
import { PRIMARY } from '../catalog/schema.js';
import { flattenAnd, type Predicate } from '../parser/ast.js';
import type { IndexCondition } from '../planner/access-path.js';
import type { PlanOp } from '../planner/plan.js';
import type { BTree } from '../storage/btree.js';
import type { BufferPool } from '../storage/buffer-pool.js';
import type { Database } from '../storage/database.js';
import { isLeaf, type KeyValue, type LeafPage, type PageId } from '../storage/page.js';
import type { TraceCollector } from '../trace/collector.js';

/** Volcano (iterator) モデル。DESIGN.md 4.3。 */
export interface RowIterator {
  readonly nodeId: string;
  open(): void;
  next(): Row | null;
  close(): void;
}

export interface ExecContext {
  readonly catalog: Catalog;
  readonly db: Database;
  readonly pool: BufferPool;
  readonly trace: TraceCollector;
  /** row.read の件数 = MySQL の rows_examined に相当。 */
  rowsExamined: number;
}

function compareValue(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** キーが索引条件の範囲に対して手前(-1) / 中(0) / 後ろ(1) のどこにあるか。 */
function compareToRange(key: KeyValue, condition: IndexCondition): -1 | 0 | 1 {
  for (let i = 0; i < condition.equality.length; i++) {
    const want = condition.equality[i];
    const got = key[i];
    if (want === undefined || got === undefined) return -1;
    const c = compareValue(got, want);
    if (c < 0) return -1;
    if (c > 0) return 1;
  }
  const rangeValue = key[condition.equality.length];
  if (rangeValue === undefined) return 0;
  if (condition.low) {
    const c = compareValue(rangeValue, condition.low.value);
    if (c < 0 || (c === 0 && !condition.low.inclusive)) return -1;
  }
  if (condition.high) {
    const c = compareValue(rangeValue, condition.high.value);
    if (c > 0 || (c === 0 && !condition.high.inclusive)) return 1;
  }
  return 0;
}

function startKeyOf(condition: IndexCondition): KeyValue {
  return condition.low ? [...condition.equality, condition.low.value] : condition.equality;
}

function endKeyOf(condition: IndexCondition): KeyValue | null {
  if (condition.high) return [...condition.equality, condition.high.value];
  return condition.equality.length > 0 ? condition.equality : null;
}

/** ルートからリーフへ降りる。各レベルで page.read と btree.descend を emit する。 */
function descendToLeaf(
  ctx: ExecContext,
  tree: BTree,
  nodeId: string,
  searchKey: KeyValue,
): LeafPage {
  const path = tree.descendPath(searchKey);
  let page = ctx.pool.read(path[0] as PageId, nodeId);
  for (const pageId of path) {
    // ルートから順に読み、読んだ結果を見て次の子を決める、という実際の順序で emit する
    page = pageId === path[0] ? page : ctx.pool.read(pageId, nodeId);
    ctx.trace.emit({
      type: 'btree.descend',
      nodeId,
      index: tree.index,
      level: page.level,
      pageId,
      searchKey: [...searchKey],
    });
  }
  if (!isLeaf(page)) throw new Error('descend がリーフに到達しませんでした');
  return page;
}

/** クラスタ索引 / セカンダリ索引のリーフを範囲走査する共通イテレータ。 */
class IndexScan implements RowIterator {
  private leaf: LeafPage | null = null;
  private cursor = 0;
  private done = false;

  constructor(
    readonly nodeId: string,
    private readonly ctx: ExecContext,
    private readonly tree: BTree,
    private readonly condition: IndexCondition,
    private readonly indexColumns: readonly string[],
    private readonly table: string,
    /** カバリングでないセカンダリ走査は行本体を持たないので row.read を出さない。 */
    private readonly covering: boolean,
  ) {}

  open(): void {
    this.leaf = descendToLeaf(this.ctx, this.tree, this.nodeId, startKeyOf(this.condition));
    this.emitLeafScan();
    this.cursor = 0;
    this.done = false;
  }

  next(): Row | null {
    while (!this.done && this.leaf) {
      const entry = this.leaf.entries[this.cursor];
      if (entry === undefined) {
        const nextId = this.leaf.next;
        if (!nextId) {
          this.done = true;
          return null;
        }
        const page = this.ctx.pool.read(nextId, this.nodeId);
        if (!isLeaf(page)) throw new Error('リーフ連結が壊れています');
        this.leaf = page;
        this.cursor = 0;
        this.emitLeafScan();
        continue;
      }
      this.cursor += 1;

      const position = compareToRange(entry.key, this.condition);
      if (position < 0) continue;
      if (position > 0) {
        this.done = true;
        return null;
      }

      const row =
        'row' in entry
          ? entry.row
          : (Object.fromEntries([
              ...this.indexColumns.map((c, i) => [c, entry.key[i] as Value]),
              [this.ctx.catalog.table(this.table).primaryKey, entry.pk],
            ]) as Row);

      const pk = row[this.ctx.catalog.table(this.table).primaryKey] as Value;
      // rows_examined はアクセスパスが触った行数。戻り (ClusteredLookup) では数えない。
      this.ctx.rowsExamined += 1;
      if ('row' in entry || this.covering) {
        this.ctx.trace.emit({ type: 'row.read', nodeId: this.nodeId, table: this.table, pk });
      }
      return row;
    }
    return null;
  }

  close(): void {
    this.leaf = null;
    this.done = true;
  }

  private emitLeafScan(): void {
    if (!this.leaf) return;
    const from = startKeyOf(this.condition);
    const to = endKeyOf(this.condition);
    this.ctx.trace.emit({
      type: 'btree.leaf.scan',
      nodeId: this.nodeId,
      index: this.tree.index,
      pageId: this.leaf.id,
      fromKey: from.length > 0 ? [...from] : null,
      toKey: to ? [...to] : null,
    });
  }
}

/** クラスタ索引のリーフを左から右へ全件走査する (EXPLAIN の `ALL`)。 */
class TableScan implements RowIterator {
  private leafIds: readonly PageId[] = [];
  private leafIndex = 0;
  private cursor = 0;
  private leaf: LeafPage | null = null;

  constructor(
    readonly nodeId: string,
    private readonly ctx: ExecContext,
    private readonly tree: BTree,
    private readonly table: string,
  ) {}

  open(): void {
    this.leafIds = this.tree.leafIdsInOrder();
    this.leafIndex = 0;
    this.cursor = 0;
    this.leaf = null;
  }

  next(): Row | null {
    for (;;) {
      if (!this.leaf) {
        const id = this.leafIds[this.leafIndex];
        if (id === undefined) return null;
        const page = this.ctx.pool.read(id, this.nodeId);
        if (!isLeaf(page)) throw new Error('リーフでないページを走査しました');
        this.leaf = page;
        this.cursor = 0;
        this.ctx.trace.emit({
          type: 'btree.leaf.scan',
          nodeId: this.nodeId,
          index: this.tree.index,
          pageId: page.id,
          fromKey: null,
          toKey: null,
        });
      }
      const entry = this.leaf.entries[this.cursor];
      if (entry === undefined) {
        this.leaf = null;
        this.leafIndex += 1;
        continue;
      }
      this.cursor += 1;
      if (!('row' in entry)) throw new Error('クラスタ索引のリーフではありません');
      const pk = entry.row[this.ctx.catalog.table(this.table).primaryKey] as Value;
      this.ctx.rowsExamined += 1;
      this.ctx.trace.emit({ type: 'row.read', nodeId: this.nodeId, table: this.table, pk });
      return entry.row;
    }
  }

  close(): void {
    this.leaf = null;
  }
}

/** セカンダリ索引の結果からクラスタ索引へ「戻る」。可視化の中心 (DESIGN.md 4.1)。 */
class ClusteredLookup implements RowIterator {
  constructor(
    readonly nodeId: string,
    private readonly ctx: ExecContext,
    private readonly child: RowIterator,
    private readonly table: string,
    private readonly from: string,
  ) {}

  open(): void {
    this.child.open();
  }

  next(): Row | null {
    const entry = this.child.next();
    if (!entry) return null;
    const pkColumn = this.ctx.catalog.table(this.table).primaryKey;
    const pk = entry[pkColumn] as Value;
    this.ctx.trace.emit({
      type: 'clustered.lookup',
      nodeId: this.nodeId,
      table: this.table,
      pk,
      from: this.from,
    });
    const tree = this.ctx.db.tree(this.table, PRIMARY);
    const leaf = descendToLeaf(this.ctx, tree, this.nodeId, [pk]);
    const hit = leaf.entries.find((e) => compareValue(e.key[0] as Value, pk) === 0);
    if (!hit || !('row' in hit)) throw new Error(`PK ${String(pk)} の行が見つかりません`);
    this.ctx.trace.emit({ type: 'row.read', nodeId: this.nodeId, table: this.table, pk });
    return hit.row;
  }

  close(): void {
    this.child.close();
  }
}

class Filter implements RowIterator {
  constructor(
    readonly nodeId: string,
    private readonly ctx: ExecContext,
    private readonly child: RowIterator,
    private readonly predicates: readonly Predicate[],
    private readonly pkColumn: string,
  ) {}

  open(): void {
    this.child.open();
  }

  next(): Row | null {
    for (;;) {
      const row = this.child.next();
      if (!row) return null;
      const passed = this.predicates.every((p) => evaluate(p, row));
      this.ctx.trace.emit({
        type: 'filter.eval',
        nodeId: this.nodeId,
        pk: row[this.pkColumn] as Value,
        passed,
      });
      if (passed) return row;
    }
  }

  close(): void {
    this.child.close();
  }
}

class Projection implements RowIterator {
  constructor(
    readonly nodeId: string,
    private readonly child: RowIterator,
    private readonly columns: readonly string[] | null,
  ) {}

  open(): void {
    this.child.open();
  }

  next(): Row | null {
    const row = this.child.next();
    if (!row) return null;
    if (!this.columns) return row;
    const out: Record<string, Value> = {};
    for (const c of this.columns) out[c] = row[c] as Value;
    return out;
  }

  close(): void {
    this.child.close();
  }
}

class Limit implements RowIterator {
  private produced = 0;

  constructor(
    readonly nodeId: string,
    private readonly child: RowIterator,
    private readonly count: number,
  ) {}

  open(): void {
    this.produced = 0;
    this.child.open();
  }

  next(): Row | null {
    // LIMIT の早期終了: 上限に達したら子を進めない (FIDELITY.md)
    if (this.produced >= this.count) return null;
    const row = this.child.next();
    if (!row) return null;
    this.produced += 1;
    return row;
  }

  close(): void {
    this.child.close();
  }
}

function evaluate(predicate: Predicate, row: Row): boolean {
  switch (predicate.kind) {
    case 'and':
      return evaluate(predicate.left, row) && evaluate(predicate.right, row);
    case 'compare': {
      const v = row[predicate.column.column];
      if (v === undefined) return false;
      const c = compareValue(v, predicate.value);
      switch (predicate.op) {
        case '=':
          return c === 0;
        case '<':
          return c < 0;
        case '<=':
          return c <= 0;
        case '>':
          return c > 0;
        case '>=':
          return c >= 0;
      }
      return false;
    }
    case 'between': {
      const v = row[predicate.column.column];
      if (v === undefined) return false;
      return compareValue(v, predicate.low) >= 0 && compareValue(v, predicate.high) <= 0;
    }
  }
}

/** PlanOp の木からイテレータの木を組み立てる。 */
export function buildIterator(op: PlanOp, ctx: ExecContext): RowIterator {
  switch (op.op) {
    case 'TableScan':
      return new TableScan(op.id, ctx, ctx.db.tree(op.table, PRIMARY), op.table);
    case 'IndexRangeScan':
    case 'IndexLookup': {
      const table = ctx.catalog.table(op.table);
      const columns =
        op.index === PRIMARY
          ? [table.primaryKey]
          : (table.indexes.find((i) => i.name === op.index)?.columns ?? []);
      return new IndexScan(
        op.id,
        ctx,
        ctx.db.tree(op.table, op.index),
        op.condition,
        columns,
        op.table,
        op.covering,
      );
    }
    case 'ClusteredLookup':
      return new ClusteredLookup(op.id, ctx, buildIterator(op.child, ctx), op.table, op.from);
    case 'Filter': {
      const table = tableOf(op.child, ctx);
      return new Filter(
        op.id,
        ctx,
        buildIterator(op.child, ctx),
        op.predicates.flatMap((p) => flattenAnd(p)),
        ctx.catalog.table(table).primaryKey,
      );
    }
    case 'Projection':
      return new Projection(
        op.id,
        buildIterator(op.child, ctx),
        op.columns === 'all' ? null : op.columns.map((c) => c.column),
      );
    case 'Limit':
      return new Limit(op.id, buildIterator(op.child, ctx), op.count);
  }
}

function tableOf(op: PlanOp, ctx: ExecContext): string {
  if ('table' in op) return op.table;
  if ('child' in op) return tableOf(op.child, ctx);
  throw new Error('テーブルを特定できません');
}
