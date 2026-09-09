import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/catalog/catalog.js';
import { PRIMARY } from '../src/catalog/schema.js';
import { Database } from '../src/storage/database.js';
import { INTERNAL_FANOUT, isLeaf, LEAF_ENTRIES } from '../src/storage/page.js';

const catalog = Catalog.default();
const db = Database.build(catalog);

describe('B+Tree の構成', () => {
  it('users / orders のクラスタ索引は3レベルになる (descend が見える条件)', () => {
    expect(db.tree('users', PRIMARY).height).toBe(3);
    expect(db.tree('orders', PRIMARY).height).toBe(3);
  });

  it('products は行数が少ないので2レベルにとどまる', () => {
    expect(db.tree('products', PRIMARY).height).toBe(2);
  });

  it('リーフは LEAF_ENTRIES 件ずつに詰められる', () => {
    const tree = db.tree('users', PRIMARY);
    const leaves = tree.leafIdsInOrder();
    expect(leaves).toHaveLength(Math.ceil(200 / LEAF_ENTRIES));
    for (const id of leaves.slice(0, -1)) {
      expect(tree.page(id).entries).toHaveLength(LEAF_ENTRIES);
    }
  });

  it('内部ノードのファンアウトは INTERNAL_FANOUT を超えない', () => {
    const tree = db.tree('orders', PRIMARY);
    for (const id of tree.pageIds) {
      const page = tree.page(id);
      if (!isLeaf(page)) expect(page.entries.length).toBeLessThanOrEqual(INTERNAL_FANOUT);
    }
  });

  it('リーフは右隣へ連結され、キー昇順で全件を辿れる', () => {
    const tree = db.tree('users', PRIMARY);
    const ids: string[] = [];
    let id: string | null = tree.firstLeafId;
    const keys: number[] = [];
    while (id) {
      ids.push(id);
      const page = tree.page(id);
      if (!isLeaf(page)) throw new Error('リーフではありません');
      for (const e of page.entries) keys.push(e.key[0] as number);
      id = page.next;
    }
    expect(keys).toHaveLength(200);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(ids[0]).toBe(tree.firstLeafId);
  });

  it('descend はルートからリーフまでレベルを1つずつ下る', () => {
    const tree = db.tree('users', PRIMARY);
    const path = tree.descendPath([137]);
    expect(path).toHaveLength(3);
    expect(path[0]).toBe(tree.rootId);
    const levels = path.map((id) => tree.page(id).level);
    expect(levels).toEqual([2, 1, 0]);
    const leaf = tree.page(path[2] as string);
    if (!isLeaf(leaf)) throw new Error('リーフではありません');
    expect(leaf.entries.some((e) => e.key[0] === 137)).toBe(true);
  });

  it('セカンダリ索引のリーフは (索引キー, PK) だけを持ち、行本体を持たない', () => {
    const tree = db.tree('users', 'idx_users_email');
    const leaf = tree.page(tree.firstLeafId);
    if (!isLeaf(leaf)) throw new Error('リーフではありません');
    expect(leaf.kind).toBe('secondary-leaf');
    for (const entry of leaf.entries) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'pk']);
      expect(entry).not.toHaveProperty('row');
    }
  });

  it('複合セカンダリ索引は (キー…, PK) の順に整列している', () => {
    const tree = db.tree('orders', 'idx_orders_user_status');
    const flat: [number, string, number][] = [];
    let id: string | null = tree.firstLeafId;
    while (id) {
      const page = tree.page(id);
      if (!isLeaf(page)) throw new Error('リーフではありません');
      for (const e of page.entries) {
        if ('row' in e) throw new Error('セカンダリ索引に行本体があります');
        flat.push([e.key[0] as number, e.key[1] as string, e.pk as number]);
      }
      id = page.next;
    }
    expect(flat).toHaveLength(2000);
    const sorted = [...flat].sort(
      (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2],
    );
    expect(flat).toEqual(sorted);
  });
});
