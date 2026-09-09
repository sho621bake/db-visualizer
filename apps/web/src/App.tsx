import { type JSX, useMemo } from 'react';
import { useStore } from 'zustand';
import { EditorPanel } from './editor/EditorPanel.js';
import { LEGEND } from './legend.js';
import { CandidatesPanel } from './panels/CandidatesPanel.js';
import { EventDetail } from './panels/EventDetail.js';
import { ExplainPanel } from './panels/ExplainPanel.js';
import { PlayerBar } from './player/PlayerBar.js';
import { playerStore } from './player/store.js';
import { usePlayerKeyboard } from './player/useKeyboard.js';
import { usePlayback } from './player/usePlayback.js';
import { ScenePanel } from './scene/ScenePanel.js';
import { sceneStateAt } from './scene/scene-state.js';

const EMPTY_TRACE = Object.freeze([]);

export function App(): JSX.Element {
  const store = playerStore;
  const result = useStore(store, (s) => s.result);
  const index = useStore(store, (s) => s.index);

  usePlayback(store);
  usePlayerKeyboard(store);

  const trace = result?.trace ?? EMPTY_TRACE;
  // Trace は実行時に全件そろっているので、任意位置へのジャンプは畳み込み1回で済む
  const scene = useMemo(() => sceneStateAt(trace, index), [trace, index]);

  // 候補比較は「実行前に何を比べたか」なので、再生位置に関係なく出す
  const planEvent = result?.trace.find((e) => e.type === 'plan.selected');
  const candidates = planEvent?.type === 'plan.selected' ? planEvent.candidates : [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>DB Visualizer</h1>
        <p className="lead">MySQL (InnoDB) がクエリをどう実行するかを1ステップずつ再生します。</p>
        <ul className="legend" data-testid="legend">
          {LEGEND.map((item) => (
            <li key={item.id} className="legend-item">
              <span className="legend-swatch" style={{ backgroundColor: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      </header>

      <div className="layout">
        <aside className="column column--editor">
          <EditorPanel store={store} />
        </aside>

        <main className="column column--scene">
          {result ? (
            <ScenePanel state={scene} />
          ) : (
            <p className="scene-empty" data-testid="scene-placeholder">
              左のプリセットを選ぶか SQL を書いて「実行」を押してください。
            </p>
          )}
        </main>

        <aside className="column column--panels">
          {result ? (
            <>
              <ExplainPanel row={result.explain} tree={result.explainTree} />
              <CandidatesPanel candidates={candidates} />
            </>
          ) : null}
          <EventDetail event={scene.event} />
        </aside>
      </div>

      <footer className="app-footer">
        <PlayerBar store={store} />
        <p className="note" data-testid="mobile-note">
          モバイル非対応です。デスクトップのブラウザで開いてください。
        </p>
      </footer>
    </div>
  );
}
