import { expect, type Page, test } from '@playwright/test';

/**
 * docs/PLAN.md M2 の完了条件:
 *   (a) 任意位置で停止できる
 *   (b) スクラブで描画が追従する
 *   (c) clustered.lookup イベントにホバーで解説が出る
 *
 * 3Dシーン (M2-B) を載せたあとも検証は data-testid="scene-state" の DOM に対して行う。
 */

const SCENARIO_1 = 's1-users-email-eq';
const SCENARIO_NO_INDEX = 's1-users-email-eq-noindex';

async function runPreset(page: Page, fixture: string): Promise<void> {
  await page.getByTestId('preset').filter({ has: page.locator(`[data-fixture="${fixture}"]`) });
  await page.locator(`[data-testid="preset"][data-fixture="${fixture}"]`).click();
  await expect(page.getByTestId('scene-state')).toBeVisible();
}

/** スクラブ位置を動かす (range 入力は fill で input/change が飛ぶ)。 */
async function scrubTo(page: Page, index: number): Promise<void> {
  await page.getByTestId('scrub').fill(String(index));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('初期表示に凡例3項目とモバイル注記が出る', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'DB Visualizer', level: 1 })).toBeVisible();

  const legend = page.getByTestId('legend');
  await expect(legend.getByRole('listitem')).toHaveCount(3);
  await expect(legend).toContainText('ディスクI/O');
  await expect(legend).toContainText('バッファプールヒット');
  await expect(legend).toContainText('棄却');

  await expect(page.getByTestId('mobile-note')).toContainText('モバイル非対応');
  await expect(page.getByTestId('scene-placeholder')).toBeVisible();
});

test('プリセットを実行すると EXPLAIN と候補比較が出る', async ({ page }) => {
  await runPreset(page, SCENARIO_1);

  const explain = page.getByTestId('explain-panel');
  await expect(explain).toContainText('const');
  await expect(explain).toContainText('idx_users_email');

  // 不採用の候補もコスト付きで残る (なぜこの索引が選ばれたかを比べるため)
  const candidates = page.getByTestId('candidate');
  await expect(candidates.first()).toBeVisible();
  await expect(page.locator('[data-testid="candidate"][data-chosen="true"]')).toHaveCount(1);
});

test('(a) 再生を任意の位置で止められる', async ({ page }) => {
  await runPreset(page, SCENARIO_NO_INDEX);

  await page.getByTestId('speed').selectOption('4');
  await page.getByTestId('play-toggle').click();

  // 進み始めるのを待ってから止める
  await expect(page.getByTestId('position')).not.toHaveText('0 / 0');
  await expect
    .poll(async () => Number(await page.getByTestId('scrub').inputValue()))
    .toBeGreaterThan(3);

  await page.getByTestId('play-toggle').click();
  const stopped = await page.getByTestId('scrub').inputValue();

  // 止めたあとは進まない
  await page.waitForTimeout(500);
  await expect(page.getByTestId('scrub')).toHaveValue(stopped);
  await expect(page.getByTestId('play-toggle')).toHaveAccessibleName('再生');
});

test('(b) スクラブで描画が追従する', async ({ page }) => {
  await runPreset(page, SCENARIO_NO_INDEX);

  const counters = page.getByTestId('counters');
  const scrub = page.getByTestId('scrub');
  const last = Number(await scrub.getAttribute('max'));
  expect(last).toBeGreaterThan(10);

  await scrubTo(page, last);
  const finalPages = Number(await counters.getAttribute('data-pages-read'));
  const finalRows = await page.getByTestId('result-row').count();
  expect(finalPages).toBeGreaterThan(0);
  expect(finalRows).toBeGreaterThan(0);

  // 途中まで戻すと読んだページも結果行も減る
  await scrubTo(page, Math.floor(last / 4));
  await expect
    .poll(async () => Number(await counters.getAttribute('data-pages-read')))
    .toBeLessThan(finalPages);
  expect(await page.getByTestId('result-row').count()).toBeLessThan(finalRows);

  // 先頭まで戻すと何も読んでいない状態に戻る
  await scrubTo(page, -1);
  await expect(counters).toHaveAttribute('data-pages-read', '0');
  await expect(page.getByTestId('page')).toHaveCount(0);
});

test('(c) clustered.lookup にホバーすると解説が出る', async ({ page }) => {
  await runPreset(page, SCENARIO_1);

  const scrub = page.getByTestId('scrub');
  await scrubTo(page, Number(await scrub.getAttribute('max')));

  const lookup = page.getByTestId('lookup');
  await expect(lookup).toBeVisible();
  await expect(lookup).toHaveAttribute('data-from', 'idx_users_email');

  const term = lookup.locator('[data-testid="term"][data-term="clustered.lookup"]');
  const tooltip = term.getByTestId('term-tooltip');
  await expect(tooltip).toBeHidden();

  await term.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('クラスタ索引への戻り');
  await expect(tooltip).toContainText('カバリング索引');
});

test('現在のイベントの解説が再生位置に追従する', async ({ page }) => {
  await runPreset(page, SCENARIO_1);

  await page.getByTestId('step-forward').click();
  await expect(page.getByTestId('event-type')).toContainText('plan.selected');
  await expect(page.getByTestId('event-detail')).toContainText('実行計画の確定');

  await page.getByTestId('step-forward').click();
  await expect(page.getByTestId('event-type')).toContainText('page.read');
  await expect(page.getByTestId('event-summary')).not.toBeEmpty();
});

test('キーボードで再生と1ステップ操作ができる', async ({ page }) => {
  await runPreset(page, SCENARIO_1);
  await page.getByTestId('scene-state').click();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('scrub')).toHaveValue('0');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('scrub')).toHaveValue('1');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('scrub')).toHaveValue('0');

  await page.keyboard.press(' ');
  await expect(page.getByTestId('play-toggle')).toHaveAccessibleName('停止');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('play-toggle')).toHaveAccessibleName('再生');
});

test('索引の有無でディスクI/Oが数倍変わる', async ({ page }) => {
  const readDiskIo = async () => {
    const scrub = page.getByTestId('scrub');
    await scrubTo(page, Number(await scrub.getAttribute('max')));
    return Number(await page.getByTestId('counters').getAttribute('data-disk-reads'));
  };

  await runPreset(page, SCENARIO_1);
  const withIndex = await readDiskIo();

  await runPreset(page, SCENARIO_NO_INDEX);
  const withoutIndex = await readDiskIo();

  // users は200行 / 1ページ8行なのでフルスキャンはリーフ25枚。
  // 索引経由はセカンダリとクラスタの木を1本ずつ降りるだけ (高さ3 × 2)。
  expect(withIndex).toBeGreaterThan(0);
  expect(withIndex).toBeLessThanOrEqual(6);
  expect(withoutIndex).toBeGreaterThanOrEqual(withIndex * 3);
});

test('サポート範囲外の SQL は「未対応」と表示され、黙って近似しない', async ({ page }) => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type("SELECT * FROM users WHERE email LIKE 'a%'");
  await page.getByTestId('run').click();

  await expect(page.getByTestId('error')).toContainText('未対応');
  await expect(page.getByTestId('scene-state')).toBeHidden();
});
