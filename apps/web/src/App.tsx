import { LEGEND } from './legend.js';

export function App() {
  return (
    <main className="app">
      <h1>InnoDB Visualizer</h1>
      <p className="lead">
        MySQL (InnoDB) のクエリ実行を3Dアニメーションで学ぶサイト。3Dシーンは M2
        で実装します。現在は足場のみです。
      </p>

      <section aria-labelledby="legend-heading">
        <h2 id="legend-heading">凡例</h2>
        <ul className="legend" data-testid="legend">
          {LEGEND.map((item) => (
            <li key={item.id} className="legend-item">
              <span className="legend-swatch" style={{ backgroundColor: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      </section>

      <p className="note" data-testid="mobile-note">
        モバイル非対応です。デスクトップのブラウザで開いてください。
      </p>
    </main>
  );
}
