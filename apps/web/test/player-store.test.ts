import { SCENARIOS } from '@db-visualizer/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPlayerStore, type PlayerStore } from '../src/player/store.js';
import { must, nth } from './helpers.js';

/**
 * プレイヤーの状態機械。再生ループ (rAF) は usePlayback 側に置き、
 * ここは「現在位置・再生中・速度・実行結果」だけを持つ純粋な store にする。
 */
describe('プレイヤー store', () => {
  let store: PlayerStore;
  const get = () => store.getState();
  /** 実行済みの Trace。未実行なら前提が崩れているので落とす。 */
  const trace = () => must(get().result, '実行結果').trace;

  beforeEach(() => {
    store = createPlayerStore();
  });

  it('初期状態は未実行で、位置は -1 ・停止中・等速', () => {
    expect(get().result).toBeNull();
    expect(get().error).toBeNull();
    expect(get().index).toBe(-1);
    expect(get().playing).toBe(false);
    expect(get().speed).toBe(1);
    expect(get().sql).toBe(nth(SCENARIOS, 0).sql);
  });

  it('execute で Trace が入り、位置は再生前に戻る', () => {
    get().seek(5);
    get().execute();

    expect(get().error).toBeNull();
    expect(get().result?.trace.length).toBeGreaterThan(0);
    expect(get().result?.explain.access_type).toBe('const');
    expect(get().index).toBe(-1);
  });

  it('サポート範囲外の SQL は例外を投げず「未対応」として error に入る', () => {
    get().setSql("SELECT * FROM users WHERE email LIKE 'a%'");
    expect(() => get().execute()).not.toThrow();

    expect(get().error).toMatch(/未対応/);
    expect(get().result).toBeNull();
  });

  it('実行に失敗しても直前の結果は残さない', () => {
    get().execute();
    expect(get().result).not.toBeNull();

    get().setSql('SELECT * FROM nonexistent_table');
    get().execute();

    expect(get().error).not.toBeNull();
    expect(get().result).toBeNull();
    expect(get().index).toBe(-1);
  });

  it('step(1) で1イベントずつ進む', () => {
    get().execute();

    get().step(1);
    expect(get().index).toBe(0);
    get().step(1);
    expect(get().index).toBe(1);
  });

  it('step(-1) で戻り、-1 より手前には行かない', () => {
    get().execute();
    get().seek(1);

    get().step(-1);
    expect(get().index).toBe(0);
    get().step(-1);
    expect(get().index).toBe(-1);
    get().step(-1);
    expect(get().index).toBe(-1);
  });

  it('末尾まで進むとそこで止まり、再生も停止する', () => {
    get().execute();
    const last = trace().length - 1;
    get().seek(last - 1);
    get().play();

    get().step(1);
    expect(get().index).toBe(last);
    expect(get().playing).toBe(true);

    get().step(1);
    expect(get().index).toBe(last);
    expect(get().playing).toBe(false);
  });

  it('seek は Trace の範囲にクランプされる', () => {
    get().execute();
    const last = trace().length - 1;

    get().seek(999);
    expect(get().index).toBe(last);
    get().seek(-999);
    expect(get().index).toBe(-1);
  });

  it('未実行のときは step も seek も位置を動かさない', () => {
    get().step(1);
    expect(get().index).toBe(-1);
    get().seek(10);
    expect(get().index).toBe(-1);
  });

  it('play / pause / toggle が再生状態を切り替える', () => {
    get().execute();

    get().play();
    expect(get().playing).toBe(true);
    get().pause();
    expect(get().playing).toBe(false);
    get().toggle();
    expect(get().playing).toBe(true);
    get().toggle();
    expect(get().playing).toBe(false);
  });

  it('末尾から再生し直すと先頭に戻る', () => {
    get().execute();
    get().seek(trace().length - 1);

    get().play();
    expect(get().index).toBe(-1);
    expect(get().playing).toBe(true);
  });

  it('実行し直すと再生は止まる', () => {
    get().execute();
    get().play();
    get().execute();

    expect(get().playing).toBe(false);
    expect(get().index).toBe(-1);
  });

  it('速度は 0.25〜4 にクランプされる', () => {
    get().setSpeed(2);
    expect(get().speed).toBe(2);
    get().setSpeed(100);
    expect(get().speed).toBe(4);
    get().setSpeed(0);
    expect(get().speed).toBe(0.25);
  });

  it('プリセットを選ぶと SQL と索引無効化の指定がまとめて入る', () => {
    const noIndex = nth(SCENARIOS, 1);
    get().selectScenario(noIndex.fixture);

    expect(get().sql).toBe(noIndex.sql);
    expect(get().ignoreIndexes).toEqual(noIndex.options.ignoreIndexes ?? []);

    get().execute();
    expect(get().result?.explain.access_type).toBe('ALL');
  });
});
