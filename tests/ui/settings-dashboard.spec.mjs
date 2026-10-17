import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';

const profile = () => ({ FirstName: 'Test', LastName: 'User', Name: 'Test User', UserCode: '001234', Course: 'BSIT', YearLevel: '4', Bio: 'Original bio', Gender: 'Female', Birthdate: '2001-01-01', Socials: '', Skills: ['Coding'], Requirements: 'Proposal' });
async function signIn(page, role) {
  await page.addInitScript(role => !sessionStorage.getItem('jf_user') && sessionStorage.setItem('jf_user', JSON.stringify({ id: role === 'student' ? '1' : '10', name: 'Test User', role, sessionToken: 'a'.repeat(64) })), role);
}
const notifications = { items: [], unreadCount: 0, hasMore: false, nextCursor: null };
for (const role of ['student', 'adviser']) {
  test(`${role} Settings navigation, Cancel, Save, persisted read-only profile and validation`, async ({ page }) => {
    await signIn(page, role);
    const current = profile(); const saves = [];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/notifications') return route.fulfill({ json: notifications });
      if (path === '/api/portfolio') return route.fulfill({ json: [] });
      if (route.request().method() === 'PATCH') {
        expect(path).toBe(role === 'student' ? '/api/profile' : '/api/adviser/profile');
        const body = route.request().postDataJSON(); saves.push(body);
        current.Bio = body.bio.trim(); current.Gender = body.gender;
        if (role === 'student') { current.FirstName = body.firstName.trim(); current.LastName = body.lastName.trim(); current.Skills = body.skills; current.Socials = body.socials; }
        else current.Requirements = body.requirements.map(s => s.trim()).filter(Boolean).join('\n');
        return route.fulfill({ json: { success: true } });
      }
      if (path === '/api/profile') return route.fulfill({ json: current });
      throw Error(`Unexpected ${path}`);
    });
    await page.goto('/profile');
    await expect(page.getByText('Original bio', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^EDIT$/i })).toHaveCount(0);
    await page.locator('.sidebar-nav').getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByLabel('Bio', { exact: true }).fill('Discarded bio');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Original bio');
    expect(saves).toHaveLength(0);
    await page.getByLabel('Bio', { exact: true }).fill('Saved profile bio');
    if (role === 'student') {
      await page.getByLabel('First Name', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Save Changes' }).click(); expect(saves).toHaveLength(0);
      await page.getByLabel('First Name', { exact: true }).fill('Updated');
    } else await page.getByLabel('Requirement 1', { exact: true }).fill('Updated requirement');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('status')).toContainText('Profile updated successfully');
    await page.reload(); await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Saved profile bio');
    await page.getByRole('link', { name: 'View My Profile' }).click();
    await expect(page.getByText('Saved profile bio', { exact: true })).toBeVisible();
    if (role === 'student') await expect(page.locator('.profile-name')).toHaveText('Updated User');
    else await expect(page.getByText('Updated requirement', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.locator('.user-dd').getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

const groups = Array.from({ length: 12 }, (_, i) => ({ GroupID: i + 1, GroupName: `Research Group ${String(i + 1).padStart(2, '0')}`, Course: 'BSIT', MemberCount: 2, Members: [{ UserID: i * 2 + 1, UserCode: `00${i}01`, Name: `Student ${i + 1}`, Course: 'BSIT', IsLeader: true }, { UserID: i * 2 + 2, UserCode: `00${i}02`, Name: `Partner ${i + 1}`, Course: 'BSIT', IsLeader: false }] }));
async function mockDashboard(page) {
  await signIn(page, 'adviser');
  const state = { fail: false };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
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
