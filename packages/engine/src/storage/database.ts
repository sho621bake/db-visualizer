import type { Catalog, Row, Value } from '../catalog/catalog.js';
import { PRIMARY } from '../catalog/schema.js';
import { BTree } from './btree.js';
import { compareKeys, type Page, type PageId } from './page.js';

/** テーブル名 + 索引名で B+Tree を引くためのキー。 */
function treeKey(table: string, index: string): string {
  return `${table}.${index}`;
}

/**
 * シードデータから全 B+Tree をバルクロードした、読み取り専用のデータベース。
 * ページ集合はここが唯一の真実で、BufferPool はこれを「ディスク」として読む。
 */
export class Database {
  private readonly trees = new Map<string, BTree>();

  private constructor(readonly catalog: Catalog) {
    for (const name of catalog.tableNames()) {
      const table = catalog.table(name);
      const rows = catalog.rows(name);

      this.trees.set(
        treeKey(name, PRIMARY),
        BTree.build({
          table: name,
          index: PRIMARY,
          kind: 'clustered',
          entries: rows.map((row) => ({ key: [row[table.primaryKey] as Value], row })),
        }),
      );

      for (const idx of table.indexes) {
        // セカンダリ索引は (索引キー..., PK) で整列する。MySQL も PK を末尾に暗黙に持つ。
        const entries = rows
          .map((row) => ({
            key: idx.columns.map((c) => row[c] as Value),
            pk: row[table.primaryKey] as Value,
          }))
          .sort((a, b) => {
            const c = compareKeys(a.key, b.key);
            return c !== 0 ? c : compareKeys([a.pk], [b.pk]);
          });
        this.trees.set(
          treeKey(name, idx.name),
          BTree.build({ table: name, index: idx.name, kind: 'secondary', entries }),
        );
      }
    }
  }

  static build(catalog: Catalog): Database {
    return new Database(catalog);
  }

  tree(table: string, index: string): BTree {
    const tree = this.trees.get(treeKey(table, index));
    if (!tree) throw new Error(`索引 ${table}.${index} は存在しません`);
    return tree;
  }

  /** バッファプール容量の基準になる、データベース全体のページ数。 */
  get totalPages(): number {
    let total = 0;
    for (const tree of this.trees.values()) total += tree.pageCount;
    return total;
  }

  page(pageId: PageId): Page {
    const [prefix] = pageId.split('#');
    if (!prefix) throw new Error(`ページ ${pageId} は存在しません`);
    const tree = this.trees.get(prefix);
    if (!tree) throw new Error(`ページ ${pageId} は存在しません`);
    return tree.page(pageId);
  }

  /** クラスタ索引のリーフから PK で行を引く。ClusteredLookup の実体。 */
  rowByPk(table: string, pk: Value): Row | null {
    const tree = this.tree(table, PRIMARY);
    const path = tree.descendPath([pk]);
    const leafId = path[path.length - 1];
    if (!leafId) return null;
    const leaf = tree.page(leafId);
    if (leaf.kind !== 'clustered-leaf') return null;
    const hit = leaf.entries.find((e) => compareKeys(e.key, [pk]) === 0);
    return hit ? hit.row : null;
  }
}
