import type { StepEvent } from '@db-visualizer/engine';
import type { JSX } from 'react';
import { GLOSSARY_JA } from '../glossary/ja.js';

/** その種別の主要フィールドを日本語で1行に要約する。 */
function summarize(event: StepEvent): string {
  switch (event.type) {
    case 'plan.selected': {
      const chosen = event.candidates.find((c) => c.chosen);
      return chosen
        ? `${chosen.accessType} / ${chosen.index ?? '(索引なし)'} を採用`
        : '実行計画を確定';
    }
    case 'page.read': {
      const source = event.source === 'disk' ? 'ディスクから読み込み' : 'バッファプールからヒット';
      return `${event.table} / ${event.index} / ${event.pageId} (${source})`;
    }
    case 'btree.descend':
      return `${event.index} レベル${event.level} → ${event.pageId} (探索キー: ${event.searchKey.join(', ')})`;
    case 'btree.leaf.scan': {
      const from = event.fromKey ? event.fromKey.join(',') : '先頭';
      const to = event.toKey ? event.toKey.join(',') : '末尾';
      return `${event.index} ${event.pageId} を ${from} から ${to} まで走査`;
    }
    case 'row.read':
      return `${event.table} の pk=${event.pk} を読み出し`;
    case 'clustered.lookup':
      return `${event.from} → クラスタ索引 (pk=${event.pk})`;
    case 'filter.eval':
      return `pk=${event.pk} → ${event.passed ? '通過' : '棄却'}`;
    case 'join.probe': {
      const side = event.side === 'driving' ? '駆動表' : '内部表';
      return `${side}: key=${event.key.join(',')} → ${event.matched ? 'ヒット' : 'ミス'}`;
    }
    case 'hash.build':
      return `key=${event.key.join(',')} をバケット${event.bucket} へ格納`;
    case 'hash.probe':
      return `key=${event.key.join(',')} でバケット${event.bucket} を探索`;
    case 'sort.buffer':
      return `${event.rows.length}行をソートバッファへ格納`;
    case 'sort.emit':
      return `${event.rows.length}行をソート結果として出力`;
    case 'row.emit':
      return '1行を結果へ出力';
    case 'stats':
      return `ページ${event.pagesRead}枚 / ディスクI/O ${event.diskReads}回 / 読み出し ${event.rowsExamined}行 / 返却 ${event.rowsReturned}行`;
  }
}

/**
 * 現在選択中の StepEvent 1件を、用語集の解説と payload の要約で表示する。
 */
export function EventDetail(props: { readonly event: StepEvent | null }): JSX.Element {
  const { event } = props;

  if (event === null) {
    return (
      <div className="event-detail" data-testid="event-detail">
        <p>イベントを選択してください</p>
      </div>
    );
  }

  const glossary = GLOSSARY_JA[event.type];

  return (
    <div className="event-detail" data-testid="event-detail">
      <h3 className="event-detail__term">{glossary.term}</h3>
      <p className="event-detail__summary">{glossary.summary}</p>
      <p className="event-detail__detail">{glossary.detail}</p>
      {glossary.mysqlTerm !== null && (
        <p className="event-detail__mysql-term">MySQL では: {glossary.mysqlTerm}</p>
      )}
      <p className="event-detail__event-summary" data-testid="event-summary">
        {summarize(event)}
      </p>
      <p className="event-detail__event-type" data-testid="event-type">
        {event.type}
      </p>
    </div>
  );
}
