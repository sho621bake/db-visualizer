import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { PlayerStore } from './store.js';

/** 等速 (1x) で1イベントを表示する時間 (ms)。 */
export const BASE_STEP_MS = 220;

/** 速度から1イベントあたりの表示時間を出す。速度は反比例。 */
export function stepIntervalMs(speed: number): number {
  return BASE_STEP_MS / speed;
}

/**
 * 再生中に Trace を1イベントずつ進める。
 *
 * 時間の管理を store から追い出しているので、store 側は
 * タイマーを動かさずに状態遷移だけをテストできる。
 * 経過時間で進めるため、フレーム落ちしても再生速度は保たれる。
 */
export function usePlayback(store: PlayerStore): void {
  const playing = useStore(store, (s) => s.playing);
  const speed = useStore(store, (s) => s.speed);

  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    let carried = 0;
    let previous: number | null = null;
    const interval = stepIntervalMs(speed);

    const tick = (now: number) => {
      if (previous !== null) {
        carried += now - previous;
        // 溜まった時間ぶんだけまとめて進める (高速再生でフレーム数に縛られないため)
        while (carried >= interval && store.getState().playing) {
          carried -= interval;
          store.getState().step(1);
        }
      }
      previous = now;
      if (store.getState().playing) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, store]);
}
