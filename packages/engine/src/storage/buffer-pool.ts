import type { TraceCollector } from '../trace/collector.js';
import type { Database } from './database.js';
import type { Page, PageId } from './page.js';

/** バッファプール容量 = 総ページ数の 25% (FIDELITY.md)。 */
export const BUFFER_POOL_RATIO = 0.25;

export interface BufferPoolStats {
  readonly pagesRead: number;
  readonly diskReads: number;
  readonly bufferHits: number;
}

/**
 * 単純 LRU のバッファプール。
 * 実機の young/old サブリストやプリフェッチは持たない (FIDELITY.md)。
 */
export class BufferPool {
  readonly capacity: number;
  /** Map の挿入順を LRU 順として使う (先頭が最も古い)。 */
  private readonly resident = new Map<PageId, Page>();
  private pagesRead = 0;
  private diskReads = 0;

  constructor(
    private readonly db: Database,
    private readonly trace: TraceCollector,
    capacity?: number,
  ) {
    this.capacity = capacity ?? Math.max(1, Math.ceil(db.totalPages * BUFFER_POOL_RATIO));
  }

  /** ページを読む。ヒット/ミスを判定し `page.read` を emit する。 */
  read(pageId: PageId, nodeId: string): Page {
    this.pagesRead += 1;
    const cached = this.resident.get(pageId);
    if (cached) {
      // LRU: 参照したら末尾へ move-to-back
      this.resident.delete(pageId);
      this.resident.set(pageId, cached);
      this.trace.emit({
        type: 'page.read',
        nodeId,
        table: cached.table,
        index: cached.index,
        pageId,
        source: 'bufferpool',
      });
      return cached;
    }

    const page = this.db.page(pageId);
    this.diskReads += 1;
    this.admit(pageId, page);
    this.trace.emit({
      type: 'page.read',
      nodeId,
      table: page.table,
      index: page.index,
      pageId,
      source: 'disk',
    });
    return page;
  }

  /** I/O を起こさずに常駐しているか調べる (テスト用)。 */
  isResident(pageId: PageId): boolean {
    return this.resident.has(pageId);
  }

  /** LRU 順 (古い → 新しい)。 */
  residentPageIds(): readonly PageId[] {
    return [...this.resident.keys()];
  }

  get stats(): BufferPoolStats {
    return {
      pagesRead: this.pagesRead,
      diskReads: this.diskReads,
      bufferHits: this.pagesRead - this.diskReads,
    };
  }

  private admit(pageId: PageId, page: Page): void {
    while (this.resident.size >= this.capacity) {
      const oldest = this.resident.keys().next();
      if (oldest.done) break;
      this.resident.delete(oldest.value);
    }
    this.resident.set(pageId, page);
  }
}
