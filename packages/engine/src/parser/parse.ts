// 既定のエントリは全方言 (約3MB) を読み込む。DESIGN.md 2 のとおり MySQL 方言しか使わないので、
// ブラウザに載せるぶんを削るため MySQL 専用ビルドを直接指す。
import pkg from 'node-sql-parser/build/mysql.js';
import type { Value } from '../catalog/catalog.js';
import {
  type ColumnRef,
  type CompareOp,
  type OrderBy,
  type Predicate,
  type SelectStatement,
  UnsupportedSqlError,
} from './ast.js';

// node-sql-parser は CJS。ESM からは default 経由で取る。
const { Parser } = pkg;

/** node-sql-parser の生 AST。形は実測 (tools/mysql で確認) に基づく。 */
type RawNode = Record<string, unknown>;

const COMPARE_OPS: readonly string[] = ['=', '<', '<=', '>', '>='];

function asNode(value: unknown): RawNode {
  if (typeof value !== 'object' || value === null)
    throw new UnsupportedSqlError('解釈できない構文');
  return value as RawNode;
}

function literalValue(node: unknown): Value {
  const n = asNode(node);
  switch (n.type) {
    case 'number':
      return n.value as number;
    case 'single_quote_string':
    case 'double_quote_string':
    case 'string':
      return n.value as string;
    case 'column_ref':
      throw new UnsupportedSqlError('列同士の比較 (JOIN 条件以外)');
    default:
      throw new UnsupportedSqlError(`リテラルでない値 (${String(n.type)})`);
  }
}

function columnRef(node: unknown): ColumnRef {
  const n = asNode(node);
  if (n.type !== 'column_ref') throw new UnsupportedSqlError('列参照でない式');
  const table = n.table;
  const column = n.column;
  if (typeof column !== 'string') throw new UnsupportedSqlError('列名を解釈できません');
  return typeof table === 'string' ? { qualifier: table, column } : { column };
}

function convertWhere(node: unknown): Predicate {
  const n = asNode(node);
  if (n.type !== 'binary_expr') throw new UnsupportedSqlError('WHERE の式');
  const operator = String(n.operator).toUpperCase();

  if (operator === 'AND') {
    return { kind: 'and', left: convertWhere(n.left), right: convertWhere(n.right) };
  }
  if (operator === 'OR') throw new UnsupportedSqlError('OR 条件');
  if (operator === 'IN' || operator === 'NOT IN') throw new UnsupportedSqlError('IN 条件');
  if (operator === 'LIKE' || operator === 'NOT LIKE') throw new UnsupportedSqlError('LIKE 条件');
  if (operator === 'IS' || operator === 'IS NOT') throw new UnsupportedSqlError('NULL 判定');
  if (operator === '!=' || operator === '<>') throw new UnsupportedSqlError('不等号 (<>) 条件');

  if (operator === 'BETWEEN') {
    const list = asNode(n.right);
    const values = list.value;
    if (!Array.isArray(values) || values.length !== 2) {
      throw new UnsupportedSqlError('BETWEEN の範囲指定');
    }
    return {
      kind: 'between',
      column: columnRef(n.left),
      low: literalValue(values[0]),
      high: literalValue(values[1]),
    };
  }
  if (operator === 'NOT BETWEEN') throw new UnsupportedSqlError('NOT BETWEEN 条件');

  if (COMPARE_OPS.includes(operator)) {
    return {
      kind: 'compare',
      op: operator as CompareOp,
      column: columnRef(n.left),
      value: literalValue(n.right),
    };
  }
  throw new UnsupportedSqlError(`演算子 ${operator}`);
}

function convertColumns(raw: unknown): 'all' | readonly ColumnRef[] {
  if (!Array.isArray(raw)) throw new UnsupportedSqlError('選択列リスト');
  const out: ColumnRef[] = [];
  for (const item of raw) {
    const entry = asNode(item);
    if (entry.as != null) throw new UnsupportedSqlError('列のエイリアス (AS)');
    const expr = asNode(entry.expr);
    if (expr.type !== 'column_ref') throw new UnsupportedSqlError('関数・式を含む選択列');
    if (expr.column === '*') {
      if (raw.length !== 1) throw new UnsupportedSqlError('* と列名の混在');
      return 'all';
    }
    out.push(columnRef(expr));
  }
  if (out.length === 0) throw new UnsupportedSqlError('空の選択列リスト');
  return out;
}

function convertOrderBy(raw: unknown): OrderBy | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) throw new UnsupportedSqlError('ORDER BY');
  if (raw.length > 1) throw new UnsupportedSqlError('複数列の ORDER BY');
  const first = asNode(raw[0]);
  const direction = String(first.type ?? 'ASC').toUpperCase();
  if (direction !== 'ASC' && direction !== 'DESC') throw new UnsupportedSqlError('ORDER BY の方向');
  return { column: columnRef(first.expr), direction };
}

function convertLimit(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = asNode(raw);
  const values = n.value;
  if (!Array.isArray(values) || values.length === 0) return undefined;
  if (values.length > 1) throw new UnsupportedSqlError('OFFSET 付き LIMIT');
  const value = literalValue(values[0]);
  if (typeof value !== 'number') throw new UnsupportedSqlError('LIMIT の値');
  return value;
}

/**
 * MySQL 方言の SQL を内部 AST へ変換する。
 * DESIGN.md 9 のサブセット外は `UnsupportedSqlError` を投げ、黙って近似しない。
 */
export function parse(sql: string): SelectStatement {
  const parser = new Parser();
  let ast: unknown;
  try {
    ast = parser.astify(sql, { database: 'mysql' });
  } catch (cause) {
    throw new UnsupportedSqlError(
      `SQL として解析できません (${cause instanceof Error ? cause.message.split('\n')[0] : ''})`,
    );
  }

  if (Array.isArray(ast)) {
    if (ast.length !== 1) throw new UnsupportedSqlError('複数ステートメント');
    ast = ast[0];
  }
  const node = asNode(ast);
  if (node.type !== 'select') throw new UnsupportedSqlError('SELECT 以外の文');
  if (node.with != null) throw new UnsupportedSqlError('WITH 句 (CTE)');
  if (node.distinct != null) throw new UnsupportedSqlError('DISTINCT');
  if (node.groupby != null) throw new UnsupportedSqlError('GROUP BY');
  if (node.having != null) throw new UnsupportedSqlError('HAVING');

  const from = node.from;
  if (!Array.isArray(from) || from.length === 0) throw new UnsupportedSqlError('FROM 句');
  if (from.length > 1) throw new UnsupportedSqlError('JOIN (M3 で対応予定)');
  const fromNode = asNode(from[0]);
  if (fromNode.db != null) throw new UnsupportedSqlError('データベース修飾');
  const table = fromNode.table;
  if (typeof table !== 'string') throw new UnsupportedSqlError('FROM のテーブル名');
  const alias = fromNode.as;

  return {
    columns: convertColumns(node.columns),
    from: typeof alias === 'string' ? { table, alias } : { table },
    ...(node.where == null ? {} : { where: convertWhere(node.where) }),
    ...(() => {
      const orderBy = convertOrderBy(node.orderby);
      return orderBy ? { orderBy } : {};
    })(),
    ...(() => {
      const limit = convertLimit(node.limit);
      return limit === undefined ? {} : { limit };
    })(),
  };
}
