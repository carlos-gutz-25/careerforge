// The M1-02 XSS acceptance criterion, end-to-end for real: a live payload
// pasted through the REAL form into the REAL API, rendered by the REAL
// browser — and proven inert. Also proves pin 2 end-to-end: a re-paste lands
// on the STORED posting with the duplicate notice. All data fictional.
import { expect, test } from '@playwright/test';

import { E2E_BOOTSTRAP_EMAIL, E2E_BOOTSTRAP_PASSWORD } from './e2e-env.mjs';

// Script execution, event-handler injection, markup-looking text, plus the
// newline/indentation shapes pre-wrap must preserve.
const PAYLOAD = [
  '<script>document.body.dataset.xssExecuted = "fictional-e2e-marker"</script>',
  'Senior Software Engineer — Fictional Widgets Inc.',
  '  responsibilities:',
  '    - build fictional systems with tests',
  '<img src=x onerror="document.body.dataset.xssExecuted = \'fictional-e2e-marker\'">',
  'Final line & <b>markup-looking</b> text.',
].join('\n');

test('XSS payload: ingest through the form → detail render → inert; re-paste → duplicate notice on the stored posting', async ({
  page,
}) => {
  // Any dialog (alert/confirm/prompt) means a payload executed — fail loudly.
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  // Unauthenticated deep link → login (the auth middleware), then through
  // the real login form with the throwaway fictional bootstrap pair.
  await page.goto('/postings/new');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel('Email').fill(E2E_BOOTSTRAP_EMAIL);
  await page.getByLabel('Password').fill(E2E_BOOTSTRAP_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/postings/new');

  // Paste the payload through the real form.
  await page.getByLabel('Posting text').fill(PAYLOAD);
  await page.getByLabel(/Company/).fill('Fictional Widgets Inc.');
  await page.getByRole('button', { name: 'Save posting' }).click();

  // Fresh paste → detail, no duplicate flag.
  await expect(page).toHaveURL(/\/postings\/[0-9a-f-]{36}$/);
  const detailUrl = page.url();

  // — The rendering law, observed in a real DOM —
  const raw = page.getByTestId('posting-raw');
  await expect(raw).toBeVisible();
  // Byte-identical text content: escaping altered nothing.
  expect(await raw.textContent()).toBe(PAYLOAD);
  // Text node only: the payload never became elements.
  expect(await raw.evaluate((el) => el.children.length)).toBe(0);
  expect(await raw.locator('script, img, b').count()).toBe(0);
  // Nothing executed: no dialog, no marker side effect.
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.body.dataset.xssExecuted)).toBeUndefined();
  // Newlines survive via CSS pre-wrap (proven, not assumed) — never \n→<br>.
  expect(await raw.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');

  // — The list AC, through the UI —
  await page.getByRole('link', { name: 'Postings' }).click();
  const row = page.locator('tbody tr').first();
  await expect(row).toContainText('Fictional Widgets Inc.');
  await expect(row).toContainText('new');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(detailUrl);

  // — Pin 2 end-to-end: re-paste → SERVER's duplicate boolean → stored posting —
  await page.goto('/postings/new');
  await page.getByLabel('Posting text').fill(PAYLOAD);
  await page.getByLabel(/Title/).fill('Late Metadata That Must Be Discarded');
  await page.getByRole('button', { name: 'Save posting' }).click();

  await expect(page).toHaveURL(`${detailUrl}?duplicate=true`);
  await expect(page.getByRole('status')).toContainText('already pasted');
  // First write wins: the stored posting's metadata, not the re-paste's.
  await expect(page.getByText('Late Metadata That Must Be Discarded')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Untitled posting');
});
