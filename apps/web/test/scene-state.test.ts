import { run, SCENARIOS, type StepEvent, type Trace } from '@db-visualizer/engine';
import { describe, expect, it } from 'vitest';
import { sceneStateAt } from '../src/scene/scene-state.js';
import { nth } from './helpers.js';

/**
 * SceneState は「Trace の 0..index 番目まで適用したときに画面が描くべき状態」。
 * 3Dシーン (M2-B) と検証用 DOM (M2-A) の両方がこの1つの純関数を読むので、
 * ここが M2 の契約になる。
 */

const scenario1 = run(nth(SCENARIOS, 0).sql, nth(SCENARIOS, 0).options);
const scenario1NoIndex = run(nth(SCENARIOS, 1).sql, nth(SCENARIOS, 1).options);
const scenario2 = run(nth(SCENARIOS, 2).sql, nth(SCENARIOS, 2).options);
/** M1 の3シナリオでは再読が起きないので、バッファプールヒット用に別のクエリを使う。 */
const nonCovering = run('SELECT * FROM orders WHERE user_id BETWEEN 10 AND 20');
const ALL_RUNS = [
  { name: 'シナリオ1', result: scenario1 },
  { name: 'シナリオ1(対比)', result: scenario1NoIndex },
  { name: 'シナリオ2', result: scenario2 },
];

type Descend = Extract<StepEvent, { type: 'btree.descend' }>;

/** 同じ索引で level が下がり続ける btree.descend の並びを「1回の探索」としてまとめる。 */
function groupDescents(trace: Trace): { at: number; event: Descend }[][] {
  const groups: { at: number; event: Descend }[][] = [];
  for (const [at, event] of trace.entries()) {
    if (event.type !== 'btree.descend') continue;
    const current = groups.at(-1);
    const last = current?.at(-1)?.event;
    if (current && last && last.index === event.index && event.level < last.level) {
      current.push({ at, event });
    } else {
      groups.push([{ at, event }]);
    }
  }
  return groups;
}

function findIndex(trace: Trace, type: StepEvent['type']): number {
  const i = trace.findIndex((e) => e.type === type);
  if (i < 0) throw new Error(`${type} が trace にありません`);
  return i;
}

describe('sceneStateAt', () => {
  it('index が -1 のときは何も起きていない初期状態を返す', () => {
    const state = sceneStateAt(scenario1.trace, -1);

    expect(state.event).toBeNull();
    expect(state.plan).toBeNull();
    expect(state.candidates).toEqual([]);
    expect(state.pages).toEqual([]);
    expect(state.rows).toEqual([]);
    expect(state.counters).toEqual({
      pagesRead: 0,
      diskReads: 0,
      bufferHits: 0,
      rowsRead: 0,
      rowsEmitted: 0,
    });
  });

  it('plan.selected を適用するとプラン木と候補が入る', () => {
    const at = findIndex(scenario1.trace, 'plan.selected');
    const state = sceneStateAt(scenario1.trace, at);

    expect(state.plan?.op).toBe('Projection');
    expect(state.candidates.length).toBeGreaterThan(1);
    expect(state.candidates.filter((c) => c.chosen)).toHaveLength(1);
  });

  it('page.read を適用するとページが1枚点灯し、読み元が記録される', () => {
    const at = findIndex(scenario1.trace, 'page.read');
    const first = scenario1.trace[at];
    if (first?.type !== 'page.read') throw new Error('page.read が取れません');
    const state = sceneStateAt(scenario1.trace, at);

    expect(state.pages).toHaveLength(1);
    expect(state.pages[0]).toMatchObject({
      pageId: first.pageId,
      table: first.table,
      index: first.index,
      reads: 1,
      diskReads: 1,
      lastSource: 'disk',
    });
    expect(state.focus.pageId).toBe(first.pageId);
    expect(state.counters).toMatchObject({ pagesRead: 1, diskReads: 1, bufferHits: 0 });
  });

  it('同じページを再び読むとバッファプールヒットとして数え、ディスクI/Oは増えない', () => {
    // 非カバリングの範囲検索は行ごとにクラスタ索引へ戻るため、
    // ルートと内部ノードを何度も読み直す = バッファプールヒットが必ず起きる
    const trace = nonCovering.trace;
    const seen = new Set<string>();
    let repeatAt = -1;
    for (const [i, e] of trace.entries()) {
      if (e.type !== 'page.read') continue;
      if (seen.has(e.pageId)) {
        repeatAt = i;
        break;
      }
      seen.add(e.pageId);
    }
    expect(repeatAt, '再読が起きる trace であること').toBeGreaterThan(0);
    const repeat = trace[repeatAt];
    if (repeat?.type !== 'page.read') throw new Error('再読の page.read が取れません');
    expect(repeat.source).toBe('bufferpool');

    const before = sceneStateAt(trace, repeatAt - 1);
    const after = sceneStateAt(trace, repeatAt);

    expect(after.counters.pagesRead).toBe(before.counters.pagesRead + 1);
    expect(after.counters.diskReads).toBe(before.counters.diskReads);
    expect(after.counters.bufferHits).toBe(before.counters.bufferHits + 1);
    expect(after.pages).toHaveLength(before.pages.length);
    const page = after.pages.find((p) => p.pageId === repeat.pageId);
    expect(page?.reads).toBe(2);
    expect(page?.diskReads).toBe(1);
    expect(page?.lastSource).toBe('bufferpool');
  });

  it('btree.descend はルートからのパスとして積み上がる', () => {
    const trace = scenario1.trace;
    // descend は page.read と交互に出る。同じ索引で level が下がり続ける並びが1回の探索。
    const descents = groupDescents(trace);
    const first = nth(descents, 0);
    expect(first.length).toBeGreaterThan(1);

    const state = sceneStateAt(trace, nth(first, -1).at);
    expect(state.btreePath).toHaveLength(first.length);
    const levels = state.btreePath.map((n) => n.level);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(levels.at(-1)).toBe(0);
    expect(state.btreePath.map((n) => n.pageId)).toEqual(first.map((d) => d.event.pageId));
  });

  it('新しい探索が始まると B+Tree のパスはリセットされる', () => {
    const trace = scenario1.trace;
    const descents = groupDescents(trace);
    expect(descents.length, '索引探索が2回以上ある').toBeGreaterThan(1);

    const secondStart = nth(nth(descents, 1), 0);
    const state = sceneStateAt(trace, secondStart.at);
    expect(state.btreePath).toHaveLength(1);
    expect(state.btreePath[0]).toEqual({
      index: secondStart.event.index,
      level: secondStart.event.level,
      pageId: secondStart.event.pageId,
    });
  });

  it('clustered.lookup はセカンダリ索引からの戻りとして保持される', () => {
    const at = findIndex(scenario1.trace, 'clustered.lookup');
    const event = scenario1.trace[at];
    if (event?.type !== 'clustered.lookup') throw new Error('clustered.lookup が取れません');

    const state = sceneStateAt(scenario1.trace, at);
    expect(state.lookup).toEqual({
      table: event.table,
      pk: event.pk,
      from: event.from,
      seq: event.seq,
    });
    expect(state.counters.rowsRead).toBe(sceneStateAt(scenario1.trace, at - 1).counters.rowsRead);
  });

  it('row.emit で結果行が1件ずつ積まれる', () => {
    const trace = scenario2.trace;
    const emits = [...trace.entries()].filter(([, e]) => e.type === 'row.emit');
    expect(emits.length).toBeGreaterThan(1);

    const [firstAt] = nth(emits, 0);
    const [secondAt] = nth(emits, 1);
    expect(sceneStateAt(trace, firstAt).rows).toHaveLength(1);
    expect(sceneStateAt(trace, secondAt).rows).toHaveLength(2);
    expect(sceneStateAt(trace, firstAt).rows[0]).toEqual(
      (trace[firstAt] as Extract<StepEvent, { type: 'row.emit' }>).row,
    );
  });

  it('filter.eval の通過と棄却を数える', () => {
    const trace = scenario1NoIndex.trace;
    const last = trace.length - 1;
    const state = sceneStateAt(trace, last);
    const evals = trace.filter((e) => e.type === 'filter.eval');
    expect(evals.length).toBeGreaterThan(0);

    expect(state.filter.passed).toBe(evals.filter((e) => e.passed).length);
    expect(state.filter.rejected).toBe(evals.filter((e) => !e.passed).length);
    expect(state.filter.passed + state.filter.rejected).toBe(evals.length);
  });

  describe.each(ALL_RUNS)('$name', ({ result }) => {
    it('最後まで適用すると集計が stats イベントと一致する', () => {
      const state = sceneStateAt(result.trace, result.trace.length - 1);
      const stats = result.trace.find((e) => e.type === 'stats');
      if (stats?.type !== 'stats') throw new Error('stats がありません');

      expect(state.counters.pagesRead).toBe(stats.pagesRead);
      expect(state.counters.diskReads).toBe(stats.diskReads);
      expect(state.counters.rowsEmitted).toBe(stats.rowsReturned);
      expect(state.stats).toEqual({
        pagesRead: stats.pagesRead,
        diskReads: stats.diskReads,
        rowsExamined: stats.rowsExamined,
        rowsReturned: stats.rowsReturned,
      });
      expect(state.rows).toHaveLength(result.rows.length);
    });

    it('index までのイベントだけに依存する (スクラブで巻き戻せる)', () => {
      const trace = result.trace;
      for (const i of [0, 1, Math.floor(trace.length / 2), trace.length - 2, trace.length - 1]) {
        const direct = sceneStateAt(trace, i);
        const sliced = sceneStateAt(trace.slice(0, i + 1), i);
        expect(sliced, `index=${i}`).toEqual(direct);
      }
    });

    it('どの位置でも現在イベントを指し、範囲外はクランプされる', () => {
      const trace = result.trace;
      for (const [i, event] of trace.entries()) {
        expect(sceneStateAt(trace, i).event).toBe(event);
      }
      expect(sceneStateAt(trace, trace.length + 10).event).toBe(trace.at(-1));
      expect(sceneStateAt(trace, -5).event).toBeNull();
    });
  });
});
