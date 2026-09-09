import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { scenarioByFixture as scenario } from '../src/scenarios.js';

describe('プランナ', () => {
  it('UNIQUE 索引の等値は const を選ぶ (実 MySQL の EXPLAIN と同じ)', () => {
    const s = scenario('s1-users-email-eq');
    const { explain } = run(s.sql, s.options);
    expect(explain).toEqual({
      id: 1,
      select_type: 'SIMPLE',
      table: 'users',
      access_type: 'const',
      possible_keys: ['idx_users_email'],
      key: 'idx_users_email',
      rows: 1,
      extra: null,
    });
  });

  it('索引を外すと ALL + Using where になる', () => {
    const s = scenario('s1-users-email-eq-noindex');
    const { explain } = run(s.sql, s.options);
    expect(explain).toEqual({
      id: 1,
      select_type: 'SIMPLE',
      table: 'users',
      access_type: 'ALL',
      possible_keys: null,
      key: null,
      rows: 200,
      extra: 'Using where',
    });
  });

  it('範囲検索ではカバリングになる複合索引を選ぶ', () => {
    const s = scenario('s2-orders-user-range');
    const { explain } = run(s.sql, s.options);
    expect(explain).toEqual({
      id: 1,
      select_type: 'SIMPLE',
      table: 'orders',
      access_type: 'range',
      possible_keys: ['idx_orders_user', 'idx_orders_user_status'],
      key: 'idx_orders_user_status',
      rows: 89,
      extra: 'Using where; Using index',
    });
  });

  it('不採用の候補もコスト付きで残る (候補比較パネル用)', () => {
    const s = scenario('s2-orders-user-range');
    const { plan } = run(s.sql, s.options);
    const byKey = Object.fromEntries(
      plan.candidates.map((c) => [c.index ?? 'ALL', { type: c.accessType, cost: c.cost }]),
    );
    // PRIMARY は WHERE に id の条件が無いので候補にならない (MySQL の possible_keys と同じ)
    expect(Object.keys(byKey).sort()).toEqual(['ALL', 'idx_orders_user', 'idx_orders_user_status']);
    // カバリング索引が最安であること = なぜこれが選ばれたかの答え
    const chosen = plan.chosen;
    expect(chosen.index).toBe('idx_orders_user_status');
    for (const c of plan.candidates) {
      if (c !== chosen) expect(c.cost).toBeGreaterThan(chosen.cost);
    }
  });

  it('PRIMARY の等値は const になり、クラスタ索引に戻らない', () => {
    const { explain, rows } = run('SELECT * FROM users WHERE id = 100');
    expect(explain.access_type).toBe('const');
    expect(explain.key).toBe('PRIMARY');
    // クラスタ索引のリーフに行本体があるので Using index は付けない (MySQL と同じ)
    expect(explain.extra).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('EXPLAIN FORMAT=TREE 風の出力が実 MySQL と同じ構造になる', () => {
    const s = scenario('s2-orders-user-range');
    const { explainTree } = run(s.sql, s.options);
    expect(explainTree.split('\n').map((l) => l.trimEnd())).toEqual([
      '-> Projection: user_id, status',
      '    -> Filter: (user_id BETWEEN 10 AND 20)',
      '        -> Covering index range scan on orders using idx_orders_user_status over (10 <= user_id <= 20)',
    ]);
  });
});
