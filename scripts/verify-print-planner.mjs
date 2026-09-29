// Shared by the isolated demo rehearsal and local preview review. No catalog writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

export async function verifyPrintPlanner(page, base, evidenceDir) {
  const originalViewport = page.viewportSize();
  const writes = [];
  const track = request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + new URL(request.url()).pathname); };
  page.on('request', track);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(base + '/admin/catalog', { waitUntil: 'networkidle' });
  await page.getByText('Internal layout reference', { exact: true }).click();
  await page.locator('a[href="/admin/catalog/planner?template=13x19_composite"]').click();
  await expect(page.getByRole('heading', { name: 'Print package planner', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 sheet. Every print full-size.', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Quantity: wallet', exact: false })).toHaveCount(1);
  await expect(page.locator('.paper-dimensions')).toHaveText('12.9528 × 19.0157 in');
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) await page.getByRole('spinbutton', { name: `${side} margin (in)`, exact: true }).fill('0.5');
  await expect(page.getByRole('heading', { name: '1 sheet. Every print full-size.', exact: true })).toBeVisible();
  const alternatives = page.getByRole('group', { name: 'Choose an arrangement', exact: true }).getByRole('button');
  assert.ok(await alternatives.count() >= 2);
  await alternatives.nth(1).click();
  await expect(alternatives.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await alternatives.first().click();
  const diagram = page.locator('.paper-wrap');
  await expect(diagram.getByRole('button')).toHaveCount(7);
  await diagram.getByRole('button').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.measurement')).toContainText('X ');
  const geometry = () => diagram.getByRole('button').evaluateAll(nodes => nodes.map(n => n.getAttribute('style')));
  const inches = await geometry();
  await page.getByRole('button', { name: 'Millimetres', exact: true }).click();
  await expect(page.locator('.paper-dimensions')).toHaveText('329 × 483 mm');
  assert.deepEqual(await geometry(), inches, 'Unit toggle changed geometry');
  await page.getByText('View placement table (mm)', { exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(7);
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reference', exact: true }).click();
  const download = await downloadWait;
  const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const reference = Buffer.concat(chunks).toString('utf8');
  assert.match(reference, /329 × 483 mm/);
  assert.match(reference, /not an importable Lightroom template/);
  assert.equal(reference.split('\n').filter(l => /^\d+\t/.test(l)).length, 7);
  const table = await page.locator('tbody tr').allTextContents();
  assert.equal(table.length, 7);
  await page.getByRole('button', { name: 'Inches', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Quantity: 8x10', exact: true }).fill('3');
  await expect(diagram.getByRole('button')).not.toHaveCount(0);
  const sheets = page.getByRole('navigation', { name: 'Sheets', exact: true });
  assert.ok(await sheets.getByRole('button').count() >= 2);
  await sheets.getByRole('button', { name: 'Sheet 2', exact: true }).click();
  await expect(sheets.getByRole('button', { name: 'Sheet 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Explore 5 × 7 in', exact: true }).click();
  await expect(page.getByText(/8x10.*exceeds the usable sheet area/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download reference', exact: true })).toHaveCount(0);
  await page.getByLabel('Paper size', { exact: true }).selectOption('custom');
  await page.getByLabel('Paper width (in)', { exact: true }).fill('13');
  await page.getByLabel('Paper height (in)', { exact: true }).fill('19');
  await expect(page.locator('.paper-dimensions')).toHaveText('13 × 19 in');
  await page.getByLabel('Top margin (in)', { exact: true }).fill('30');
  await expect(page.getByText('The margins leave no printable area.', { exact: true })).toBeVisible();
  await page.getByLabel('Top margin (in)', { exact: true }).fill('0');
  await expect(page.getByText(/zero margin may require borderless/)).toBeVisible();
  await page.getByLabel('Quantity: 8x10', { exact: true }).fill('1.5');
  await expect(page.getByText('Use whole quantities from 0 to 60.', { exact: true })).toBeVisible();

  // Re-enter through a product link, then inspect desktop and small-screen interactions.
  await page.goto(base + '/admin/catalog', { waitUntil: 'networkidle' });
  await page.locator('a[href="/admin/catalog/planner?product=3"]').click();
  await expect(page.getByRole('heading', { name: '1 sheet. Every print full-size.', exact: true })).toBeVisible();
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, 'planner-desktop.png'), fullPage: true });
    await page.screenshot({ path: path.join(evidenceDir, 'planner-desktop-viewport.png') });
  }
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
    await expect(page.locator('#planner-controls')).toBeHidden();
    await expect(page.locator('.paper-wrap')).toBeVisible();
    await page.getByRole('button', { name: 'Edit package & paper · 7 prints', exact: true }).click();
    await expect(page.getByLabel('Quantity: 8x10', { exact: true })).toBeVisible();
    await page.getByLabel('Quantity: 8x10', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Hide package & paper settings', exact: true }).click();
    await expect(page.locator('.stats')).toContainText('8');
    await page.locator('.paper-wrap').scrollIntoViewIfNeeded();
    await page.locator('.paper-wrap').getByRole('button').first().click();
    await expect(page.locator('.measurement')).toContainText('X ');
    if (evidenceDir && width === 390) await page.screenshot({ path: path.join(evidenceDir, 'planner-mobile.png'), fullPage: true });
  }
  page.off('request', track);
  assert.deepEqual(writes, [], 'Planner issued a server write');
  if (originalViewport) await page.setViewportSize(originalViewport);
  console.log('PASS print planner: exact A3+, controls, alternate layouts, unit invariance, keyboard selection, multi-sheet plans, impossible states, handoff and mobile; no server writes');
}
