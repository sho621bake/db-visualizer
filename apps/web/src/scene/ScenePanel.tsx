import type { JSX } from 'react';
import { Term } from '../glossary/Term.js';
import type { SceneState } from './scene-state.js';

/**
 * SceneState を DOM に写すシーン (DESIGN.md 5 の中央カラム)。
 *
 * M2-B で three.js の canvas を重ねたあとも、この DOM は
 * スクリーンリーダーと e2e のために残す。`data-*` は e2e の契約なので変えない。
 */
export function ScenePanel({ state }: { readonly state: SceneState }): JSX.Element {
  const { pages, btreePath, lookup, rows, filter, counters, focus } = state;
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="scene" data-testid="scene-state" aria-live="polite">
      <section className="scene-section" aria-labelledby="scene-btree">
        <h3 id="scene-btree">
          <Term type="btree.descend">B+Tree の探索</Term>
        </h3>
        {btreePath.length === 0 ? (
          <p className="scene-empty">まだ索引を降りていません。</p>
        ) : (
          <ol className="btree-path">
            {btreePath.map((node) => (
              <li
                key={node.pageId}
                className="btree-node"
                data-testid="btree-node"
                data-btree-node={node.pageId}
                data-level={node.level}
                data-index={node.index}
              >
                <span className="btree-level">
                  {node.level === 0 ? 'リーフ' : `L${node.level}`}
                </span>
                <code>{node.pageId}</code>
              </li>
            ))}
          </ol>
        )}
        {lookup ? (
          <p className="lookup" data-testid="lookup" data-from={lookup.from} data-pk={lookup.pk}>
            <Term type="clustered.lookup">
              {lookup.from} → クラスタ索引 ({lookup.table} の主キー {String(lookup.pk)})
            </Term>
          </p>
        ) : null}
      </section>

      <section className="scene-section" aria-labelledby="scene-pages">
        <h3 id="scene-pages">
          <Term type="page.read">読んだページ</Term>
        </h3>
        {pages.length === 0 ? (
          <p className="scene-empty">まだページを読んでいません。</p>
        ) : (
          <ul className="pages">
            {pages.map((page) => (
              <li
                key={page.pageId}
                className="page"
                data-testid="page"
                data-page={page.pageId}
                data-source={page.lastSource}
                data-reads={page.reads}
                data-disk-reads={page.diskReads}
                data-focused={focus.pageId === page.pageId ? 'true' : 'false'}
                title={`${page.pageId} / ${page.reads}回読み込み (ディスク ${page.diskReads}回)`}
              >
                <span className="page-id">{page.pageId}</span>
                {page.reads > 1 ? <span className="page-reads">×{page.reads}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="scene-section" aria-labelledby="scene-rows">
        <h3 id="scene-rows">
          <Term type="row.emit">結果</Term>
        </h3>
        <div className="result-grid-wrap">
          <table className="result-grid" data-testid="result-grid" data-row-count={rows.length}>
            <caption className="visually-hidden">クエリの結果集合</caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                // 同じ内容の行が複数あり得るので、到着順を key にする
                // biome-ignore lint/suspicious/noArrayIndexKey: 結果行は到着順で一意に識別する
                <tr key={i} className="result-row" data-testid="result-row">
                  {columns.map((column) => (
                    <td key={column}>{String(row[column] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <dl
        className="counters"
        data-testid="counters"
        data-pages-read={counters.pagesRead}
        data-disk-reads={counters.diskReads}
        data-buffer-hits={counters.bufferHits}
        data-rows-read={counters.rowsRead}
        data-rows-emitted={counters.rowsEmitted}
      >
        <div className="counter">
          <dt>読んだページ</dt>
          <dd>{counters.pagesRead}</dd>
        </div>
        <div className="counter counter--disk">
          <dt>ディスクI/O</dt>
          <dd>{counters.diskReads}</dd>
        </div>
        <div className="counter counter--hit">
          <dt>バッファプールヒット</dt>
          <dd>{counters.bufferHits}</dd>
        </div>
        <div className="counter">
          <dt>読み出した行</dt>
          <dd>{counters.rowsRead}</dd>
        </div>
        <div className="counter counter--rejected">
          <dt>棄却した行</dt>
          <dd>{filter.rejected}</dd>
        </div>
        <div className="counter">
          <dt>返した行</dt>
          <dd>{counters.rowsEmitted}</dd>
        </div>
      </dl>
    </div>
  );
}
