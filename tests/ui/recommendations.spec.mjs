import { test, expect } from '@playwright/test';

async function setup(page, options = {}) {
  await page.addInitScript(() => sessionStorage.setItem('jf_user', JSON.stringify({ id: '1', name: 'Test Student', role: 'student', course: 'BSIT', sessionToken: 'a'.repeat(64) })));
  const matches = { canApply: true, groupName: 'Smart farm', message: 'Advisers matched to your group title and description.',
    recommendations: [14, 15, 16].map(id => ({ adviser: { id: String(id), name: `IoT Adviser ${id}`, course: 'BSIT', remainingSlots: 2 },
      reason: 'Their IoT experience fits your crop monitoring project. '.repeat(8), evidence: 'IoT and embedded systems' })) };
  const groupMatches = { recommendations: [1, 2, 3].map(id => ({ group: { id: String(id), name: `Research group ${id}`, course: 'BSIT', desc: 'IoT project description. '.repeat(30), members: 2, maxMembers: 4 }, reason: 'Your skills fit this project.', matchedSkills: ['JavaScript'] })) };
  const applications = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    let data;
    if (path === '/notifications') data = { items: [], unreadCount: 0, hasMore: false };
    else if (path === '/dashboard/stats') data = { finder: 37, adviser: 7 };
    else if (path === '/groups') data = [];
    else if (path === '/ai/chat/status') data = { ai_disabled: options.aiDisabled ?? true };
    else if (path === '/ai/chat') data = { reply: 'I can help you plan your capstone project.' };
    else if (path === '/groups/recommendations') data = groupMatches;
    else if (path === '/advisers/recommendations') {
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      if (options.error) return route.fulfill({ status: 503, json: { message: 'Adviser recommendations are temporarily unavailable. Please retry or browse advisers.' } });
      data = options.result || matches;
    } else if (path === '/advisers') data = Array.from({ length: 7 }, (_, i) => ({ UserID: i + 10, Name: `IoT Adviser ${i + 10}`, Course: 'BSIT', Availability: 10, AssignedGroups: 8, HasCapacity: true, Requirements: 'Project proposal' }));
    else if (path === '/my-group') data = { group: { GroupID: 1, GroupName: 'Smart farm', Course: 'BSIT', OwnerID: 1, FinalizedAt: '2026-01-01', MembershipStatus: 'Member', AdviserID: null } };
    else if (path === '/groups/1/adviser-application') data = { application: null };
    else if (path === '/groups/1/adviser-applications') { applications.push(route.request().postDataJSON()); data = { application: { Status: 'Pending', AdviserName: 'IoT Adviser 14' } }; }
    else throw new Error(`Unexpected API call: ${path}`);
    await route.fulfill({ json: data });
  });
  return { applications };
}

test('both panels remain fixed with long results, scroll by keyboard, and hand off the correct adviser', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const { applications } = await setup(page, { delay: 400 });
  await page.goto('/');
  const groups = page.locator('.recommended-groups');
  const advisers = page.locator('.recommended-advisers');
  for (const panel of [groups, advisers]) expect((await panel.boundingBox()).height).toBe(180);
  await page.screenshot({ path: testInfo.outputPath('dashboard-compact-empty.png'), fullPage: true });
  await page.getByRole('button', { name: 'Find my matches' }).click();
  await expect(groups.locator('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Find my adviser' }).click();
  await expect(advisers.getByRole('button', { name: 'Finding matches…' })).toBeDisabled();
  expect((await advisers.boundingBox()).height).toBe(180);
  await expect(advisers.locator('article')).toHaveCount(3);
  for (const panel of [groups, advisers]) {
    expect((await panel.boundingBox()).height).toBe(180);
    const body = panel.locator('.recommendation-panel-body');
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.focus(); await page.keyboard.press('End');
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await body.evaluate(el => { el.scrollTop = 0; });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await advisers.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('dashboard-recommendations.png'), fullPage: true });
  await advisers.getByRole('link', { name: 'Review & apply' }).first().click();
  await expect(page).toHaveURL(/adviser\?adviser=14/);
  const selected = page.locator('.recommended-adviser-row');
  await expect(selected).toContainText('IoT Adviser 14');
  await selected.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Apply to IoT Adviser 14');
  expect(applications).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm Application' }).click();
  await expect.poll(() => applications.length).toBe(1);
  expect(applications[0].adviserId).toBe(14);
  expect(errors).toEqual([]);
});

test('retryable error and no-group states preserve panel bounds and browsing', async ({ page }) => {
  await setup(page, { error: true });
  await page.goto('/');
  const panel = page.locator('.recommended-advisers');
  await panel.getByRole('button', { name: 'Find my adviser' }).click();
  await expect(panel.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(panel.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect((await panel.boundingBox()).height).toBe(180);
  await page.route('**/api/advisers/recommendations', route => route.fulfill({ json: { recommendations: [], message: 'Join or create a group before finding an adviser.' } }));
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel.getByRole('status')).toContainText('Join or create a group');
  await expect(panel.getByRole('link', { name: 'Browse all advisers' })).toBeVisible();
});

test('members can see recommendations without an apply action', async ({ page }) => {
  await setup(page, { result: { recommendations: [{ adviser: { id: '14', name: 'IoT Adviser', course: 'BSIT', remainingSlots: 2 }, reason: 'Fits IoT sensors.', evidence: 'IoT' }], canApply: false, applicationHint: 'Only your group leader can apply.' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Find my adviser' }).click();
  const panel = page.locator('.recommended-advisers');
  await expect(panel).toContainText('Only your group leader');
  await expect(panel.getByRole('link', { name: 'View adviser', exact: false })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Review & apply' })).toHaveCount(0);
});

test('JUAN-AI has a separate mobile tab and retains chat when switching dashboard views', async ({ page, isMobile }, testInfo) => {
  await setup(page, { aiDisabled: false });
  await page.goto('/');
  const assistant = page.getByRole('region', { name: 'JUAN-AI assistant', exact: true });
  const aiLink = page.getByRole('link', { name: 'JUAN-AI', exact: true });
  if (!isMobile) {
    await expect(aiLink).toHaveCount(0);
    await expect(assistant).toBeVisible();
    await expect(page.locator('.recommended-groups')).toBeVisible();
    return;
  }
  await expect(assistant).toBeHidden();
  await expect(aiLink).toBeVisible();
  await aiLink.click();
  await expect(page).toHaveURL(/\?view=juan-ai/);
  await expect(aiLink).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await expect(assistant).toBeVisible();
  await expect(page.locator('.recommended-groups')).toBeHidden();
  await expect(page.locator('.dashboard-overview')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Upload CV' })).toBeEnabled();
  await assistant.getByRole('textbox').fill('Help me plan my project');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(assistant).toContainText('I can help you plan your capstone project.');
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(assistant).toBeHidden();
  await expect(page.locator('.recommended-groups')).toBeVisible();
  await aiLink.click();
  await expect(assistant).toContainText('Help me plan my project');
  await expect(assistant).toContainText('I can help you plan your capstone project.');
  await page.screenshot({ path: testInfo.outputPath('mobile-juan-ai.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 500 });
  const composer = await page.locator('.ai-input-area').boundingBox();
  const nav = await page.locator('.sidebar').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(nav.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(page.locator('.recommended-groups')).toBeVisible();
  await page.goForward();
  await expect(assistant).toContainText('Help me plan my project');
  await page.reload();
  await expect(assistant).toBeVisible();
  await expect(page.locator('.recommended-groups')).toBeHidden();
});

test('the dedicated assistant view respects the existing AI quota', async ({ page }) => {
  await setup(page);
  await page.goto('/?view=juan-ai');
  await expect(page.getByRole('button', { name: 'Upload CV' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
