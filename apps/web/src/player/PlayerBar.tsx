import type { JSX } from 'react';
import { useStore } from 'zustand';
import { MAX_SPEED, MIN_SPEED, type PlayerStore } from './store.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** 再生 / 停止 / 1ステップ / スクラブ / 速度 (DESIGN.md 5)。 */
export function PlayerBar({ store }: { readonly store: PlayerStore }): JSX.Element {
  const index = useStore(store, (s) => s.index);
  const playing = useStore(store, (s) => s.playing);
  const speed = useStore(store, (s) => s.speed);
  const total = useStore(store, (s) => s.result?.trace.length ?? 0);
  const { play, pause, step, seek, setSpeed } = store.getState();

  const ready = total > 0;
  const last = total - 1;

  return (
    <div className="player-bar" data-testid="player-bar">
      <button
        type="button"
        className="player-button"
        data-testid="play-toggle"
        aria-label={playing ? '停止' : '再生'}
        disabled={!ready}
        onClick={() => (playing ? pause() : play())}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <button
        type="button"
        className="player-button"
        data-testid="step-back"
        aria-label="1ステップ戻る"
        disabled={!ready}
        onClick={() => step(-1)}
      >
        ◀|
      </button>
      <button
        type="button"
        className="player-button"
        data-testid="step-forward"
        aria-label="1ステップ進む"
        disabled={!ready}
        onClick={() => step(1)}
      >
        |▶
      </button>

      <input
        type="range"
        className="player-scrub"
        data-testid="scrub"
        aria-label="再生位置"
        min={-1}
        max={ready ? last : 0}
        step={1}
        value={index}
        disabled={!ready}
        onChange={(e) => seek(Number(e.target.value))}
      />

      {/* index は -1 が「未再生」なので、人に見せるときは 1 起点に直す */}
      <output className="player-position" data-testid="position">
        {index + 1} / {total}
      </output>

      <label className="player-speed">
        速度
        <select
          data-testid="speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </label>
      <span className="visually-hidden">
        速度は {MIN_SPEED}x から {MAX_SPEED}x まで
      </span>
    </div>
  );
}
