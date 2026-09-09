import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerBar } from '../src/player/PlayerBar.js';
import { createPlayerStore, type PlayerStore } from '../src/player/store.js';
import { stepIntervalMs } from '../src/player/usePlayback.js';
import { must } from './helpers.js';

describe('PlayerBar', () => {
  let store: PlayerStore;
  const get = () => store.getState();

  beforeEach(() => {
    store = createPlayerStore();
    get().execute();
    render(<PlayerBar store={store} />);
  });

  it('未実行のときは操作を無効にする', async () => {
    const empty = createPlayerStore();
    render(<PlayerBar store={empty} />);
    const bars = screen.getAllByTestId('player-bar');
    const idle = must(bars.at(-1), '2つ目のプレイヤーバー');

    for (const testId of ['play-toggle', 'step-back', 'step-forward', 'scrub']) {
      expect(within(idle).getByTestId(testId)).toBeDisabled();
    }
  });

  it('再生ボタンで再生と停止を切り替える', async () => {
    const user = userEvent.setup();
    const toggle = screen.getByTestId('play-toggle');

    await user.click(toggle);
    expect(get().playing).toBe(true);
    expect(toggle).toHaveAccessibleName('停止');

    await user.click(toggle);
    expect(get().playing).toBe(false);
    expect(toggle).toHaveAccessibleName('再生');
  });

  it('1ステップ進む・戻るで位置が1つずつ動く', async () => {
    const user = userEvent.setup();

    await user.click(screen.getByTestId('step-forward'));
    expect(get().index).toBe(0);
    await user.click(screen.getByTestId('step-forward'));
    expect(get().index).toBe(1);
    await user.click(screen.getByTestId('step-back'));
    expect(get().index).toBe(0);
  });

  it('スクラブで任意位置へ飛べる', () => {
    const scrub = screen.getByTestId('scrub');
    const last = must(get().result, '実行結果').trace.length - 1;

    expect(scrub).toHaveAttribute('min', '-1');
    expect(scrub).toHaveAttribute('max', String(last));

    fireEvent.change(scrub, { target: { value: '7' } });
    expect(get().index).toBe(7);
  });

  it('現在位置を「現在 / 全体」で示す', async () => {
    const user = userEvent.setup();
    const last = must(get().result, '実行結果').trace.length - 1;

    expect(screen.getByTestId('position')).toHaveTextContent(`0 / ${last + 1}`);
    await user.click(screen.getByTestId('step-forward'));
    expect(screen.getByTestId('position')).toHaveTextContent(`1 / ${last + 1}`);
  });

  it('速度を選ぶと store に反映される', async () => {
    const user = userEvent.setup();

    await user.selectOptions(screen.getByTestId('speed'), '4');
    expect(get().speed).toBe(4);
    await user.selectOptions(screen.getByTestId('speed'), '0.25');
    expect(get().speed).toBe(0.25);
  });
});

describe('stepIntervalMs', () => {
  it('等速では1イベントあたり既定の間隔になる', () => {
    expect(stepIntervalMs(1)).toBeGreaterThan(0);
  });

  it('速度を上げると間隔が反比例して縮む', () => {
    expect(stepIntervalMs(2)).toBe(stepIntervalMs(1) / 2);
    expect(stepIntervalMs(0.25)).toBe(stepIntervalMs(1) * 4);
  });
});
