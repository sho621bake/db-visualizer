import type { PlanCandidate } from '@db-visualizer/engine';
import type { JSX } from 'react';

/**
 * 「なぜこの索引が選ばれたか」を説明する、採用/不採用の候補比較パネル。
 */
export function CandidatesPanel(props: {
  readonly candidates: readonly PlanCandidate[];
}): JSX.Element {
  const { candidates } = props;

  if (candidates.length === 0) {
    return (
      <div className="candidates-panel" data-testid="candidates-panel">
        <h3 className="candidates-panel__heading">候補比較</h3>
        <p>候補がありません</p>
      </div>
    );
  }

  const sorted = [...candidates].sort((a, b) => a.cost - b.cost);

  return (
    <div className="candidates-panel" data-testid="candidates-panel">
      <h3 className="candidates-panel__heading">候補比較</h3>
      <ul className="candidates-panel__list">
        {sorted.map((c) => (
          <li
            key={`${c.table}-${c.index ?? 'none'}-${c.accessType}`}
            className={c.chosen ? 'candidate candidate--chosen' : 'candidate'}
            data-testid="candidate"
            data-chosen={c.chosen ? 'true' : 'false'}
            data-index={c.index ?? ''}
          >
            <span className="candidate__index">{c.index ?? '(索引なし)'}</span>
            <span className="candidate__access-type">{c.accessType}</span>
            <span className="candidate__rows">{c.estimatedRows}</span>
            <span className="candidate__cost">{c.cost.toFixed(2)}</span>
            {c.covering && <span className="candidate__covering-badge">カバリング</span>}
            <span className="candidate__reason">{c.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
