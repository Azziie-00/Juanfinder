import { test, expect } from '@playwright/test';

const group = {
  GroupID: 1, GroupName: 'Capstone Student Research Team', Course: 'BSIT', MemberCount: 3,
  Members: [
    { UserID: 1, Name: 'Juan Dela Cruz', IsLeader: true },
    { UserID: 2, Name: 'Maria Santos', IsLeader: false },
    { UserID: 3, Name: 'Alexandria Student With A Longer Name', IsLeader: false },
  ],
};

async function setup(page, role = 'adviser', adviserCourse = ' \tbsit ', groupCourse = ' bSiT ') {
  await page.addInitScript(role => sessionStorage.setItem('jf_user', JSON.stringify({ id: role === 'student' ? '1' : '10', name: 'Test User', role, sessionToken: 'a'.repeat(64) })), role);
  const actions = [];
  let pending = [{ ApplicationID: 20, GroupName: 'Pending Team', Course: 'BSIT', Applicant: 'Leader', Members: ['Leader', 'Member'], CreatedAt: '2026-10-16T00:00:00Z', Requirement: null }];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
      if (path === '/api/activity' || path === '/activity') return route.fulfill({ json: { success: true } });
    let data;
    if (path === '/notifications') data = { items: [], unreadCount: 0, hasMore: false, nextCursor: null };
    else if (path === '/adviser/groups') data = [group];
    else if (path === '/adviser/dashboard') data = { AdviserName: 'Test User', Summary: { Groups: 1, StudentMembers: 3, Capacity: 10, AvailableSlots: 9 }, Groups: [{ ...group, Members: group.Members.map(m => ({ ...m, UserCode: String(m.UserID), Course: 'BSIT' })) }] };
    else if (path === '/adviser/applications') data = pending;
    else if (path.endsWith('/respond')) {
      actions.push(route.request().postDataJSON()); pending = []; data = { success: true, status: 'Rejected' };
    } else if (path === '/my-group') data = { group: { ...group, Course: groupCourse, OwnerID: 1, FinalizedAt: '2026-10-16', MembershipStatus: 'Member', AdviserID: null } };
    else if (path === '/groups/1/adviser-application') data = { application: null };
    else if (path === '/groups/1/adviser-applications') {
      actions.push(route.request().postDataJSON()); data = { application: { ApplicationID: 1, AdviserName: 'Matching Adviser', Status: 'Pending' } };
    } else if (path === '/advisers') data = [adviserCourse, 'BSCS', '', 'Unspecified'].map((Course, i) => ({ UserID: 10 + i, Name: i === 0 ? 'Matching Adviser' : `Other Adviser ${i}`, Course, Availability: 10, AssignedGroups: 0, HasCapacity: true }));
    else throw new Error(`Unexpected API request: ${path}`);
    await route.fulfill({ json: data });
  });
  return actions;
}

const review = (overrides = {}) => ({
  ApplicationID: 20, GroupID: 1, GroupName: 'Pending Team', Course: 'BSIT', MemberCount: 2,
  Members: ['Leader', 'Member'], Status: 'Pending', CanAccept: true,
  CreatedAt: '2026-10-16T10:00:00Z', ExpiresAt: '2026-10-17T10:00:00Z', ServerNow: '2026-10-16T10:00:00Z',
  FileCount: 0, FirstFileName: null, Requirements: [], ...overrides,
});
async function mockApplicationBell(page, application) {
  let read = false;
  await page.route('**/api/notifications**', route => {
    if (route.request().method() === 'PATCH') { read = true; return route.fulfill({ json: { readAt: application.CreatedAt, unreadCount: 0 } }); }
    return route.fulfill({ json: { items: [{ notification_id: 51, notification_type: 'adviser_application_submitted',
      title: 'New group application', message: 'Pending Team submitted an adviser application.', application_id: 20,
      group_id: 1, created_at: application.CreatedAt, read_at: read ? application.CreatedAt : null, application }],
      unreadCount: read ? 0 : 1, hasMore: false, nextCursor: null } });
  });
  await page.route('**/api/adviser/applications/20', route => route.fulfill({ json: { application } }));
}
async function viewBellApplication(page) {
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('dialog', { name: 'Notifications', exact: true }).getByRole('button', { name: 'View', exact: true }).click();
}

test('Groups shows accepted groups only and applications are accessed through the bell', async ({ page }, testInfo) => {
  const actions = await setup(page);
  await page.goto('/group');
  await expect(page.locator('.adviser-group-summary tbody tr')).toHaveCount(1);
  await expect(page.locator('.adviser-group-summary th')).toHaveText(['Group name', 'Course', 'Member count']);
  await expect(page.locator('.adviser-group-summary tbody td')).toHaveText([group.GroupName, 'BSIT', '3']);
  await expect(page.locator('.adviser-group-summary button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('groups.png'), fullPage: true, animations: 'disabled' });
  await expect(page.getByRole('button', { name: /Pending applications/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('You have no notifications yet.')).toBeVisible();
  expect(actions).toEqual([]);
});

test('adviser cannot accept a mismatched, blank or Unspecified course but can decline', async ({ page }) => {
  for (const course of ['BSCS', '', 'Unspecified']) {
    await page.unrouteAll();
    const actions = await setup(page, 'adviser', course);
    await mockApplicationBell(page, review({ CanAccept: false }));
    await page.goto('/group');
    await viewBellApplication(page);
    const details = page.getByRole('dialog', { name: 'Application details', exact: true });
    await expect(details.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
    await expect(details.getByRole('button', { name: 'Reject', exact: true })).toBeEnabled();
    await details.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect.poll(() => actions.length).toBe(1);
    expect(actions).toEqual([{ action: 'reject' }]);
  }
});

test('Student Members gives each real student a spaced row without mobile overflow', async ({ page }, testInfo) => {
  await setup(page);
  await page.goto('/students');
  const rows = page.locator('.student-member-row');
  await expect(rows).toHaveCount(3);
  for (const member of group.Members) await expect(page.getByText(member.Name, { exact: true })).toBeVisible();
  await expect(page.locator('.student-member-table tbody tr')).toHaveCount(group.Members.length);
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(second.y - first.y - first.height).toBeGreaterThanOrEqual(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('members.png'), fullPage: true, animations: 'disabled' });
});

test('student Apply allows only a matching configured adviser course', async ({ page }) => {
  const actions = await setup(page, 'student');
  await page.goto('/adviser');
  const rows = page.locator('.adviser-table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  for (const i of [1, 2, 3]) await expect(rows.nth(i).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await rows.nth(0).getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Application' }).click();
  await expect(page.getByText(/Adviser application: Pending/)).toBeVisible();
  expect(actions).toEqual([{ adviserId: 10, requirements: [] }]);
});

test('BSCS student sees why Apply is blocked and can apply after adviser course is corrected', async ({ page }) => {
  const actions = await setup(page, 'student', 'Unspecified', 'BSCS');
  await page.goto('/adviser');
  const first = page.locator('.adviser-table tbody tr').first();
  await expect(first.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await expect(first.getByText('Adviser course is not configured. Ask an admin to set it.')).toBeVisible();
  await page.route('**/api/advisers', route => route.fulfill({ json: [{ UserID: 10, Name: 'Matching Adviser', Course: ' bScS ', Availability: 10, AssignedGroups: 0, HasCapacity: true }] }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await first.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Application' }).click();
  await expect(page.getByText(/Adviser application: Pending/)).toBeVisible();
  expect(actions).toEqual([{ adviserId: 10, requirements: [] }]);
});

test('admin edit form saves and reloads an existing adviser course', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('jf_user', JSON.stringify({ id: '9', name: 'Admin User', role: 'admin', sessionToken: 'a'.repeat(64) })));
  const account = { UserID: 10, UserCode: '202600001', Username: 'test.adviser', Name: 'Test Adviser', FirstName: 'Test', LastName: 'Adviser', Role: 'adviser', IsActive: true, Course: 'Unspecified', AdviserCapacity: 10 };
  let saved;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
      if (path === '/api/activity' || path === '/activity') return route.fulfill({ json: { success: true } });
    let data;
    if (path === '/api/notifications') data = { items: [], unreadCount: 0, hasMore: false, nextCursor: null };
    else if (path === '/api/admin/users/10' && route.request().method() === 'PATCH') {
      saved = route.request().postDataJSON(); account.Course = saved.course; data = { success: true };
    } else if (path === '/api/admin/users') data = { items: [account], page: 1, totalPages: 1 };
    else if (path === '/api/admin/courses') data = ['BSIT', 'BSCS'];
    else if (path === '/api/admin/groups') data = [];
    else if (path === '/api/admin/summary') data = { users: 1, activeUsers: 1, students: 0, advisers: 1, groups: 0, openGroups: 0 };
    else throw new Error(`Unexpected request: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: /Advisers$/ }).click();
  await page.getByTitle('Edit user', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption('BSCS');
  await page.getByRole('button', { name: /Save Changes$/ }).click();
  await expect(page.locator('.admin-overlay')).toHaveCount(0);
  await expect(page.locator('tbody tr').filter({ hasText: 'Test Adviser' }).getByRole('cell', { name: 'BSCS', exact: true })).toBeVisible();
  expect(saved.course).toBe('BSCS');
});

const uploadFile = (name, size = 20) => {
  const buffer = Buffer.alloc(size, 32); buffer.write('%PDF-1.4\n');
  return { name, mimeType: 'application/pdf', buffer };
};

test('notifications show real events, read icons, persisted read status and application links', async ({ page }, testInfo) => {
  await setup(page, 'student');
  const items = [
    { notification_id: 51, title: 'Application accepted', message: 'Matching Adviser accepted Capstone Student Research Team.', application_id: 20, group_id: 1, created_at: '2026-10-16T10:30:00Z', read_at: null },
    { notification_id: 50, title: 'Application expired', message: 'Your earlier application expired.', application_id: 19, group_id: 1, created_at: '2026-10-15T10:30:00Z', read_at: null },
  ];
  await page.route('**/api/notifications**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'PATCH') {
      for (const item of items) if (path.endsWith('read-all') || path.includes(`/${item.notification_id}/`)) item.read_at ||= '2026-10-16T11:00:00Z';
      await route.fulfill({ json: { readAt: '2026-10-16T11:00:00Z', unreadCount: items.filter(item => !item.read_at).length } });
    } else await route.fulfill({ json: { items, unreadCount: items.filter(item => !item.read_at).length, hasMore: false, nextCursor: null } });
  });
  await page.route('**/api/adviser-applications/20', route => route.fulfill({ json: { application: { ApplicationID: 20, GroupID: 1, GroupName: group.GroupName, AdviserName: 'Matching Adviser', Status: 'Accepted', RespondedAt: '2026-10-16T10:30:00Z' } } }));
  await page.goto('/adviser');
  await page.getByRole('button', { name: 'Notifications, 2 unread', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(panel.getByRole('img', { name: 'Unread notification', exact: true })).toHaveCount(2);
  await expect(panel.locator('time').first()).toHaveAttribute('datetime', items[0].created_at);
  expect(await panel.boundingBox()).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('notifications.png'), fullPage: true });
  await panel.getByRole('button', { name: /Application accepted/ }).click();
  await expect(page).toHaveURL(/application=20/);
  await expect(page.getByRole('region', { name: 'Selected application' })).toContainText('Accepted');
  await page.reload();
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click();
  await expect(panel.getByRole('img', { name: 'Read notification', exact: true })).toHaveCount(1);
  await panel.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(panel.getByRole('img', { name: 'Read notification', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(panel.getByRole('img', { name: 'Read notification', exact: true })).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
});

test('empty notifications and deadline refresh allow reapplication only after server expiration', async ({ page }, testInfo) => {
  await setup(page, 'student');
  let firstRead;
  await page.route('**/api/groups/1/adviser-application', route => {
    firstRead ??= Date.now();
    const elapsed = Date.now() - firstRead;
    return route.fulfill({ json: { application: { ApplicationID: 20, AdviserName: 'Matching Adviser', Status: elapsed < 5000 ? 'Pending' : 'Expired', ExpiresAt: '2026-10-17T00:00:00Z', ServerNow: new Date(Date.parse('2026-10-16T23:59:55Z') + elapsed).toISOString() } } });
  });
  await page.goto('/adviser');
  await expect(page.getByLabel('Application time remaining')).toContainText('remaining');
  await expect(page.locator('.application-deadline time')).toHaveAttribute('datetime', '2026-10-17T00:00:00Z');
  await expect(page.locator('.adviser-table tbody tr').first().getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('deadline.png'), fullPage: true });
  await expect(page.getByText(/Adviser application: Expired/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Your group can apply again/)).toBeVisible();
  await expect(page.locator('.adviser-table tbody tr').first().getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('You have no notifications yet.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toHaveCount(0);
});

test('notification failures stay private and preserve previously loaded events', async ({ page }) => {
  await setup(page, 'student');
  let fail = true;
  const diagnostics = [];
  page.on('console', message => { if (message.type() === 'warning') diagnostics.push(message.text()); });
  await page.route('**/api/notifications', route => route.fulfill(fail
    ? { status: 503, json: { message: 'Unable to load notifications. Private database details SECRET_VALUE' } }
    : { json: { items: [{ notification_id: 51, title: 'Saved event', message: 'A real saved notification.', created_at: '2026-10-16T10:00:00Z', read_at: null, application_id: null, group_id: null }], unreadCount: 1, hasMore: false, nextCursor: null } }));
  await page.goto('/adviser');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(panel.getByText('Notifications will appear here when available.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(panel.getByText(/Unable to load|no notifications yet|SECRET_VALUE/)).toHaveCount(0);
  fail = false;
  await page.evaluate(() => window.dispatchEvent(new Event('juan-finder:notifications-changed')));
  await expect(panel.getByText('Saved event', { exact: true })).toBeVisible();
  fail = true;
  const failedRefresh = page.waitForResponse(response => response.url().endsWith('/api/notifications') && response.status() === 503);
  await page.evaluate(() => window.dispatchEvent(new Event('juan-finder:notifications-changed')));
  await failedRefresh;
  await expect(panel.getByText('Saved event', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible();
  expect(diagnostics.join(' ')).not.toContain('SECRET_VALUE');
});

test('adviser notifications show upload summaries, navy text and secure View/Accept actions', async ({ page }, testInfo) => {
  await setup(page);
  const Requirements = ['proposal.pdf', 'appendix.pdf', 'references.pdf'].map((FileName, i) => ({ DocumentID: i + 1, FileName, FileType: 'application/pdf' }));
  const application = { ApplicationID: 20, GroupID: 1, GroupName: 'Pending Team', Course: 'BSIT', MemberCount: 2, Members: ['Leader', 'Member'], Status: 'Pending', CanAccept: true, CreatedAt: '2026-10-16T10:00:00Z', ExpiresAt: '2026-10-17T10:00:00Z', ServerNow: '2026-10-16T10:00:00Z', FileCount: 3, FirstFileName: 'proposal.pdf', Requirements };
  let read = false, accepts = 0, groupRefreshes = 0, slotRefreshes = 0;
  await page.route('**/api/notifications**', route => {
    if (route.request().method() === 'PATCH') { read = true; return route.fulfill({ json: { readAt: '2026-10-16T11:00:00Z', unreadCount: 0 } }); }
    return route.fulfill({ json: { items: [{ notification_id: 51, notification_type: 'adviser_application_submitted', title: 'New group application', message: 'Pending Team submitted an adviser application.', application_id: 20, group_id: 1, created_at: application.CreatedAt, read_at: read ? application.CreatedAt : null, application }], unreadCount: read ? 0 : 1, hasMore: false, nextCursor: null } });
  });
  await page.route('**/api/adviser/applications/20', route => route.fulfill({ json: { application } }));
  await page.route('**/api/adviser/groups', route => { groupRefreshes++; return route.fulfill({ json: accepts ? [group] : [] }); });
  await page.route('**/api/adviser/dashboard**', route => { slotRefreshes++; return route.fulfill({ json: { AdviserName: 'Adviser', Summary: { Groups: accepts, StudentMembers: accepts * 3, Capacity: 1, AvailableSlots: 1 - accepts }, Groups: accepts ? [{ ...group, Members: group.Members.map(m => ({ ...m, UserCode: String(m.UserID), Course: 'BSIT' })) }] : [] } }); });
  await page.route('**/api/adviser/applications/20/respond', async route => {
    accepts++;
    expect(route.request().postDataJSON()).toEqual({ action: 'accept' });
    application.Status = 'Accepted'; application.CanAccept = false;
    await route.fulfill({ json: { success: true, status: 'Accepted' } });
  });
  await page.goto('/group');
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(panel.getByText('BSIT · 2 members', { exact: true })).toBeVisible();
  await expect(panel.getByText(/proposal.pdf \+ 2 other files/)).toBeVisible();
  await expect(panel.getByText('appendix.pdf', { exact: true })).toHaveCount(0);
  for (const node of await panel.locator('h2, strong, span, time, button').all()) await expect(node).toHaveCSS('color', 'rgb(0, 31, 63)');
  await page.screenshot({ path: testInfo.outputPath('pending-notification.png'), fullPage: true });
  await panel.getByRole('button', { name: 'View', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Application details', exact: true });
  await expect(details.getByText('appendix.pdf', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'View proposal.pdf', exact: true })).toBeVisible();
  await expect(details.getByText('Files uploaded with this application (3)', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await panel.getByRole('button', { name: 'Accept', exact: true }).click({ clickCount: 2 });
  await expect(panel.getByText('Status: Accepted', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  expect(accepts).toBe(1);
  expect(groupRefreshes).toBeGreaterThan(1);
  await expect(page.locator('.adviser-group-summary tbody')).toContainText(group.GroupName);
  for (const status of ['Expired', 'Rejected', 'Accepted']) {
    application.Status = status; application.CanAccept = true; // stale eligibility must never override terminal status
    await page.evaluate(() => window.dispatchEvent(new Event('juan-finder:notifications-changed')));
    await expect(panel.getByText(`Status: ${status}`, { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  }
  application.Status = 'Pending'; application.ServerNow = '2026-10-17T10:00:01Z';
  await page.evaluate(() => window.dispatchEvent(new Event('juan-finder:notifications-changed')));
  await expect(panel.getByText('Status: Pending', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/api/students', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.locator('.admin-stat').filter({ hasText: 'Available Slots' }).locator('span')).toHaveText('0');
  expect(slotRefreshes).toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: 'Pending adviser applications' })).toHaveCount(0);
});

test('file summaries distinguish zero, one, two, multiple and unconfirmed files', async ({ page }) => {
  await setup(page);
  for (const [count, expected] of [[0, 'No files were uploaded with this application.'], [1, 'proposal.pdf'], [2, 'proposal.pdf + 1 other file'], [3, 'proposal.pdf + 2 other files'], [undefined, 'Application file information is unavailable.']]) {
    const Requirements = count === undefined ? undefined : Array.from({ length: count }, (_, i) => ({ DocumentID: i + 1, FileName: i ? `extra-${i}.pdf` : 'proposal.pdf', FileType: 'application/pdf' }));
    await mockApplicationBell(page, review({ FileCount: count, FirstFileName: count ? 'proposal.pdf' : null, Requirements }));
    await page.goto('/group');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const panel = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await expect(panel.getByText(expected, { exact: false })).toBeVisible();
    await panel.getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.locator('.notification-application-details .application-file-row')).toHaveCount(count || 0);
    if (count === undefined) await expect(page.getByText('No files were uploaded with this application.', { exact: true })).toHaveCount(0);
  }
});
function previewPdf() {
  const stream = text => { const body = `BT /F1 18 Tf 24 430 Td (${text}) Tj ET`; return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`; };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 480] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 480] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('Application proposal page one.'), stream('Application proposal page two.'),
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
test('student can add/remove five files and cannot exceed five files or 10 MB combined', async ({ page }, testInfo) => {
  const actions = await setup(page, 'student');
  await page.goto('/adviser');
  await page.locator('.adviser-table tbody tr').first().getByRole('button', { name: 'Apply', exact: true }).click();
  const input = page.locator('#adviser-requirement-file');
  await input.setInputFiles(Array.from({ length: 5 }, (_, i) => uploadFile(`file-${i}.pdf`)));
  await expect(page.locator('.adv-requirement-selected')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('five-file-upload.png'), fullPage: true, animations: 'disabled' });
  await input.setInputFiles(uploadFile('sixth.pdf'));
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('You can upload at most 5 files.');
  await expect(page.locator('.adv-requirement-selected')).toHaveCount(5);
  await page.getByRole('button', { name: 'Remove file-0.pdf', exact: true }).click();
  await input.setInputFiles(uploadFile('replacement.pdf'));
  await expect(page.locator('.adv-requirement-selected')).toHaveCount(5);
  await page.getByRole('button', { name: 'Confirm Application' }).click();
  await expect(page.getByText(/Adviser application: Pending/)).toBeVisible();
  expect(actions[0].requirements).toHaveLength(5);
  expect(actions[0].requirements[4].fileName).toBe('replacement.pdf');
  await page.reload();
  await page.locator('.adviser-table tbody tr').first().getByRole('button', { name: 'Apply', exact: true }).click();
  await input.setInputFiles([uploadFile('large-a.pdf', 6 * 1024 * 1024), uploadFile('large-b.pdf', 5 * 1024 * 1024)]);
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Application files must total no more than 10 MB.');
  await expect(page.locator('.adv-requirement-selected')).toHaveCount(0);
});

test('bell VIEW on group and dashboard opens PDF and Word previews with downloads', async ({ page }, testInfo) => {
  await setup(page);
  const downloads = [];
  page.on('download', download => downloads.push(download));
  const Requirements = [
    { DocumentID: 1, FileName: 'proposal.pdf', FileType: 'application/pdf' },
    { DocumentID: 2, FileName: 'research.docx', FileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ];
  await page.route('**/api/students', route => route.fulfill({ json: [] }));
  await mockApplicationBell(page, review({ Requirements, FileCount: 2, FirstFileName: 'proposal.pdf' }));
  await page.route('**/api/adviser/applications/20/requirements/*', route => route.fulfill({ json: { url: 'http://127.0.0.1:5178/preview.pdf', downloadUrl: 'http://127.0.0.1:5178/preview.pdf?download=true', text: 'Research requirements preview text.' } }));
  // Even attachment headers must not cause a download when the user clicks View.
  await page.route('**/preview.pdf', route => route.fulfill({ contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="proposal.pdf"' }, body: previewPdf() }));
  for (const path of ['/group', '/']) {
    await page.goto(path);
    await viewBellApplication(page);
    await expect(page.getByRole('button', { name: 'View research.docx', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View proposal.pdf', exact: true }).click();
    await expect(page.locator('.application-pdf-pages')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('img', { name: 'proposal.pdf, page 1', exact: true })).toBeVisible();
    await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible();
    expect(downloads).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath(path === '/group' ? 'group-pdf-preview.png' : 'dashboard-pdf-preview.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('.application-pdf-pages')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('img', { name: 'proposal.pdf, page 2', exact: true })).toBeVisible();
    await expect(page.locator('.application-pdf-pages .visually-hidden')).toContainText('Application proposal page two.');
    await expect(page.getByRole('link', { name: 'Download original' })).toHaveAttribute('href', /download=true$/);
    await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByRole('button', { name: 'View research.docx', exact: true }).click();
    await expect(page.getByText('Research requirements preview text.', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(path === '/group' ? 'group-file-preview.png' : 'dashboard-file-preview.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  expect(downloads).toHaveLength(0);
});

test('a broken PDF shows an error and downloads only when Download original is clicked', async ({ page }) => {
  await setup(page);
  const downloads = []; page.on('download', download => downloads.push(download));
  await mockApplicationBell(page, review({ FileCount: 1, FirstFileName: 'broken.pdf', Requirements: [{ DocumentID: 1, FileName: 'broken.pdf', FileType: 'application/pdf' }] }));
  await page.route('**/api/adviser/applications/20/requirements/1', route => route.fulfill({ json: { url: 'http://127.0.0.1:5178/broken.pdf', downloadUrl: 'http://127.0.0.1:5178/broken.pdf?download=true' } }));
  await page.route('**/broken.pdf*', route => route.fulfill({ contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="original.pdf"' }, body: 'invalid PDF' }));
  await page.goto('/group');
  await viewBellApplication(page);
  await page.getByRole('button', { name: 'View broken.pdf', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to preview this PDF.');
  expect(downloads).toHaveLength(0);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download original', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('original.pdf');
  expect(downloads).toHaveLength(1);
});


test('VIEW remains available when persisting read status fails', async ({ page }) => {
  await setup(page);
  await mockApplicationBell(page, review({ FileCount: 1, FirstFileName: 'proposal.pdf', Requirements: [{ DocumentID: 1, FileName: 'proposal.pdf' }] }));
  await page.route('**/api/notifications/51/read', route => route.fulfill({ status: 503, json: { message: 'Temporary failure' } }));
  await page.goto('/group');
  await viewBellApplication(page);
  await expect(page.getByRole('dialog', { name: 'Application details', exact: true }).getByText('proposal.pdf', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible();
});

test('student bell polls acceptance outcomes without logging out and persists read status on refresh', async ({ page }) => {
  await setup(page, 'student');
  let accepted = false, read = false;
  await page.route('**/api/notifications**', route => {
    if (route.request().method() === 'PATCH') { read = true; return route.fulfill({ json: { readAt: '2026-10-16T11:00:00Z', unreadCount: 0 } }); }
    return route.fulfill({ json: { items: accepted ? [{ notification_id: 52, notification_type: 'adviser_application_accepted', title: 'Adviser application accepted', message: 'Matching Adviser accepted your application for Pending Team.', application_id: 20, group_id: 1, created_at: '2026-10-16T11:00:00Z', read_at: read ? '2026-10-16T11:00:00Z' : null, outcome: { GroupName: 'Pending Team', AdviserName: 'Matching Adviser', Status: 'Accepted', RespondedAt: '2026-10-16T11:00:00Z' } }] : [], unreadCount: accepted && !read ? 1 : 0, hasMore: false, nextCursor: null } });
  });
  await page.goto('/adviser');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(panel.getByText('You have no notifications yet.')).toBeVisible();
  accepted = true;
  await expect(panel.getByText('Status: Accepted', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(panel.getByText('Adviser: Matching Adviser', { exact: true })).toBeVisible();
  await expect(panel.locator('time')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(panel.getByRole('img', { name: 'Read notification', exact: true })).toBeVisible();
  await expect(panel.getByText('Status: Accepted', { exact: true })).toBeVisible();
});

for (const role of ['student', 'adviser']) {
  test(`${role} inbox completes slow requests instead of cancelling them on every poll`, async ({ page }) => {
    await setup(page, role);
    let slow = false, slowRequests = 0;
    await page.route('**/api/notifications', async route => {
      if (slow) { slowRequests++; await new Promise(resolve => setTimeout(resolve, 6500)); }
      await route.fulfill({ json: { items: slow ? [{ notification_id: 70, title: 'Persisted slow event', message: 'Stored event', created_at: '2026-10-16T10:00:00Z', read_at: null, application_id: null, group_id: null }] : [], unreadCount: slow ? 1 : 0, hasMore: false, nextCursor: null } });
    });
    await page.goto(role === 'adviser' ? '/group' : '/adviser');
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await expect(panel.getByText('You have no notifications yet.')).toBeVisible();
    slow = true;
    await page.evaluate(() => window.dispatchEvent(new Event('juan-finder:notifications-changed')));
    await expect(panel.getByText('Persisted slow event', { exact: true })).toBeVisible({ timeout: 10000 });
    expect(slowRequests).toBe(1);
    await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible();
  });
}

test('confirmed acceptance stays disabled when the follow-up inbox refresh fails', async ({ page }) => {
  await setup(page);
  await mockApplicationBell(page, review());
  let failedRefresh = false, decisions = 0;
  await page.route('**/api/notifications', route => failedRefresh
    ? route.fulfill({ status: 503, json: { message: 'Temporary failure' } }) : route.fallback());
  await page.route('**/api/adviser/applications/20/respond', route => {
    decisions++; failedRefresh = true;
    return route.fulfill({ json: { success: true, status: 'Accepted' } });
  });
  await page.goto('/group');
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await panel.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(panel.getByText('Status: Accepted', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'View', exact: true })).toBeEnabled();
  expect(decisions).toBe(1);
});

test('file-list download works directly without opening a preview', async ({ page }) => {
  await setup(page);
  await mockApplicationBell(page, review({ FileCount: 1, FirstFileName: 'research.docx', Requirements: [{ DocumentID: 1, FileName: 'research.docx' }] }));
  let requestedPreview = false;
  await page.route('**/api/adviser/applications/20/requirements/1*', route => {
    requestedPreview = new URL(route.request().url()).searchParams.has('preview');
    return route.fulfill({ json: { downloadUrl: 'http://127.0.0.1:5178/original.docx' } });
  });
  await page.route('**/original.docx', route => route.fulfill({ body: 'local original document fixture', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers: { 'Content-Disposition': 'attachment; filename="research.docx"' } }));
  await page.goto('/group');
  await viewBellApplication(page);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download research.docx', exact: true }).click();
  expect((await event).suggestedFilename()).toBe('research.docx');
  expect(requestedPreview).toBe(false);
  await expect(page.locator('.application-file-modal')).toHaveCount(0);
});

test('VIEW opens files while a read-receipt request is still pending', async ({ page }) => {
  await setup(page);
  await mockApplicationBell(page, review({ FileCount: 1, FirstFileName: 'proposal.pdf', Requirements: [{ DocumentID: 1, FileName: 'proposal.pdf' }] }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/notifications/51/read', async route => {
    await gate;
    await route.fulfill({ json: { readAt: '2026-10-16T11:00:00Z', unreadCount: 0 } });
  });
  try {
    await page.goto('/group');
    await viewBellApplication(page);
    await expect(page.getByRole('dialog', { name: 'Application details', exact: true }).getByText('proposal.pdf', { exact: true })).toBeVisible({ timeout: 2000 });
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});
