import type { Catalog, Value } from '../catalog/catalog.js';
import { type IndexDef, PRIMARY, type TableDef } from '../catalog/schema.js';
import {
  type ColumnRef,
  flattenAnd,
  type Predicate,
  type SelectStatement,
  UnsupportedSqlError,
} from '../parser/ast.js';
import { parse } from '../parser/parse.js';
import type { Database } from '../storage/database.js';
import type { AccessType, PlanCandidate, PlanNode } from '../trace/events.js';
import {
  type AccessPath,
  buildIndexCondition,
  diveRowCount,
  type IndexCondition,
  isCovering,
  isUniqueLookup,
  primaryIndexDef,
  referencedColumns,
} from './access-path.js';
import { estimateCost } from './cost.js';

export interface PlanOptions {
  /**
   * 使わせない索引。MySQL の `IGNORE INDEX (...)` ヒントに対応する
   * (ヒント構文はサポート範囲 DESIGN.md 9 に持ち込まない。FIDELITY.md 参照)。
   */
  readonly ignoreIndexes?: readonly string[];
}

/** 実行可能なプラン木。executor と PlanNode シリアライズの両方がこれを読む。 */
export type PlanOp =
  | { readonly id: string; readonly op: 'TableScan'; readonly table: string; readonly rows: number }
  | {
      readonly id: string;
      readonly op: 'IndexRangeScan' | 'IndexLookup';
      readonly table: string;
      readonly index: string;
      readonly accessType: AccessType;
      readonly condition: IndexCondition;
      readonly covering: boolean;
      readonly rows: number;
    }
  | {
      readonly id: string;
      readonly op: 'ClusteredLookup';
      readonly table: string;
      readonly from: string;
      readonly child: PlanOp;
    }
  | {
      readonly id: string;
      readonly op: 'Filter';
      readonly predicates: readonly Predicate[];
      readonly child: PlanOp;
    }
  | {
      readonly id: string;
      readonly op: 'Projection';
      readonly columns: 'all' | readonly ColumnRef[];
      readonly child: PlanOp;
    }
  | { readonly id: string; readonly op: 'Limit'; readonly count: number; readonly child: PlanOp };

export interface Plan {
  readonly sql: string;
  readonly statement: SelectStatement;
  readonly table: string;
  readonly chosen: AccessPath;
  readonly candidates: readonly AccessPath[];
  readonly root: PlanOp;
}

function candidateReason(path: AccessPath): string {
  switch (path.accessType) {
    case 'ALL':
      return 'クラスタ索引のリーフを全件走査する';
    case 'index':
      return 'セカンダリ索引のリーフだけを全件走査する (カバリング)';
    case 'const':
      return 'UNIQUE 索引の全キー部が定数で決まるため高々1行';
    case 'eq_ref':
      return '外側の1行につき内部表から高々1行';
    case 'ref':
      return '等値条件で索引を引く';
    case 'range':
      return '範囲条件で索引のリーフを部分走査する';
  }
}

function buildCandidate(
  catalog: Catalog,
  db: Database,
  table: TableDef,
  index: IndexDef,
  condition: IndexCondition | null,
  referenced: readonly string[] | null,
): AccessPath | null {
  const isPrimary = index.name === PRIMARY;
  // クラスタ索引のリーフは行本体を持つので常にカバリング扱い
  const covering = isPrimary || isCovering(index, table, referenced);
  const clusteredHeight = db.tree(table.name, PRIMARY).height;
  const stats = catalog.stats(table.name);

  if (!condition) {
    // 条件が無くてもカバリングなら索引フルスキャン (EXPLAIN の `index`) が候補になる
    if (isPrimary || !covering) return null;
    const height = db.tree(table.name, index.name).height;
    const rows = stats.rowCount;
    const { cost } = estimateCost({
      accessType: 'index',
      indexHeight: height,
      clusteredHeight,
      tableRows: stats.rowCount,
      estimatedRows: rows,
      covering: true,
    });
    const path: AccessPath = {
      table: table.name,
      accessType: 'index',
      index: index.name,
      covering: true,
      condition: null,
      estimatedRows: rows,
      cost,
      reason: '',
    };
    return { ...path, reason: candidateReason(path) };
  }

  const accessType: AccessType = isUniqueLookup(index, condition)
    ? 'const'
    : condition.low || condition.high
      ? 'range'
      : 'ref';

  const rows =
    accessType === 'const'
      ? Math.min(1, diveRowCount(catalog, table.name, index.columns, condition))
      : diveRowCount(catalog, table.name, index.columns, condition);

  const height = db.tree(table.name, index.name).height;
  const { cost } = estimateCost({
    accessType,
    indexHeight: height,
    clusteredHeight,
    tableRows: stats.rowCount,
    estimatedRows: rows,
    covering,
  });

  const path: AccessPath = {
    table: table.name,
    accessType,
    index: index.name,
    covering,
    condition,
    estimatedRows: rows,
    cost,
    reason: '',
  };
  return { ...path, reason: candidateReason(path) };
}

/** 候補アクセスパスを列挙する。順序は決定論的 (ALL → PRIMARY → 定義順のセカンダリ)。 */
export function enumerateAccessPaths(
  catalog: Catalog,
  db: Database,
  stmt: SelectStatement,
  options: PlanOptions,
): readonly AccessPath[] {
  const table = catalog.table(stmt.from.table);
  const referenced = referencedColumns(stmt, table);
  const predicates = flattenAnd(stmt.where);
  const stats = catalog.stats(table.name);
  const ignored = new Set(options.ignoreIndexes ?? []);

  const clusteredHeight = db.tree(table.name, PRIMARY).height;
  const all: AccessPath = (() => {
    const { cost } = estimateCost({
      accessType: 'ALL',
      indexHeight: clusteredHeight,
      clusteredHeight,
      tableRows: stats.rowCount,
      estimatedRows: stats.rowCount,
      covering: true,
    });
    const base: AccessPath = {
      table: table.name,
      accessType: 'ALL',
      index: null,
      covering: false,
      condition: null,
      estimatedRows: stats.rowCount,
      cost,
      reason: '',
    };
    return { ...base, reason: candidateReason(base) };
  })();

  const paths: AccessPath[] = [all];

  const indexes: IndexDef[] = [primaryIndexDef(table), ...table.indexes];
  for (const index of indexes) {
    if (ignored.has(index.name)) continue;
    const condition = buildIndexCondition(index.columns, predicates);
    const candidate = buildCandidate(catalog, db, table, index, condition, referenced);
    if (candidate) paths.push(candidate);
  }
  return paths;
}

function residualPredicates(
  predicates: readonly Predicate[],
  path: AccessPath,
): readonly Predicate[] {
  // range と ALL は MySQL も条件を再評価する (EXPLAIN の "Using where")
  if (path.accessType === 'ALL' || path.accessType === 'index' || path.accessType === 'range') {
    return predicates;
  }
  const consumed = path.condition?.consumed ?? [];
  return predicates.filter((p) => !consumed.includes(p));
}

/** ORDER BY が選ばれたアクセスパスの走査順で満たされるか。 */
function orderSatisfiedByPath(stmt: SelectStatement, table: TableDef, path: AccessPath): boolean {
  if (!stmt.orderBy) return true;
  if (stmt.orderBy.direction !== 'ASC') return false;
  const col = stmt.orderBy.column.column;
  if (path.accessType === 'ALL') return col === table.primaryKey;
  if (!path.index) return false;
  if (path.index === PRIMARY) return col === table.primaryKey;
  const index = table.indexes.find((i) => i.name === path.index);
  if (!index) return false;
  // 等値で固定されたキー部の次の列が ORDER BY の列なら索引順で出てくる
  const fixed = path.condition?.equality.length ?? 0;
  return index.columns[fixed] === col || index.columns[0] === col;
}

function buildOps(stmt: SelectStatement, table: TableDef, path: AccessPath): PlanOp {
  let counter = 0;
  const nextId = () => `n${++counter}`;

  let node: PlanOp;
  if (path.accessType === 'ALL') {
    node = { id: nextId(), op: 'TableScan', table: table.name, rows: path.estimatedRows };
  } else if (path.index === PRIMARY) {
    if (!path.condition) throw new Error('クラスタ索引アクセスに条件がありません');
    node = {
      id: nextId(),
      op: path.accessType === 'range' ? 'IndexRangeScan' : 'IndexLookup',
      table: table.name,
      index: PRIMARY,
      accessType: path.accessType,
      condition: path.condition,
      covering: true,
      rows: path.estimatedRows,
    };
  } else {
    const index = path.index;
    if (!index) throw new Error('索引名がありません');
    if (path.accessType === 'index') {
      // 索引フルスキャンは条件なしの range として扱う (走査範囲が索引全体)
      node = {
        id: nextId(),
        op: 'IndexRangeScan',
        table: table.name,
        index,
        accessType: 'index',
        condition: { equality: [], usedKeyParts: 0, consumed: [] },
        covering: true,
        rows: path.estimatedRows,
      };
    } else {
      if (!path.condition) throw new Error('索引アクセスに条件がありません');
      node = {
        id: nextId(),
        op: path.accessType === 'range' ? 'IndexRangeScan' : 'IndexLookup',
        table: table.name,
        index,
        accessType: path.accessType,
        condition: path.condition,
        covering: path.covering,
        rows: path.estimatedRows,
      };
    }
    if (!path.covering) {
      node = { id: nextId(), op: 'ClusteredLookup', table: table.name, from: index, child: node };
    }
  }

  const residual = residualPredicates(flattenAnd(stmt.where), path);
  if (residual.length > 0) {
    node = { id: nextId(), op: 'Filter', predicates: residual, child: node };
  }

  node = { id: nextId(), op: 'Projection', columns: stmt.columns, child: node };

  if (stmt.limit !== undefined) {
    node = { id: nextId(), op: 'Limit', count: stmt.limit, child: node };
  }
  return node;
}

/** SQL からプランを作る。SQL 文字列でも解析済み AST でも受け取れる。 */
export function plan(sql: string, catalog: Catalog, db: Database, options: PlanOptions = {}): Plan {
  const statement = parse(sql);
  const table = catalog.table(statement.from.table);
  const candidates = enumerateAccessPaths(catalog, db, statement, options);

  let chosen = candidates[0];
  if (!chosen) throw new Error('アクセスパス候補がありません');
  for (const c of candidates) {
    if (c.cost < chosen.cost) chosen = c;
  }

  if (!orderSatisfiedByPath(statement, table, chosen)) {
    throw new UnsupportedSqlError('索引順で満たせない ORDER BY (filesort は M3 で対応予定)');
  }

  return {
    sql,
    statement,
    table: table.name,
    chosen,
    candidates,
    root: buildOps(statement, table, chosen),
  };
}

/** Trace に載せる候補一覧 (DESIGN.md 4.2 の候補比較パネル用)。 */
export function toPlanCandidates(planResult: Plan): readonly PlanCandidate[] {
  return planResult.candidates.map((c) => ({
    table: c.table,
    accessType: c.accessType,
    index: c.index,
    covering: c.covering,
    estimatedRows: c.estimatedRows,
    cost: Math.round(c.cost * 100) / 100,
    chosen: c === planResult.chosen,
    reason: c.reason,
  }));
}

function describeCondition(condition: IndexCondition, columns: readonly string[]): string {
  const parts: string[] = [];
  condition.equality.forEach((v, i) => {
    parts.push(`${columns[i]} = ${formatValue(v)}`);
  });
  const rangeCol = columns[condition.equality.length];
  if (rangeCol && (condition.low || condition.high)) {
    const lo = condition.low
      ? `${formatValue(condition.low.value)} ${condition.low.inclusive ? '<=' : '<'} `
      : '';
    const hi = condition.high
      ? ` ${condition.high.inclusive ? '<=' : '<'} ${formatValue(condition.high.value)}`
      : '';
    parts.push(`${lo}${rangeCol}${hi}`);
  }
  return parts.join(' AND ');
}

function formatValue(v: Value): string {
  return typeof v === 'number' ? String(v) : `'${v}'`;
}

export function formatPredicate(p: Predicate): string {
  switch (p.kind) {
    case 'and':
      return `${formatPredicate(p.left)} AND ${formatPredicate(p.right)}`;
    case 'between':
      return `${p.column.column} BETWEEN ${formatValue(p.low)} AND ${formatValue(p.high)}`;
    case 'compare':
      return `${p.column.column} ${p.op} ${formatValue(p.value)}`;
  }
}

/** PlanOp を Trace 用の PlanNode (zod スキーマ) に変換する。 */
export function toPlanNode(op: PlanOp, catalog: Catalog): PlanNode {
  switch (op.op) {
    case 'TableScan':
      return {
        id: op.id,
        op: 'TableScan',
        label: `Table scan on ${op.table}`,
        table: op.table,
        accessType: 'ALL',
        estimatedRows: op.rows,
        children: [],
      };
    case 'IndexRangeScan':
    case 'IndexLookup': {
      const columns =
        op.index === PRIMARY
          ? [catalog.table(op.table).primaryKey]
          : (catalog.table(op.table).indexes.find((i) => i.name === op.index)?.columns ?? []);
      const desc = describeCondition(op.condition, columns);
      const kind = op.covering ? 'Covering index' : 'Index';
      const verb = op.op === 'IndexRangeScan' ? 'range scan' : 'lookup';
      return {
        id: op.id,
        op: op.op,
        label: `${kind} ${verb} on ${op.table} using ${op.index}${desc ? ` over (${desc})` : ''}`,
        table: op.table,
        index: op.index,
        accessType: op.accessType,
        covering: op.covering,
        estimatedRows: op.rows,
        children: [],
      };
    }
    case 'ClusteredLookup':
      return {
        id: op.id,
        op: 'ClusteredLookup',
        label: `Clustered index lookup on ${op.table} (from ${op.from})`,
        table: op.table,
        index: PRIMARY,
        children: [toPlanNode(op.child, catalog)],
      };
    case 'Filter':
      return {
        id: op.id,
        op: 'Filter',
        label: `Filter: (${op.predicates.map(formatPredicate).join(' AND ')})`,
        children: [toPlanNode(op.child, catalog)],
      };
    case 'Projection':
      return {
        id: op.id,
        op: 'Projection',
        label: `Projection: ${op.columns === 'all' ? '*' : op.columns.map((c) => c.column).join(', ')}`,
        children: [toPlanNode(op.child, catalog)],
      };
    case 'Limit':
      return {
        id: op.id,
        op: 'Limit',
        label: `Limit: ${op.count}`,
        children: [toPlanNode(op.child, catalog)],
      };
  }
}
