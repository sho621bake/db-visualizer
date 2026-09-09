import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorPanel } from '../src/editor/EditorPanel.js';
import { createPlayerStore, type PlayerStore } from '../src/player/store.js';

describe('EditorPanel', () => {
  let store: PlayerStore;
  const get = () => store.getState();

  beforeEach(() => {
    store = createPlayerStore();
    render(<EditorPanel store={store} />);
  });

  it('3本のシナリオをプリセットとして出す', () => {
    expect(screen.getAllByTestId('preset')).toHaveLength(3);
  });

  it('プリセットを押すと SQL が入れ替わってそのまま実行される', async () => {
    const user = userEvent.setup();
    const noIndex = screen
      .getAllByTestId('preset')
      .find((b) => b.dataset.fixture === 's1-users-email-eq-noindex');

    await user.click(noIndex as HTMLElement);

    expect(get().sql).toContain('users');
    expect(get().ignoreIndexes).toEqual(['idx_users_email']);
    expect(get().result?.explain.access_type).toBe('ALL');
    expect(screen.getByTestId('ignore-indexes')).toHaveTextContent('idx_users_email');
  });

  it('実行ボタンで Trace が生成される', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByTestId('run'));

    expect(get().result?.trace.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('error')).toBeNull();
  });

  it('サポート範囲外の SQL は「未対応」として画面に出る', async () => {
    const user = userEvent.setup();
    get().setSql("SELECT * FROM users WHERE email LIKE 'a%'");
    await user.click(screen.getByTestId('run'));

    const error = screen.getByTestId('error');
    expect(error).toHaveTextContent('未対応');
    expect(get().result).toBeNull();
  });
});
