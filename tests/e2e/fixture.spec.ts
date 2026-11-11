// Covers the fixture page in every engine: the built element modules load
// without errors, and axe finds no WCAG 2.2 AA violations.
//
// Not covered yet: element behaviour, layout shift and network budgets. Those
// arrive with the milestone that builds each element, because in M0 there is
// no behaviour to measure.

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the fixture page loads every element module without an error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => errors.push(`failed to load ${request.url()}`));

  const response = await page.goto('/examples/html/');
  expect(response?.ok(), 'the fixture page itself did not load').toBe(true);
  await page.waitForLoadState('networkidle');

  expect(errors, 'errors while loading the fixture page').toEqual([]);
});

test('the fixture page has no WCAG 2.2 AA violations', async ({ page }) => {
  await page.goto('/examples/html/');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`), 'axe violations').toEqual([]);
});
