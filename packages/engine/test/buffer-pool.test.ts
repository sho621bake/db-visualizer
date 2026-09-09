import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/catalog/catalog.js';
import { PRIMARY } from '../src/catalog/schema.js';
import { BUFFER_POOL_RATIO, BufferPool } from '../src/storage/buffer-pool.js';
import { Database } from '../src/storage/database.js';
import { TraceCollector } from '../src/trace/collector.js';

const catalog = Catalog.default();
const db = Database.build(catalog);

const setup = (capacity?: number) => {
  const trace = new TraceCollector();
  return { trace, pool: new BufferPool(db, trace, capacity) };
};

describe('バッファプール', () => {
  it('容量は総ページ数の25%になる', () => {
    const { pool } = setup();
    expect(pool.capacity).toBe(Math.ceil(db.totalPages * BUFFER_POOL_RATIO));
  });

  it('初回はミス、2回目はヒットになり page.read の source が変わる', () => {
    const { pool, trace } = setup();
    const id = db.tree('users', PRIMARY).rootId;
    pool.read(id, 'n1');
    pool.read(id, 'n1');
    const events = trace.toTrace();
    expect(events.map((e) => (e.type === 'page.read' ? e.source : e.type))).toEqual([
      'disk',
      'bufferpool',
    ]);
    expect(pool.stats).toEqual({ pagesRead: 2, diskReads: 1, bufferHits: 1 });
  });

  it('容量を超えると最も長く参照されていないページから追い出す (LRU)', () => {
    const { pool } = setup(2);
    const leaves = db.tree('users', PRIMARY).leafIdsInOrder();
    const [a, b, c] = leaves as [string, string, string];

    pool.read(a, 'n1');
    pool.read(b, 'n1');
    // a を再参照して最近使用に押し上げる
    pool.read(a, 'n1');
    pool.read(c, 'n1');

    expect(pool.isResident(b)).toBe(false);
    expect(pool.residentPageIds()).toEqual([a, c]);
  });

  it('決定論: 同じ読み出し順なら常駐ページ集合も同じになる', () => {
    const ids = db.tree('orders', PRIMARY).leafIdsInOrder().slice(0, 10);
    const runOnce = () => {
      const { pool } = setup(4);
      for (const id of ids) pool.read(id, 'n1');
      return pool.residentPageIds();
    };
    expect(runOnce()).toEqual(runOnce());
  });
});
