import {
  type ClusteredLeafEntry,
  compareKeys,
  INTERNAL_FANOUT,
  type InternalEntry,
  type InternalPage,
  isLeaf,
  type KeyValue,
  LEAF_ENTRIES,
  type LeafPage,
  type Page,
  type PageId,
  type SecondaryLeafEntry,
} from './page.js';

export type TreeKind = 'clustered' | 'secondary';

export interface BuildOptions {
  readonly table: string;
  readonly index: string;
  readonly kind: TreeKind;
  /** キー昇順に整列済みのリーフエントリ。 */
  readonly entries: readonly (ClusteredLeafEntry | SecondaryLeafEntry)[];
}

/**
 * ソート済みエントリからのバルクロードで作る読み取り専用 B+Tree。
 * MVP は SELECT のみなので挿入・分割は実装しない (FIDELITY.md)。
 */
export class BTree {
  readonly table: string;
  readonly index: string;
  readonly kind: TreeKind;
  readonly rootId: PageId;
  /** ルートからリーフまでのレベル数。3 なら root/internal/leaf。 */
  readonly height: number;
  readonly firstLeafId: PageId;
  private readonly pageMap: ReadonlyMap<PageId, Page>;

  private constructor(
    opts: BuildOptions,
    pages: Map<PageId, Page>,
    rootId: PageId,
    height: number,
    firstLeafId: PageId,
  ) {
    this.table = opts.table;
    this.index = opts.index;
    this.kind = opts.kind;
    this.pageMap = pages;
    this.rootId = rootId;
    this.height = height;
    this.firstLeafId = firstLeafId;
  }

  static build(opts: BuildOptions): BTree {
    const leafKind = opts.kind === 'clustered' ? 'clustered-leaf' : 'secondary-leaf';
    const internalKind = opts.kind === 'clustered' ? 'clustered-internal' : 'secondary-internal';
    const pages = new Map<PageId, Page>();
    const pageId = (level: number, ordinal: number) =>
      `${opts.table}.${opts.index}#L${level}-${ordinal}`;

    // レベル0: リーフを LEAF_ENTRIES 件ずつに切り、右隣へのリンクを張る。
    const leafIds: PageId[] = [];
    const chunks: (typeof opts.entries)[] = [];
    for (let i = 0; i < opts.entries.length; i += LEAF_ENTRIES) {
      chunks.push(opts.entries.slice(i, i + LEAF_ENTRIES));
    }
    if (chunks.length === 0) chunks.push([]);

    chunks.forEach((chunk, ordinal) => {
      const id = pageId(0, ordinal);
      leafIds.push(id);
      const next = ordinal + 1 < chunks.length ? pageId(0, ordinal + 1) : null;
      const page = {
        id,
        table: opts.table,
        index: opts.index,
        level: 0,
        kind: leafKind,
        entries: chunk,
        next,
      } as LeafPage;
      pages.set(id, page);
    });

    // レベル1以上: 子 INTERNAL_FANOUT 個ずつをまとめ、各子の最小キーを持たせる。
    let childIds = leafIds;
    let level = 0;
    while (childIds.length > 1) {
      level += 1;
      const parentIds: PageId[] = [];
      for (let i = 0; i < childIds.length; i += INTERNAL_FANOUT) {
        const group = childIds.slice(i, i + INTERNAL_FANOUT);
        const id = pageId(level, parentIds.length);
        const entries: InternalEntry[] = group.map((child) => ({
          key: minKeyOf(pages, child),
          child,
        }));
        const page: InternalPage = {
          id,
          table: opts.table,
          index: opts.index,
          level,
          kind: internalKind,
          entries,
        };
        pages.set(id, page);
        parentIds.push(id);
      }
      childIds = parentIds;
    }

    const rootId = childIds[0];
    const firstLeafId = leafIds[0];
    if (!rootId || !firstLeafId) throw new Error('B+Tree の構築に失敗しました');
    return new BTree(opts, pages, rootId, level + 1, firstLeafId);
  }

  get pageIds(): readonly PageId[] {
    return [...this.pageMap.keys()];
  }

  get pageCount(): number {
    return this.pageMap.size;
  }

  page(id: PageId): Page {
    const page = this.pageMap.get(id);
    if (!page) throw new Error(`ページ ${id} は存在しません`);
    return page;
  }

  /**
   * ルートからリーフまでの探索経路を返す (純粋関数。I/O は呼び出し側が行う)。
   * searchKey 以上の最初のエントリを含みうるリーフに降りる。
   */
  descendPath(searchKey: KeyValue): readonly PageId[] {
    const path: PageId[] = [this.rootId];
    let current = this.page(this.rootId);
    while (!isLeaf(current)) {
      const child = pickChild(current, searchKey);
      path.push(child);
      current = this.page(child);
    }
    return path;
  }

  /** 全リーフを左から右へ辿る順序。TableScan / index フルスキャン用。 */
  leafIdsInOrder(): readonly PageId[] {
    const ids: PageId[] = [];
    let id: PageId | null = this.firstLeafId;
    while (id) {
      ids.push(id);
      const page = this.page(id);
      id = isLeaf(page) ? page.next : null;
    }
    return ids;
  }
}

function pickChild(page: InternalPage, searchKey: KeyValue): PageId {
  let chosen = page.entries[0];
  if (!chosen) throw new Error(`内部ノード ${page.id} が空です`);
  for (const entry of page.entries) {
    if (compareKeys(entry.key, searchKey) <= 0) chosen = entry;
    else break;
  }
  return chosen.child;
}

function minKeyOf(pages: ReadonlyMap<PageId, Page>, id: PageId): KeyValue {
  const page = pages.get(id);
  if (!page) throw new Error(`ページ ${id} は存在しません`);
  const first = page.entries[0];
  // 空リーフ (行0件のテーブル) は最小キーを持たないので番兵として空タプルを使う。
  return first ? first.key : [];
}
