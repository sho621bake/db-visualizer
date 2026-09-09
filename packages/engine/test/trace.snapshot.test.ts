import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { SCENARIOS } from '../src/scenarios.js';
import { M1_EVENT_TYPES, stepEventSchema } from '../src/trace/events.js';

/**
 * 不変条件1: 同じ SQL + 同じシードで同じ StepEvent[] が出る。
 * イベント列そのものが「実行順の仕様書」なので、差分は必ず目で読むこと。
 */
describe('Trace の決定論', () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: StepEvent[] がスナップショットと一致する`, () => {
      const { trace } = run(s.sql, s.options);
      expect(trace).toMatchSnapshot();
    });

    it(`${s.name}: 2回実行しても同じ StepEvent[] になる`, () => {
      expect(run(s.sql, s.options).trace).toEqual(run(s.sql, s.options).trace);
    });

    it(`${s.name}: 全イベントが zod スキーマを満たす`, () => {
      for (const event of run(s.sql, s.options).trace) {
        expect(stepEventSchema.parse(event)).toEqual(event);
      }
    });

    it(`${s.name}: M1 で emit する種別だけが現れる`, () => {
      const types = new Set(run(s.sql, s.options).trace.map((e) => e.type));
      for (const t of types) expect(M1_EVENT_TYPES).toContain(t);
    });
  }
});

describe('Trace の内容', () => {
  it('シナリオ1: セカンダリ索引 → クラスタ索引の戻りが1回だけ起きる', () => {
    const s = SCENARIOS[0];
    if (!s) throw new Error('シナリオがありません');
    const { trace, rows } = run(s.sql, s.options);
    const lookups = trace.filter((e) => e.type === 'clustered.lookup');
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toMatchObject({ table: 'users', pk: 100, from: 'idx_users_email' });
    expect(rows).toHaveLength(1);
  });

  it('シナリオ2: カバリング索引なのでクラスタ索引へ戻らない', () => {
    const s = SCENARIOS[2];
    if (!s) throw new Error('シナリオがありません');
    const { trace } = run(s.sql, s.options);
    expect(trace.filter((e) => e.type === 'clustered.lookup')).toHaveLength(0);
  });

  it('索引を外すと読むページ数が跳ね上がる (シナリオ1の対比の主眼)', () => {
    const withIndex = SCENARIOS[0];
    const withoutIndex = SCENARIOS[1];
    if (!withIndex || !withoutIndex) throw new Error('シナリオがありません');
    const a = statsOf(run(withIndex.sql, withIndex.options).trace);
    const b = statsOf(run(withoutIndex.sql, withoutIndex.options).trace);
    expect(a.rowsExamined).toBe(1);
    expect(b.rowsExamined).toBe(200);
    expect(b.pagesRead).toBeGreaterThan(a.pagesRead);
    expect(a.rowsReturned).toBe(b.rowsReturned);
  });

  it('seq は 0 始まりの連番になる', () => {
    const s = SCENARIOS[2];
    if (!s) throw new Error('シナリオがありません');
    const { trace } = run(s.sql, s.options);
    expect(trace.map((e) => e.seq)).toEqual(trace.map((_, i) => i));
  });
});

function statsOf(trace: ReturnType<typeof run>['trace']) {
  const last = trace[trace.length - 1];
  if (last?.type !== 'stats') throw new Error('末尾が stats ではありません');
  return last;
}
