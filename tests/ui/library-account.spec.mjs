import { test, expect } from '@playwright/test';

test('admin can create a non-expiring library account with only a username and password', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('jf_user', JSON.stringify({
    id: '1',
    name: 'System Admin',
    role: 'admin',
    sessionToken: 'a'.repeat(64),
  })));

  let createPayload;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    if (path === '/notifications') {
      return route.fulfill({ json: { items: [], unreadCount: 0, hasMore: false, nextCursor: null } });
    }
    if (path === '/admin/summary') {
      return route.fulfill({ json: { users: 1, activeUsers: 1, students: 0, advisers: 0, groups: 0, openGroups: 0 } });
    }
    if (path === '/admin/users') {
      const libraryRole = url.searchParams.get('role') === 'library';
      return route.fulfill({ json: {
        items: libraryRole ? [
          { UserID: 3, UserCode: 'ADV-001', Username: 'adviser@example.com', Name: 'Adviser User', Role: 'adviser', IsActive: true },
          ...(createPayload ? [{
            UserID: 2, UserCode: 'LIB-generated', Username: createPayload.username,
            Name: createPayload.username, Role: 'library', IsActive: true,
          }] : []),
        ] : [],
        total: libraryRole ? (createPayload ? 2 : 1) : 0,
        page: 1, pageSize: 10, totalPages: 1,
      } });
    }
    if (path === '/admin/groups') return route.fulfill({ json: [] });
    if (path === '/admin/courses') return route.fulfill({ json: [] });
    if (path === '/admin/library-users' && request.method() === 'POST') {
      createPayload = request.postDataJSON();
      return route.fulfill({ status: 201, json: { success: true, user: { Username: createPayload.username } } });
    }
    throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  });

  await page.goto('/');
  await page.locator('.admin-tabs button').filter({ hasText: 'Library' }).click();
  await page.locator('.admin-panel-actions .admin-add').click();

  const form = page.locator('.admin-form');
  await expect(form.getByRole('heading', { name: 'Add Library' })).toBeVisible();
  await expect(form.getByLabel('User ID')).toHaveCount(0);
  await expect(form.getByLabel('Expires At')).toHaveCount(0);
  await form.getByLabel('Username').fill('librarian@example.com');
  await form.getByLabel('Password').fill('LibraryPass1!');
  await form.locator('.admin-submit').click();

  await expect.poll(() => createPayload).toEqual({
    username: 'librarian@example.com',
    password: 'LibraryPass1!',
  });
  await expect(page.locator('.admin-table tbody tr td:nth-child(2)')).toContainText('librarian@example.com');
  await expect(page.getByText('Adviser User', { exact: true })).toHaveCount(0);
  await expect(page.locator('.admin-table thead')).not.toContainText('Expiration');
});
