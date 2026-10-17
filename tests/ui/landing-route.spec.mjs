import { test, expect } from '@playwright/test';

const student = { id: '1', name: 'Test Student', role: 'student', course: 'BSIT', sessionToken: 'a'.repeat(64) };

async function mockApi(page, user = student) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const responses = {
      '/login': { success: true, user },
      '/logout': { success: true },
      '/activity': { success: true },
      '/notifications': { items: [], unreadCount: 0, hasMore: false },
      '/dashboard/stats': { finder: 0, adviser: 0 },
      '/groups': [],
      '/my-group': { group: null },
      '/ai/chat/status': { ai_disabled: true },
    };
    if (!(path in responses)) throw new Error(`Unexpected API call: ${path}`);
    await route.fulfill({ json: responses[path] });
  });
}

test('guests see the landing page at the root URL, including old links and protected pages', async ({ page }) => {
  for (const path of ['/', '/login', '/finder', '/change-password']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Find Your Group for Capstone Projects' })).toBeVisible();
    await page.getByRole('button', { name: 'LOGIN', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  }
});

test('sign in, reload, legacy login links, and logout work at the root URL', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'LOGIN', exact: true }).click();
  await page.getByRole('button', { name: /Student$/ }).click();
  await page.getByPlaceholder('e.g. 2023-00001 or juan@sti.edu.ph').fill('2023-00001');
  await page.getByPlaceholder('Enter your password').fill('Test-password1!');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  await page.goto('/login');
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'LOGIN', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem('jf_user'))).toBeNull();
});

test('the root route still enforces required password changes', async ({ page }) => {
  const user = { ...student, passwordChangeRequired: true };
  await mockApi(page, user);
  await page.addInitScript(saved => sessionStorage.setItem('jf_user', JSON.stringify(saved)), user);
  await page.goto('/');
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
});
