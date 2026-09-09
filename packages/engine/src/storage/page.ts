import type { Row, Value } from '../catalog/catalog.js';

/**
 * 教育用に縮小したページサイズ。実機は 16KB (FIDELITY.md 参照)。
 * この2値により users(200行)/orders(2000行) の B+Tree が 3 レベルになり descend が見える。
 */
export const LEAF_ENTRIES = 8;
export const INTERNAL_FANOUT = 16;

export type PageId = string;

export type PageKind =
  | 'clustered-leaf'
  | 'clustered-internal'
  | 'secondary-leaf'
  | 'secondary-internal';

/** 索引キーはタプル。単一列索引でも長さ1の配列で表す。 */
export type KeyValue = readonly Value[];

export interface ClusteredLeafEntry {
  readonly key: KeyValue;
  readonly row: Row;
}

/** セカンダリ索引のリーフは (索引キー, PK) しか持たない (DESIGN.md 4.1)。 */
export interface SecondaryLeafEntry {
  readonly key: KeyValue;
  readonly pk: Value;
}

export interface InternalEntry {
  readonly key: KeyValue;
  readonly child: PageId;
}

interface PageBase {
  readonly id: PageId;
  readonly table: string;
  /** 'PRIMARY' またはセカンダリ索引名。 */
  readonly index: string;
  /** 0 = リーフ。上に行くほど大きい。 */
  readonly level: number;
}

export interface ClusteredLeafPage extends PageBase {
  readonly kind: 'clustered-leaf';
  readonly entries: readonly ClusteredLeafEntry[];
  readonly next: PageId | null;
}

export interface SecondaryLeafPage extends PageBase {
  readonly kind: 'secondary-leaf';
  readonly entries: readonly SecondaryLeafEntry[];
  readonly next: PageId | null;
}

export interface InternalPage extends PageBase {
  readonly kind: 'clustered-internal' | 'secondary-internal';
  readonly entries: readonly InternalEntry[];
}

export type LeafPage = ClusteredLeafPage | SecondaryLeafPage;
export type Page = LeafPage | InternalPage;

export function isLeaf(page: Page): page is LeafPage {
  return page.kind === 'clustered-leaf' || page.kind === 'secondary-leaf';
}

function compareValue(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** キータプルの辞書順比較。片方が他方の prefix なら短い方を小さいとみなす。 */
export function compareKeys(a: KeyValue, b: KeyValue): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) break;
    const c = compareValue(av, bv);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}
