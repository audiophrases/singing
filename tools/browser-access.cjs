const assert = require('node:assert/strict');

// Simulate Google's UI, while exercising the real Singing sign-in flow and
// isolated identity fixture. No real Google accounts or production credentials.
exports.stubGoogle = (page, who) => page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
  contentType: 'text/javascript', body: `
    window.google = { accounts: { id: {
      initialize(options) { this.callback = options.callback; },
      renderButton(element) {
        const button = document.createElement('button');
        button.textContent = 'Continue with Google';
        button.onclick = () => this.callback({ credential: ${JSON.stringify(who)} });
        element.append(button);
      }
    } } };
  `,
}));

exports.noTeacherTools = async (page) => {
  assert.equal(await page.getByRole('heading', { name: 'Songs from a folder', exact: false }).count(), 0);
  assert.equal(await page.locator('input[type=file]').count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Studio', exact: true }).isVisible(), false);
  assert.equal(await page.getByRole('link', { name: 'Add a song', exact: false }).count(), 0);
};

exports.guestChecks = async (page, base) => {
  await page.goto(base);
  await page.locator('.song-card').first().waitFor();
  await exports.noTeacherTools(page);
  assert.equal(await page.getByRole('button', { name: /sign in/i }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Assignments', exact: true }).isVisible(), false);
  await page.locator('.song-card').first().click();
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Copy and edit', exact: false }).count(), 0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.goto(base + '#/help');
  await page.getByRole('heading', { name: 'How Singing works', exact: false }).waitFor();
  assert.equal(await page.getByText(/upload|import/i).count(), 0, 'public help does not offer upload workflows');
  await page.goto(base + '#/studio');
  await page.waitForURL(/\/create\/#\/studio$/);
  await page.getByRole('heading', { name: 'Teacher access', exact: true }).waitFor();
  assert.equal(await page.locator('input[type=file]').count(), 0);
  console.log('Public play needs no login; guest UI has no upload controls; old Studio links use /create/');
};
