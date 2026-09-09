import { run, SCENARIOS, type Trace } from '@db-visualizer/engine';
import { cleanup, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScenePanel } from '../src/scene/ScenePanel.js';
import { sceneStateAt } from '../src/scene/scene-state.js';
import { nth } from './helpers.js';

/**
 * ScenePanel は SceneState を DOM に写す。3Dシーン (M2-B) を載せたあとも
 * この DOM は検証・スクリーンリーダー用として残るので、data-* は e2e の契約になる。
 */

const scenario1 = run(nth(SCENARIOS, 0).sql, nth(SCENARIOS, 0).options);
const scenario2 = run(nth(SCENARIOS, 2).sql, nth(SCENARIOS, 2).options);

function findIndex(trace: Trace, predicate: (e: Trace[number]) => boolean): number {
  const i = trace.findIndex(predicate);
  if (i < 0) throw new Error('該当するイベントがありません');
  return i;
}

function renderAt(trace: Trace, index: number) {
  render(<ScenePanel state={sceneStateAt(trace, index)} />);
  return screen.getByTestId('scene-state');
}

describe('ScenePanel', () => {
  it('未実行のときはページも結果行も出ない', () => {
    const panel = renderAt(scenario1.trace, -1);

    expect(within(panel).queryAllByTestId('page')).toHaveLength(0);
    expect(within(panel).queryAllByTestId('result-row')).toHaveLength(0);
  });

  it('読んだページを読み元つきで並べる', () => {
    const at = findIndex(scenario1.trace, (e) => e.type === 'page.read');
    const panel = renderAt(scenario1.trace, at);

    const pages = within(panel).getAllByTestId('page');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveAttribute('data-source', 'disk');
    expect(pages[0]).toHaveAttribute('data-reads', '1');
    expect(pages[0]?.getAttribute('data-page')).toMatch(/^users\./);
  });

  it('現在のイベントが触っているページに印が付く', () => {
    const at = findIndex(scenario1.trace, (e) => e.type === 'page.read');
    const event = scenario1.trace[at];
    if (event?.type !== 'page.read') throw new Error('page.read が取れません');
    const panel = renderAt(scenario1.trace, at);

    const focused = within(panel)
      .getAllByTestId('page')
      .filter((p) => p.dataset.focused === 'true');
    expect(focused).toHaveLength(1);
    expect(focused[0]).toHaveAttribute('data-page', event.pageId);
  });

  it('B+Tree の探索経路をルートからリーフの順に出す', () => {
    // クラスタ索引へ降り切った時点 (row.read の直前) を見る
    const at = findIndex(scenario1.trace, (e) => e.type === 'row.read') - 1;
    const panel = renderAt(scenario1.trace, at);

    const nodes = within(panel).getAllByTestId('btree-node');
    expect(nodes.length).toBeGreaterThan(1);
    const levels = nodes.map((n) => Number(n.dataset.level));
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(levels.at(-1)).toBe(0);
  });

  it('セカンダリ索引からクラスタ索引へ戻ったことを示す', () => {
    const at = findIndex(scenario1.trace, (e) => e.type === 'clustered.lookup');

    expect(within(renderAt(scenario1.trace, at - 1)).queryByTestId('lookup')).toBeNull();
    cleanup();
    const lookup = within(renderAt(scenario1.trace, at)).getByTestId('lookup');
    expect(lookup).toHaveAttribute('data-from', 'idx_users_email');
  });

  it('結果グリッドに出力済みの行が積まれる', () => {
    const last = scenario2.trace.length - 1;
    const panel = renderAt(scenario2.trace, last);

    const rows = within(panel).getAllByTestId('result-row');
    expect(rows).toHaveLength(scenario2.rows.length);
    expect(within(panel).getByTestId('result-grid')).toHaveAttribute(
      'data-row-count',
      String(scenario2.rows.length),
    );
  });

  it('集計を現在位置までの値で出す', () => {
    const last = scenario2.trace.length - 1;
    const stats = scenario2.trace.find((e) => e.type === 'stats');
    if (stats?.type !== 'stats') throw new Error('stats がありません');
    const panel = renderAt(scenario2.trace, last);

    const counters = within(panel).getByTestId('counters');
    expect(counters).toHaveAttribute('data-pages-read', String(stats.pagesRead));
    expect(counters).toHaveAttribute('data-disk-reads', String(stats.diskReads));
    expect(counters).toHaveAttribute('data-rows-emitted', String(stats.rowsReturned));
  });

  it('スクラブで戻ると集計も戻る', () => {
    const last = scenario2.trace.length - 1;
    const full = within(renderAt(scenario2.trace, last)).getByTestId('counters');
    const fullPages = Number(full.dataset.pagesRead);
    cleanup();

    const half = within(renderAt(scenario2.trace, Math.floor(last / 2))).getByTestId('counters');
    expect(Number(half.dataset.pagesRead)).toBeLessThan(fullPages);
  });
});
