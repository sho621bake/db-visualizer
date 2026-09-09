import type { ExplainRow } from '@db-visualizer/engine';
import type { JSX } from 'react';

/**
 * MySQL の `EXPLAIN` / `EXPLAIN FORMAT=TREE` を模した表示専用パネル。
 */
export function ExplainPanel(props: {
  readonly row: ExplainRow;
  readonly tree: string;
}): JSX.Element {
  const { row, tree } = props;

  return (
    <div className="explain-panel" data-testid="explain-panel">
      <table className="explain-panel__table">
        <caption className="explain-panel__caption">EXPLAIN</caption>
        <thead>
          <tr>
            <th scope="col">id</th>
            <th scope="col">select_type</th>
            <th scope="col">table</th>
            <th scope="col">type</th>
            <th scope="col">possible_keys</th>
            <th scope="col">key</th>
            <th scope="col">rows</th>
            <th scope="col">Extra</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{row.id}</td>
            <td>{row.select_type}</td>
            <td>{row.table}</td>
            <td>{row.access_type}</td>
            <td>{row.possible_keys === null ? 'NULL' : row.possible_keys.join(',')}</td>
            <td>{row.key === null ? 'NULL' : row.key}</td>
            <td>{row.rows}</td>
            <td>{row.extra === null ? 'NULL' : row.extra}</td>
          </tr>
        </tbody>
      </table>
      <h3 className="explain-panel__tree-heading">EXPLAIN FORMAT=TREE</h3>
      <pre className="explain-panel__tree">{tree}</pre>
    </div>
  );
}
