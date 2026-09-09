import {
  type RunResult,
  run,
  SCENARIOS,
  type Scenario,
  scenarioByFixture,
} from '@db-visualizer/engine';
import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * プレイヤーの状態機械 (DESIGN.md 5)。
 *
 * ここには「現在位置・再生中・速度・実行結果」しか置かない。
 * 時間を進める rAF ループは usePlayback に分けてある (store を DOM 非依存に保ち、
 * タイマーを動かさずに状態遷移をテストできるようにするため)。
 */

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

function firstScenario(): Scenario {
  const scenario = SCENARIOS[0];
  if (!scenario) throw new Error('シナリオが1つもありません');
  return scenario;
}

const DEFAULT_SCENARIO = firstScenario();

export interface PlayerState {
  readonly sql: string;
  /** MySQL の `IGNORE INDEX (...)` に相当する対比用の指定 (FIDELITY.md)。 */
  readonly ignoreIndexes: readonly string[];
  readonly result: RunResult | null;
  readonly error: string | null;
  /** 現在位置。-1 は「まだ何も起きていない」。 */
  readonly index: number;
  readonly playing: boolean;
  readonly speed: number;

  setSql(sql: string): void;
  setIgnoreIndexes(indexes: readonly string[]): void;
  selectScenario(fixture: string): void;
  execute(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  step(delta: number): void;
  seek(index: number): void;
  setSpeed(speed: number): void;
}

export type PlayerStore = StoreApi<PlayerState>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createPlayerStore(): PlayerStore {
  return createStore<PlayerState>()((set, get) => {
    /** Trace の最終位置。未実行なら -1 で、あらゆる移動が封じられる。 */
    const lastIndex = (): number => (get().result?.trace.length ?? 0) - 1;

    return {
      sql: DEFAULT_SCENARIO.sql,
      ignoreIndexes: DEFAULT_SCENARIO.options.ignoreIndexes ?? [],
      result: null,
      error: null,
      index: -1,
      playing: false,
      speed: 1,

      setSql: (sql) => set({ sql }),

      setIgnoreIndexes: (ignoreIndexes) => set({ ignoreIndexes: [...ignoreIndexes] }),

      selectScenario: (fixture) => {
        const scenario = scenarioByFixture(fixture);
        set({
          sql: scenario.sql,
          ignoreIndexes: scenario.options.ignoreIndexes ?? [],
        });
      },

      execute: () => {
        const { sql, ignoreIndexes } = get();
        try {
          const result = run(sql, { ignoreIndexes });
          set({ result, error: null, index: -1, playing: false });
        } catch (e) {
          // サポート範囲外は黙って近似せず、そのまま文言を出す (DESIGN.md 9)
          const error = e instanceof Error ? e.message : String(e);
          set({ result: null, error, index: -1, playing: false });
        }
      },

      play: () => {
        if (!get().result) return;
        // 末尾で再生を押したら頭から見直す
        const index = get().index >= lastIndex() ? -1 : get().index;
        set({ playing: true, index });
      },

      pause: () => set({ playing: false }),

      toggle: () => {
        if (get().playing) get().pause();
        else get().play();
      },

      step: (delta) => {
        const last = lastIndex();
        if (last < 0) return;
        const next = clamp(get().index + delta, -1, last);
        // 末尾に着いたあとさらに進めようとしたら再生を終える
        if (next === get().index && delta > 0) set({ playing: false });
        else set({ index: next });
      },

      seek: (index) => {
        const last = lastIndex();
        if (last < 0) return;
        set({ index: clamp(Math.trunc(index), -1, last) });
      },

      setSpeed: (speed) => set({ speed: clamp(speed, MIN_SPEED, MAX_SPEED) }),
    };
  });
}

/** アプリ全体で共有する store。テストは createPlayerStore を使って隔離する。 */
export const playerStore = createPlayerStore();
