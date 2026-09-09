import type { PlanCandidate, StepEvent } from '@db-visualizer/engine';
import { run, SCENARIOS } from '@db-visualizer/engine';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GLOSSARY_JA } from '../src/glossary/ja.js';
import { CandidatesPanel } from '../src/panels/CandidatesPanel.js';
import { EventDetail } from '../src/panels/EventDetail.js';
import { ExplainPanel } from '../src/panels/ExplainPanel.js';
import { nth } from './helpers.js';

const scenario1 = nth(SCENARIOS, 0);
const scenario1NoIndex = nth(SCENARIOS, 1);
const scenario2 = nth(SCENARIOS, 2);
const result1 = run(scenario1.sql, scenario1.options);
const result1NoIndex = run(scenario1NoIndex.sql, scenario1NoIndex.options);
const result2 = run(scenario2.sql, scenario2.options);

describe('ExplainPanel', () => {
  it('EXPLAIN の各値が表に出る', () => {
    render(<ExplainPanel row={result1.explain} tree={result1.explainTree} />);
    const panel = screen.getByTestId('explain-panel');
    expect(panel).toHaveTextContent(String(result1.explain.id));
    expect(panel).toHaveTextContent(result1.explain.select_type);
    expect(panel).toHaveTextContent(result1.explain.table);
    expect(panel).toHaveTextContent(result1.explain.access_type);
    expect(panel).toHaveTextContent(result1.explain.key ?? '');
    expect(panel).toHaveTextContent(String(result1.explain.rows));
  });

  it('possible_keys が null のとき NULL と出る', () => {
    render(<ExplainPanel row={result1NoIndex.explain} tree={result1NoIndex.explainTree} />);
    expect(result1NoIndex.explain.possible_keys).toBeNull();
    const panel = screen.getByTestId('explain-panel');
    expect(panel).toHaveTextContent('NULL');
  });

  it('EXPLAIN FORMAT=TREE 文字列が pre に出る', () => {
    render(<ExplainPanel row={result1.explain} tree={result1.explainTree} />);
    const panel = screen.getByTestId('explain-panel');
    const pre = panel.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(result1.explainTree);
  });
});

describe('CandidatesPanel', () => {
  const candidates: PlanCandidate[] = [
    {
      table: 'users',
      accessType: 'ALL',
      index: null,
      covering: false,
      estimatedRows: 1000,
      cost: 30.5,
      chosen: false,
      reason: 'フルスキャンのため索引を使えない',
    },
    {
      table: 'users',
      accessType: 'ref',
      index: 'idx_users_email',
      covering: false,
      estimatedRows: 1,
      cost: 2.1,
      chosen: true,
      reason: '等値条件を索引で絞り込める',
    },
  ];

  it('コスト昇順に並ぶ', () => {
    render(<CandidatesPanel candidates={candidates} />);
    const rows = screen.getAllByTestId('candidate');
    expect(rows[0]).toHaveAttribute('data-index', 'idx_users_email');
    expect(rows[1]).toHaveAttribute('data-index', '');
  });

  it('採用された候補だけ data-chosen が true になる', () => {
    render(<CandidatesPanel candidates={candidates} />);
    const rows = screen.getAllByTestId('candidate');
    const chosenRows = rows.filter((r) => r.getAttribute('data-chosen') === 'true');
    expect(chosenRows).toHaveLength(1);
    expect(chosenRows[0]).toHaveAttribute('data-index', 'idx_users_email');
    const notChosenRows = rows.filter((r) => r.getAttribute('data-chosen') === 'false');
    expect(notChosenRows).toHaveLength(1);
  });

  it('候補が空配列のとき「候補がありません」と出る', () => {
    render(<CandidatesPanel candidates={[]} />);
    expect(screen.getByTestId('candidates-panel')).toHaveTextContent('候補がありません');
  });
});

describe('EventDetail', () => {
  it('clustered.lookup イベントを渡すと glossary の term と detail が出る', () => {
    const event: StepEvent = {
      seq: 0,
      nodeId: 'n1',
      type: 'clustered.lookup',
      table: 'users',
      pk: 42,
      from: 'idx_users_email',
    };
    render(<EventDetail event={event} />);
    const detail = screen.getByTestId('event-detail');
    expect(detail).toHaveTextContent(GLOSSARY_JA['clustered.lookup'].term);
    expect(detail).toHaveTextContent(GLOSSARY_JA['clustered.lookup'].detail);
  });

  it('page.read はディスク読み込みとバッファプールヒットで要約の文言が変わる', () => {
    const diskEvent: StepEvent = {
      seq: 0,
      nodeId: 'n1',
      type: 'page.read',
      table: 'users',
      index: 'PRIMARY',
      pageId: 'users.PRIMARY#L0-3',
      source: 'disk',
    };
    const bufferEvent: StepEvent = { ...diskEvent, source: 'bufferpool' };

    const diskRender = render(<EventDetail event={diskEvent} />);
    const diskSummary = screen.getByTestId('event-summary').textContent;
    diskRender.unmount();

    render(<EventDetail event={bufferEvent} />);
    const bufferSummary = screen.getByTestId('event-summary').textContent;

    expect(diskSummary).not.toBe(bufferSummary);
    expect(diskSummary).toContain('ディスクから読み込み');
    expect(bufferSummary).toContain('バッファプールからヒット');
  });

  it('event が null のときプレースホルダが出る', () => {
    render(<EventDetail event={null} />);
    expect(screen.getByTestId('event-detail')).toHaveTextContent('イベントを選択してください');
  });

  it('シナリオ1・シナリオ2の trace 全イベントで例外を投げず要約が空でない', () => {
    for (const event of [...result1.trace, ...result2.trace]) {
      const { unmount } = render(<EventDetail event={event} />);
      const summary = screen.getByTestId('event-summary');
      expect(summary.textContent, `${event.type} の要約`).not.toBe('');
      unmount();
    }
  });
});
