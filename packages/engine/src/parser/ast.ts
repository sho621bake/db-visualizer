import type { Value } from '../catalog/catalog.js';

/**
 * エンジン内部の AST。node-sql-parser を差し替えられるよう自前で定義する
 * (DESIGN.md の「パーサ差し替えできるよう内部 AST を自前定義」)。
 * 表現できる範囲は DESIGN.md 9 のサブセットだけ。
 */

export interface ColumnRef {
  /** テーブル名またはエイリアス。修飾されていなければ undefined。 */
  readonly qualifier?: string;
  readonly column: string;
}

export type CompareOp = '=' | '<' | '<=' | '>' | '>=';

export type Predicate =
  | {
      readonly kind: 'compare';
      readonly op: CompareOp;
      readonly column: ColumnRef;
      readonly value: Value;
    }
  | {
      readonly kind: 'between';
      readonly column: ColumnRef;
      readonly low: Value;
      readonly high: Value;
    }
  | { readonly kind: 'and'; readonly left: Predicate; readonly right: Predicate };

export interface TableRef {
  readonly table: string;
  readonly alias?: string;
}

export interface OrderBy {
  readonly column: ColumnRef;
  readonly direction: 'ASC' | 'DESC';
}

export interface SelectStatement {
  /** `SELECT *` は 'all'。 */
  readonly columns: 'all' | readonly ColumnRef[];
  readonly from: TableRef;
  readonly where?: Predicate;
  readonly orderBy?: OrderBy;
  readonly limit?: number;
}

/** サポート範囲外の SQL。黙って近似せず、この例外を投げる (CLAUDE.md の作業ルール)。 */
export class UnsupportedSqlError extends Error {
  constructor(what: string) {
    super(`未対応: ${what}`);
    this.name = 'UnsupportedSqlError';
  }
}

/** AND の木を平坦なリストにする。プランナはこの形で扱う。 */
export function flattenAnd(predicate: Predicate | undefined): readonly Predicate[] {
  if (!predicate) return [];
  if (predicate.kind === 'and') {
    return [...flattenAnd(predicate.left), ...flattenAnd(predicate.right)];
  }
  return [predicate];
}

/** 述語が参照する列名 (修飾子は落とす)。 */
export function predicateColumn(predicate: Predicate): string {
  if (predicate.kind === 'and') throw new Error('AND は単一列を持ちません');
  return predicate.column.column;
}
