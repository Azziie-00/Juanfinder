import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';

test.use({ timezoneId: 'Asia/Manila' });

const profile = () => ({ FirstName: 'Test', LastName: 'User', Name: 'Test User', UserCode: '001234', Course: 'BSIT', YearLevel: '4', Bio: 'Original bio', Gender: 'Female', Birthdate: '2001-01-01', Socials: '', Skills: ['Coding'], Requirements: 'Proposal' });
async function signIn(page, role) {
  await page.addInitScript(role => !sessionStorage.getItem('jf_user') && sessionStorage.setItem('jf_user', JSON.stringify({ id: role === 'student' ? '1' : '10', name: 'Test User', role, sessionToken: 'a'.repeat(64) })), role);
}
const notifications = { items: [], unreadCount: 0, hasMore: false, nextCursor: null };
for (const role of ['student', 'adviser', 'library']) {
  test(`${role} Settings change password validates, handles errors and clears private fields`, async ({ page }) => {
    await signIn(page, role);
    let changes = 0;
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/account/password') {
        changes++;
        expect(route.request().postDataJSON()).toEqual({ currentPassword: changes === 1 ? 'WrongPass!23' : 'OriginalPass!23', newPassword: 'UpdatedPass!45', confirmPassword: 'UpdatedPass!45' });
        return route.fulfill(changes === 1 ? { status: 400, json: { message: 'Current password is incorrect.' } } : { json: { success: true } });
      }
      if (path === '/api/profile') return route.fulfill({ json: profile() });
      if (path === '/api/notifications') return route.fulfill({ json: notifications });
      if (path === '/api/activity') return route.fulfill({ json: { success: true } });
      throw Error(`Unexpected ${path}`);
    });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.locator('.user-dd').getByRole('link', { name: 'Settings', exact: true }).click();
    const form = page.locator('.settings-password-form');
    await expect(form.getByRole('group', { name: 'Change password' })).toBeVisible();
    await form.getByLabel('Current password', { exact: true }).fill('DiscardMe!23');
    await form.getByRole('button', { name: 'Cancel password change' }).click();
    await expect(form.getByLabel('Current password', { exact: true })).toHaveValue('');
    await form.getByLabel('Current password', { exact: true }).fill('WrongPass!23');
    await form.getByLabel('New password', { exact: true }).fill('UpdatedPass!45');
    await form.getByLabel('Confirm new password', { exact: true }).fill('Mismatch!45');
    await form.getByRole('button', { name: 'Change Password', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText('New passwords do not match.'); expect(changes).toBe(0);
    await form.getByLabel('Confirm new password', { exact: true }).fill('UpdatedPass!45');
    await form.getByRole('button', { name: 'Change Password', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText('Current password is incorrect.');
    await form.getByLabel('Current password', { exact: true }).fill('OriginalPass!23');
    await form.getByRole('button', { name: 'Change Password', exact: true }).click();
    await expect(form.getByRole('status')).toContainText('Password changed successfully.');
    for (const label of ['Current password', 'New password', 'Confirm new password']) await expect(form.getByLabel(label, { exact: true })).toHaveValue('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload(); await expect(form.getByLabel('Current password', { exact: true })).toHaveValue('');
  });
}
for (const role of ['student', 'adviser']) {
  test(`${role} Settings navigation, Cancel, Save, persisted read-only profile and validation`, async ({ page }) => {
    await signIn(page, role);
    const current = profile(); const saves = [];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/activity' || path === '/activity') return route.fulfill({ json: { success: true } });
      if (path === '/api/notifications') return route.fulfill({ json: notifications });
      if (path === '/api/portfolio') return route.fulfill({ json: [] });
      if (route.request().method() === 'PATCH') {
        expect(path).toBe(role === 'student' ? '/api/profile' : '/api/adviser/profile');
        const body = route.request().postDataJSON(); saves.push(body);
        current.Bio = body.bio.trim(); current.Gender = body.gender;
        if (role === 'student') { current.FirstName = body.firstName.trim(); current.LastName = body.lastName.trim(); current.Skills = body.skills; current.Socials = body.socials; }
        else { current.Requirements = body.requirements.map(s => s.trim()).filter(Boolean).join('\n'); current.Skills = body.skills; current.Specialty = body.specialty.trim(); }
        return route.fulfill({ json: { success: true } });
      }
      if (path === '/api/profile') return route.fulfill({ json: current });
      throw Error(`Unexpected ${path}`);
    });
    await page.goto('/profile');
    await expect(page.getByText('Original bio', { exact: true })).toBeVisible();
    await expect(page.locator('.profile-misc-sub')).toHaveText('Last active: No previous activity recorded.');
    await expect(page.getByRole('button', { name: /^EDIT$/i })).toHaveCount(0);
    await expect(page.locator('.sidebar-nav').getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.locator('.user-dd').getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    const heading = page.getByRole('heading', { name: 'Settings', exact: true });
    await expect(heading).toHaveCSS('color', await page.locator('.topbar-title').evaluate(el => getComputedStyle(el).color));
    await expect(heading).toHaveCSS('text-align', 'center');
    const titleBox = await heading.boundingBox(); const contentBox = await page.locator('.settings-page').boundingBox();
    expect(Math.abs(titleBox.x + titleBox.width / 2 - contentBox.x - contentBox.width / 2)).toBeLessThan(2);
    await page.getByLabel('Bio', { exact: true }).fill('Discarded bio');
    if (role === 'adviser') { await page.getByLabel('Skills (comma separated)', { exact: true }).fill('Discarded skill'); await page.getByLabel('Specialties', { exact: true }).fill('Discarded specialty'); }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Original bio');
    if (role === 'adviser') { await expect(page.getByLabel('Skills (comma separated)', { exact: true })).toHaveValue('Coding'); await expect(page.getByLabel('Specialties', { exact: true })).toHaveValue(''); }
    expect(saves).toHaveLength(0);
    await page.getByLabel('Bio', { exact: true }).fill('Saved profile bio');
    if (role === 'student') {
      await page.getByLabel('First Name', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Save Changes' }).click(); expect(saves).toHaveLength(0);
      await page.getByLabel('First Name', { exact: true }).fill('Updated');
    } else {
      await page.getByLabel('Requirement 1', { exact: true }).fill('Updated requirement');
      await page.getByLabel('Skills (comma separated)', { exact: true }).fill('Python, Data Analysis');
      await page.getByLabel('Specialties', { exact: true }).fill('Artificial Intelligence');
    }
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('status')).toContainText('Profile updated successfully');
    await page.reload(); await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Saved profile bio');
    if (role === 'adviser') { await expect(page.getByLabel('Skills (comma separated)', { exact: true })).toHaveValue('Python, Data Analysis'); await expect(page.getByLabel('Specialties', { exact: true })).toHaveValue('Artificial Intelligence'); }
    await page.getByRole('link', { name: 'View My Profile' }).click();
    await expect(page.getByText('Saved profile bio', { exact: true })).toBeVisible();
    if (role === 'student') await expect(page.locator('.profile-name')).toHaveText('Updated User');
    else { await expect(page.getByText('Updated requirement', { exact: true })).toBeVisible(); await expect(page.getByText('Python, Data Analysis', { exact: true })).toBeVisible(); await expect(page.getByText('Artificial Intelligence', { exact: true })).toBeVisible(); }
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.locator('.user-dd').getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

const groups = Array.from({ length: 12 }, (_, i) => ({ GroupID: i + 1, GroupName: `Research Group ${String(i + 1).padStart(2, '0')}`, Course: 'BSIT', MemberCount: 2, Members: [{ UserID: i * 2 + 1, UserCode: `00${i}01`, Name: `Student ${i + 1}`, Course: 'BSIT', IsLeader: true }, { UserID: i * 2 + 2, UserCode: `00${i}02`, Name: `Partner ${i + 1}`, Course: 'BSIT', IsLeader: false }] }));

test('missing activity migration shows unavailable history and stops activity retries', async ({ page }) => {
  await signIn(page, 'adviser');
  await page.clock.install();
  let activityWrites = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/activity') { activityWrites++; return route.fulfill({ status: 202, json: { success: false, trackingAvailable: false } }); }
    if (path === '/api/profile') return route.fulfill({ json: { ...profile(), ActivityTrackingAvailable: false, PreviousActivityAt: null } });
    if (path === '/api/notifications') return route.fulfill({ json: notifications });
    throw Error(`Unexpected ${path}`);
  });
  const unavailable = page.waitForResponse(r => new URL(r.url()).pathname === '/api/activity' && r.status() === 202);
  await page.goto('/profile'); await unavailable;
  await expect(page.locator('.profile-misc-sub')).toHaveText('Last active: Activity tracking is unavailable.');
  const initialWrites = activityWrites;
  await page.getByRole('button', { name: 'Account menu', exact: true }).click(); await page.keyboard.press('Escape');
  await page.clock.fastForward(61000);
  expect(activityWrites).toBe(initialWrites);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

for (const role of ['student', 'adviser']) test(`${role} previous activity stays stable on visits and refresh and uses local timezone`, async ({ page }) => {
  await signIn(page, role);
  const previous = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let recorded = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/activity') { recorded++; expect(route.request().method()).toBe('POST'); expect(route.request().headers().authorization).toBe('Bearer ' + 'a'.repeat(64)); return route.fulfill({ json: { success: true } }); }
    if (path === '/api/profile') return route.fulfill({ json: { ...profile(), PreviousActivityAt: previous } });
    if (path === '/api/portfolio') return route.fulfill({ json: [] });
    if (path === '/api/notifications') return route.fulfill({ json: notifications });
    throw Error(`Unexpected ${path}`);
  });
  await page.goto('/profile');
  await expect(page.locator('.profile-misc-sub time')).toHaveAttribute('datetime', previous);
  const expected = new Date(previous).toLocaleString('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'long' });
  await expect(page.locator('.profile-misc-sub time')).toHaveText(expected);
  await expect.poll(() => recorded).toBeGreaterThan(0);
  await page.reload(); await expect(page.locator('.profile-misc-sub time')).toHaveText(expected);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('.user-dd')).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'View My Profile' }).click();
  await expect(page.locator('.profile-misc-sub time')).toHaveText(expected);
});

async function mockDashboard(page) {
  await signIn(page, 'adviser');
  const state = { fail: false };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/activity') return route.fulfill({ json: { success: true } });
    if (url.pathname === '/api/notifications') return route.fulfill({ json: notifications });
    if (url.pathname !== '/api/adviser/dashboard') throw Error(`Unexpected ${url.pathname}`);
    if (state.fail) return route.fulfill({ status: 503, json: { message: 'Report temporarily unavailable.' } });
    const q = (url.searchParams.get('search') || '').toLowerCase();
    return route.fulfill({ json: { AdviserName: 'Test Adviser', Summary: { Groups: 12, StudentMembers: 24, Capacity: 15, AvailableSlots: 3 }, Groups: groups.filter(g => g.Members.some(s => s.Name.toLowerCase().includes(q) || s.UserCode.includes(q))) } });
  });
  return state;
}
async function download(page, format, testInfo) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: format === 'pdf' ? 'Export PDF' : 'Export Excel' }).click();
  const file = await pending; const path = testInfo.outputPath(file.suggestedFilename()); await file.saveAs(path);
  return { path, bytes: await fs.readFile(path) };
}
async function pdfText(page, bytes) {
  return page.evaluate(async encoded => {
    const { getDocument, GlobalWorkerOptions } = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const pdf = await getDocument({ data: Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), useWorkerFetch: false }).promise;
    const text = [];
    for (let i = 1; i <= pdf.numPages; i++) text.push((await (await pdf.getPage(i)).getTextContent()).items.map(item => item.str).join(' '));
    return text.join('\n');
  }, bytes.toString('base64'));
}

test('dashboard counts, paginated details, search, empty results and export failures', async ({ page }, testInfo) => {
  const state = await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.admin-stat span')).toHaveText(['12', '24', '3']);
  const cardStyles = await page.locator('.admin-stat').evaluateAll(cards => cards.slice(0, 2).map(card => {
    const style = getComputedStyle(card);
    return [style.backgroundColor, style.color, style.border, ...['i', 'span', 'small'].map(selector => getComputedStyle(card.querySelector(selector)).color)];
  }));
  expect(cardStyles[1]).toEqual(cardStyles[0]);
  await expect(page.locator('.admin-table > thead th')).toHaveText(['Group Name', 'Course', 'Member Count', 'View']);
  await expect(page.getByRole('button', { name: /Pending applications/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'View Research Group 01 members' }).click();
  await expect(page.locator('.workspace-members tbody tr')).toHaveCount(2);
  await expect(page.getByRole('cell', { name: '00001', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Research Group 12', { exact: true })).toBeVisible();
  await page.getByLabel('Search Student', { exact: true }).fill('student 12');
  await expect(page.getByText('Research Group 12', { exact: true })).toBeVisible();
  await expect(page.locator('.admin-pagination')).toContainText('1 groups');
  await page.getByLabel('Search Student', { exact: true }).fill('00102');
  await expect(page.getByText('Research Group 02', { exact: true })).toBeVisible();
  await page.getByLabel('Search Student', { exact: true }).fill('No match');
  await expect(page.getByText('No matching student groups.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Excel' })).toBeDisabled();
  await page.getByLabel('Search Student', { exact: true }).fill('Student');
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  state.fail = true; await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('Report temporarily unavailable.');
});

test('display selector switches students and groups while keeping members together by group', async ({ page }, testInfo) => {
  await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.admin-pagination')).toContainText('12 groups');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.admin-pagination')).toContainText('Page 2 of 2');
  await page.getByLabel('Display records', { exact: true }).selectOption('students');
  await expect(page.getByLabel('Export contents')).toHaveValue('students');
  await expect(page.locator('.admin-pagination')).toContainText('24 students in 12 groups');
  await expect(page.locator('.admin-pagination')).toContainText('Page 1 of 2');
  await expect(page.locator('.admin-table > thead th')).toHaveText(['Student ID', 'Name', 'Course']);
  await expect(page.locator('.workspace-student-group')).toHaveCount(10);
  await expect(page.locator('.workspace-student-group').first().locator('.workspace-student-row')).toHaveCount(2);
  await expect(page.locator('.workspace-student-group').first()).toContainText('Research Group 01');
  await expect(page.locator('.workspace-student-group').first()).toContainText('Student 1');
  await expect(page.locator('.workspace-student-group').first()).toContainText('Partner 1');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.workspace-student-group')).toHaveCount(2);
  await expect(page.locator('.workspace-student-row')).toHaveCount(4);
  await expect(page.locator('.workspace-student-group').last()).toContainText('Research Group 12');
  await page.getByLabel('Search Student', { exact: true }).fill('00102');
  await expect(page.locator('.workspace-student-group')).toHaveCount(1);
  await expect(page.locator('.workspace-student-row')).toHaveCount(1);
  await expect(page.locator('.workspace-student-group')).toContainText('Research Group 02');
  await expect(page.locator('.workspace-student-row')).toContainText('Partner 2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('students-by-group.png'), fullPage: true });
  await page.getByLabel('Display records', { exact: true }).selectOption('groups');
  await expect(page.getByLabel('Export contents')).toHaveValue('groups');
  await expect(page.locator('.admin-table > thead th')).toHaveText(['Group Name', 'Course', 'Member Count', 'View']);
  await expect(page.getByRole('button', { name: 'View Research Group 02 members' })).toBeVisible();
});

test('real Excel and PDF downloads include every matching page, metadata and selected columns', async ({ page }, testInfo) => {
  await mockDashboard(page); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Export Excel' })).toBeEnabled();
  for (const kind of ['groups', 'students']) {
    await page.getByLabel('Export contents').selectOption(kind);
    const xlsx = await download(page, 'xlsx', testInfo);
    expect(xlsx.bytes.subarray(0, 2).toString()).toBe('PK');
    const book = new ExcelJS.Workbook(); await book.xlsx.load(xlsx.bytes); const sheet = book.worksheets[0];
    expect(sheet.getCell('A1').text).toBe(kind === 'groups' ? 'Student Groups Summary' : 'Student Member List');
    expect(sheet.getCell('A2').text).toBe('Adviser: Test Adviser'); expect(sheet.getCell('A3').text).toContain('Export date:');
    expect(sheet.rowCount).toBe(kind === 'groups' ? 18 : 30);
    expect(sheet.getRow(6).values.slice(1)).toEqual(kind === 'groups' ? ['Group Name', 'Course', 'Member Count'] : ['Student ID', 'Name', 'Course', 'Group']);
    expect(sheet.getCell(kind === 'groups' ? 'A18' : 'D30').text).toBe('Research Group 12');
    if (kind === 'students') expect(sheet.getCell('A7').value).toBe('00001');
    const pdf = await download(page, 'pdf', testInfo); expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await pdfText(page, pdf.bytes);
    expect(text).toContain('Test Adviser'); expect(text).toContain('Export date:'); expect(text).toContain('Research Group 12');
    if (kind === 'students') { expect(text).toContain('00001'); expect(text).toContain('Partner 12'); }
  }
  await page.getByLabel('Search Student', { exact: true }).fill('00102');
  await expect(page.locator('.admin-pagination')).toContainText('1 groups');
  const xlsx = await download(page, 'xlsx', testInfo); const book = new ExcelJS.Workbook(); await book.xlsx.load(xlsx.bytes);
  expect(book.worksheets[0].rowCount).toBe(7); expect(book.worksheets[0].getCell('A7').text).toBe('00102');
  const pdf = await download(page, 'pdf', testInfo); const text = await pdfText(page, pdf.bytes);
  expect(text).toContain('Partner 2'); expect(text).not.toContain('Partner 3');
});
