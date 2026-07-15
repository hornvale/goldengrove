import { expect, test } from '@playwright/test';

test('seed 42 boots, renders, and stays console-clean', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('#seed=42');
  // Genesis runs in-browser and takes seconds; the HUD only mounts after.
  await expect(page.locator('.hud-top-left')).toContainText('seed 42', { timeout: 150_000 });
  await expect(page.locator('canvas.view-canvas')).toHaveCount(2);
  await expect(page.locator('.scale-caption')).toContainText('schematic scale');

  // The view toggle is the zoom ladder's discrete control.
  await page.getByRole('button', { name: /view: globe/ }).click();
  await expect(page.locator('.scale-caption')).toContainText('relief is exaggerated', { timeout: 10_000 });

  expect(errors).toEqual([]);
});

test('the helm: true scale, inspector, and the capped globe clock', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('#seed=42&view=globe');
  await expect(page.locator('.hud-top-left')).toContainText('seed 42', { timeout: 150_000 });

  // Per-rung clock: at the globe the blur rates are disabled.
  await expect(page.getByRole('button', { name: '~1 mo/s' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '1 hr/s' })).toHaveClass(/active/);

  // True scale flips the caption to the honest variant, and the label back.
  await page.getByRole('button', { name: 'true scale' }).click();
  await expect(page.locator('.scale-caption')).toContainText('true scale');
  await page.getByRole('button', { name: 'schematic scale' }).click();

  // The inspector: the globe fills the viewport center — clicking it is a
  // world card, deterministically.
  await page.locator('canvas.view-canvas').last().click({ position: { x: 640, y: 360 } });
  await expect(page.locator('.info-card')).toContainText('the world');
  await page.keyboard.press('Escape');
  await expect(page.locator('.info-card')).toBeHidden();

  expect(errors).toEqual([]);
});
