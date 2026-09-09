import { expect, test } from '@playwright/test';

test('プレースホルダ画面に凡例3項目とモバイル注記が表示される', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'InnoDB Visualizer', level: 1 })).toBeVisible();

  const legend = page.getByTestId('legend');
  await expect(legend.getByRole('listitem')).toHaveCount(3);
  await expect(legend).toContainText('ディスクI/O');
  await expect(legend).toContainText('バッファプールヒット');
  await expect(legend).toContainText('棄却');

  await expect(page.getByTestId('mobile-note')).toContainText('モバイル非対応');
});
