import { expect, test } from '@playwright/test';

// The Content-Security-Policy production Apache sends for every game on
// games.soncrant.com. Source of truth: soncsec/games-portal
// deploy/apache/games-vhost.conf. Keep this copy in sync with it.
const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self'; media-src 'self' data: blob:; worker-src 'self' blob:; " +
  "object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";

test('the game runs under the production Content-Security-Policy', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': PRODUCTION_CSP },
    });
  });

  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.exposeFunction('reportCspViolation', (v: string) => problems.push(`CSP: ${v}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { reportCspViolation(v: string): void }).reportCspViolation(
        `${e.violatedDirective} blocked ${e.blockedURI}`,
      );
    });
  });

  await page.goto('./');
  await expect.poll(() => page.evaluate(() => window.__game?.scene() ?? null)).toBe('Game');
  // The page stylesheet applied: the canvas is centred by the flex container.
  expect(
    await page.evaluate(() => {
      const el = document.getElementById('game');
      return el ? getComputedStyle(el).display : null;
    }),
  ).toBe('flex');
  // Play for a moment so input and rendering run under the policy.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  expect(problems).toEqual([]);
});
