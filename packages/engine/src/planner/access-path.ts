import type { Catalog, Row, Value } from '../catalog/catalog.js';
import { type IndexDef, PRIMARY, type TableDef } from '../catalog/schema.js';
import { flattenAnd, type Predicate, type SelectStatement } from '../parser/ast.js';
import type { AccessType } from '../trace/events.js';

export interface RangeBound {
  readonly value: Value;
  readonly inclusive: boolean;
}

/**
 * 索引に押し込める条件。先頭から連続する等値条件と、その次の列への範囲条件まで。
 * MySQL の「使えるキー部は先頭から連続する等値 + 最後に1つの範囲」と同じ規則。
 */
export interface IndexCondition {
  readonly equality: readonly Value[];
  readonly low?: RangeBound;
  readonly high?: RangeBound;
  /** 使ったキー部の数 (EXPLAIN の used_key_parts に相当)。 */
  readonly usedKeyParts: number;
  /** 索引が吸収した述語。残りは Filter ノードで評価する。 */
  readonly consumed: readonly Predicate[];
}

export interface AccessPath {
  readonly table: string;
  readonly accessType: AccessType;
  /** ALL のときだけ null。 */
  readonly index: string | null;
  readonly covering: boolean;
  readonly condition: IndexCondition | null;
  readonly estimatedRows: number;
  readonly cost: number;
  readonly reason: string;
}

const columnName = (p: Predicate): string => (p.kind === 'and' ? '' : p.column.column);

/** SELECT 文が参照する全列 (カバリング判定に使う)。'all' なら null を返す。 */
export function referencedColumns(
  stmt: SelectStatement,
  table: TableDef,
): readonly string[] | null {
  if (stmt.columns === 'all') return null;
  const names = new Set<string>();
  for (const c of stmt.columns) names.add(c.column);
  for (const p of flattenAnd(stmt.where)) names.add(columnName(p));
  if (stmt.orderBy) names.add(stmt.orderBy.column.column);
  for (const n of names) {
    if (!table.columns.some((c) => c.name === n)) {
      throw new Error(`未対応: 列 ${table.name}.${n} は存在しません`);
    }
  }
  return [...names];
}

/**
 * セカンダリ索引がクエリをカバーするか。
 * InnoDB のセカンダリ索引は PK を暗黙に持つので、PK も「索引に含まれる列」に数える。
 */
export function isCovering(
  index: IndexDef,
  table: TableDef,
  referenced: readonly string[] | null,
): boolean {
  if (referenced === null) return false;
  const available = new Set<string>([...index.columns, table.primaryKey]);
  return referenced.every((c) => available.has(c));
}

/** 索引の先頭から連続する等値条件と、その次の範囲条件を拾う。 */
export function buildIndexCondition(
  columns: readonly string[],
  predicates: readonly Predicate[],
): IndexCondition | null {
  const equality: Value[] = [];
  const consumed: Predicate[] = [];
  let low: RangeBound | undefined;
  let high: RangeBound | undefined;

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col === undefined) break;
    const eq = predicates.find(
      (p) =>
        p.kind === 'compare' && p.op === '=' && p.column.column === col && !consumed.includes(p),
    );
    if (eq && eq.kind === 'compare') {
      equality.push(eq.value);
      consumed.push(eq);
      continue;
    }
    // 等値が途切れた列に範囲条件があれば、そこまでを使う
    for (const p of predicates) {
      if (consumed.includes(p)) continue;
      if (p.kind === 'between' && p.column.column === col) {
        low = { value: p.low, inclusive: true };
        high = { value: p.high, inclusive: true };
        consumed.push(p);
      } else if (p.kind === 'compare' && p.column.column === col && p.op !== '=') {
        if (p.op === '>' || p.op === '>=') low = { value: p.value, inclusive: p.op === '>=' };
        else high = { value: p.value, inclusive: p.op === '<=' };
        consumed.push(p);
      }
    }
    break;
  }

  if (equality.length === 0 && !low && !high) return null;
  const usedKeyParts = equality.length + (low || high ? 1 : 0);
  return {
    equality,
    ...(low ? { low } : {}),
    ...(high ? { high } : {}),
    usedKeyParts,
    consumed,
  };
}

/** 索引条件に行が合致するか (index dive による行数見積もりと実行の双方で使う)。 */
export function rowMatchesCondition(
  row: Row,
  columns: readonly string[],
  condition: IndexCondition,
): boolean {
  for (let i = 0; i < condition.equality.length; i++) {
    const col = columns[i];
    const want = condition.equality[i];
    if (col === undefined || want === undefined) return false;
    if (row[col] !== want) return false;
  }
  const rangeCol = columns[condition.equality.length];
  if (rangeCol === undefined) return true;
  const v = row[rangeCol];
  if (v === undefined) return false;
  if (condition.low) {
    const c = compare(v, condition.low.value);
    if (condition.low.inclusive ? c < 0 : c <= 0) return false;
  }
  if (condition.high) {
    const c = compare(v, condition.high.value);
    if (condition.high.inclusive ? c > 0 : c >= 0) return false;
  }
  return true;
}

function compare(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * 索引条件に合致する行数。MySQL の range optimizer と同じく index dive で実数を数える
 * (eq_range_index_dive_limit の既定 200 の範囲では MySQL も実数を返す)。
 */
export function diveRowCount(
  catalog: Catalog,
  tableName: string,
  columns: readonly string[],
  condition: IndexCondition,
): number {
  let n = 0;
  for (const row of catalog.rows(tableName)) {
    if (rowMatchesCondition(row, columns, condition)) n += 1;
  }
  return n;
}

/** この索引条件が返しうる行が高々1行か (UNIQUE 索引の全キー部が等値)。 */
export function isUniqueLookup(index: IndexDef, condition: IndexCondition): boolean {
  return (
    index.unique &&
    condition.equality.length === index.columns.length &&
    !condition.low &&
    !condition.high
  );
}

export function primaryIndexDef(table: TableDef): IndexDef {
  return { name: PRIMARY, columns: [table.primaryKey], unique: true };
}
