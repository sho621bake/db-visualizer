import { SCENARIOS } from '@db-visualizer/engine';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import type { PlayerStore } from '../player/store.js';
import { SqlEditor } from './SqlEditor.js';

/** SQLエディタ + シナリオプリセット + 実行 (DESIGN.md 5 の左カラム)。 */
export function EditorPanel({ store }: { readonly store: PlayerStore }): JSX.Element {
  const sql = useStore(store, (s) => s.sql);
  const error = useStore(store, (s) => s.error);
  const ignoreIndexes = useStore(store, (s) => s.ignoreIndexes);
  const { setSql, selectScenario, execute } = store.getState();

  return (
    <div className="editor-panel">
      <h2>SQL</h2>

      <ul className="presets" data-testid="presets">
        {SCENARIOS.map((scenario) => (
          <li key={scenario.fixture}>
            <button
              type="button"
              className="preset"
              data-testid="preset"
              data-fixture={scenario.fixture}
              onClick={() => {
                selectScenario(scenario.fixture);
                execute();
              }}
            >
              {scenario.name}
            </button>
          </li>
        ))}
      </ul>

      <SqlEditor value={sql} onChange={setSql} />

      {ignoreIndexes.length > 0 ? (
        <p className="ignore-indexes" data-testid="ignore-indexes">
          索引を無効化: <code>{ignoreIndexes.join(', ')}</code>
          <span className="ignore-indexes-note">
            {/* サポート範囲に IGNORE INDEX 構文を入れないための表現 (FIDELITY.md) */}
            MySQL の <code>IGNORE INDEX</code> ヒントに対応します
          </span>
        </p>
      ) : null}

      <button type="button" className="run" data-testid="run" onClick={() => execute()}>
        実行
      </button>

      {error ? (
        <p className="error" data-testid="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
