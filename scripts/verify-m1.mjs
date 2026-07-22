// M1 浏览器自动化验收：注册 → 示例行程 → 编辑器（清单/地图）→ 编辑 → 持久化 → 移动端
// 运行：node scripts/verify-m1.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const SHOTS = 'verify-shots';
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ args: ['--no-proxy-server'] });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const email = `pw-${Date.now()}@test.dev`;

  // 1. 未登录守卫：根路径应重定向到 /login
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('未登录重定向到登录页', page.url().includes('/login'), page.url());

  // 2. 注册（含邀请码）
  await page.goto(`${BASE}/register`);
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码（至少 8 位）').fill('password123');
  await page.getByLabel('确认密码').fill('password123');
  const inviteField = page.getByLabel('邀请码');
  if (await inviteField.count()) await inviteField.fill('weaver-dev-2026');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForURL('**/trips', { timeout: 10_000 });
  check('注册并自动登录跳转行程列表', true);

  // 3. 规划页不再让用户填写预算；兼容默认值由客户端提交逻辑内部补齐
  await page.goto(`${BASE}/planner`, { waitUntil: 'networkidle' });
  const plannerBudgetFields = await page.getByText(/预算档位|总预算（元\/人/).count();
  check('规划页不再展示预算表单项', plannerBudgetFields === 0, `budgetFields=${plannerBudgetFields}`);
  await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle' });

  // 4. 空状态 + 加载示例行程
  await page.getByRole('button', { name: '加载示例行程' }).click();
  await page.waitForURL('**/trips/*', { timeout: 10_000 });
  await page.waitForSelector('.day-section', { timeout: 10_000 });
  const dayCount = await page.locator('.day-section').count();
  check('示例行程进入编辑器且有 3 天', dayCount === 3, `days=${dayCount}`);

  // 5. 地图标记与折线（等待瓦片与标记渲染）
  await page.waitForSelector('.marker-pin', { timeout: 10_000 });
  await page.waitForSelector('.leaflet-tile-loaded', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const markers = await page.locator('.marker-pin').count();
  const polylines = await page.locator('path.leaflet-interactive').count();
  const markerInView = await page.locator('.marker-pin').first().isVisible();
  check('地图渲染活动序号标记', markers === 11, `markers=${markers}（示例共 11 个活动）`);
  check('地图标记位于视口内', markerInView);
  check('示例无通勤 legs 时地图不臆造路线折线', polylines === 0, `paths=${polylines}`);
  await page.screenshot({ path: `${SHOTS}/01-editor-desktop.png` });

  // 6. 天数过滤：切 D2 后地图只剩当天标记
  await page.locator('.day-filter-btn', { hasText: 'D2' }).click();
  await page.waitForTimeout(800);
  const d2markers = await page.locator('.marker-pin').count();
  const d2days = await page.locator('.day-section').count();
  check('D2 过滤联动地图与清单', d2markers === 4 && d2days === 1, `markers=${d2markers}, days=${d2days}`);
  await page.screenshot({ path: `${SHOTS}/02-day-filter-d2.png` });
  await page.locator('.day-filter-btn', { hasText: '全部' }).click();

  // 7. 预算与费用 UI 已移除，旧数据中的字段不再面向用户展示
  const budgetTabs = await page.getByRole('button', { name: '预算' }).count();
  const costControls = await page.locator('.cost-chip, .cost-input, .budget-panel').count();
  check('编辑器不再展示预算页签或费用控件', budgetTabs === 0 && costControls === 0, `budgetTabs=${budgetTabs}, costControls=${costControls}`);

  await page.getByRole('button', { name: '行程信息' }).click();
  const metaBudgetFields = await page.getByText(/预算档次|总预算（¥/).count();
  check('行程信息弹窗不再展示预算字段', metaBudgetFields === 0, `budgetFields=${metaBudgetFields}`);
  await page.getByRole('button', { name: '取消' }).click();

  // 8. 活动下移排序
  const firstDay = page.locator('.day-section').first();
  const namesBefore = await firstDay.locator('.activity-name').allInnerTexts();
  await firstDay.locator('.activity-card').first().getByTitle('下移').click();
  await page.waitForTimeout(300);
  const namesAfter = await firstDay.locator('.activity-name').allInnerTexts();
  check('活动日内下移生效', namesAfter[0] === namesBefore[1] && namesAfter[1] === namesBefore[0], `[${namesBefore[0]}]↔[${namesAfter[0]}]`);

  // 9. 添加活动（弹窗表单）
  await firstDay.getByRole('button', { name: '＋ 添加活动' }).click();
  await page.getByLabel('名称').fill('自动化测试活动');
  await page.getByLabel('纬度 lat').fill('31.22');
  await page.getByLabel('经度 lng').fill('121.48');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.save-state:has-text("已保存")', { timeout: 10_000 });
  const added = await firstDay.locator('.activity-name', { hasText: '自动化测试活动' }).count();
  check('新增活动落入清单', added === 1);

  // 10. 刷新后编辑全部持久化（服务端为准）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.day-section', { timeout: 10_000 });
  const persistedName = await page.locator('.activity-name', { hasText: '自动化测试活动' }).count();
  check('刷新后新增活动持久化', persistedName === 1, `added=${persistedName}`);

  // 11. 移动端视口：行程/地图两页签切换 + 地图 invalidateSize（复用同 context 保留登录态）
  const mob = await page.context().newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(page.url(), { waitUntil: 'networkidle' });
  await mob.waitForSelector('.editor-mobile-tabs', { timeout: 10_000 });
  await mob.screenshot({ path: `${SHOTS}/04-mobile-list.png` });
  await mob.locator('.mobile-tab', { hasText: '地图' }).click();
  await mob.waitForSelector('.leaflet-tile-loaded', { timeout: 20_000 }).catch(() => {});
  await mob.waitForTimeout(1500);
  const mobMarkers = await mob.locator('.marker-pin').count();
  const mobMarkerInView = await mob.locator('.marker-pin').first().isVisible();
  check('移动端地图页签渲染标记', mobMarkers >= 11, `markers=${mobMarkers}`);
  check('移动端切页签后标记位于视口内（invalidateSize+refit）', mobMarkerInView);
  await mob.screenshot({ path: `${SHOTS}/05-mobile-map.png` });
  const mobileTabs = await mob.locator('.mobile-tab').allInnerTexts();
  check('移动端仅保留行程与地图页签', mobileTabs.join(',') === '行程,地图', mobileTabs.join(','));
  await mob.close();

  // 12. 行程列表回访 + 设置弹窗分级
  await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle' });
  const cardCount = await page.locator('.trip-card').count();
  check('行程列表显示历史记录', cardCount >= 1, `cards=${cardCount}`);
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForSelector('.settings-plain');
  const advancedHidden = await page.locator('.settings-advanced input').first().isVisible().catch(() => false);
  const quotaVisible = (await page.locator('.settings-plain').innerText()).includes('今日生成额度');
  check('设置弹窗：普通视图含配额、高级选项默认折叠', quotaVisible && !advancedHidden, `quota=${quotaVisible}, advVisible=${advancedHidden}`);
  await page.screenshot({ path: `${SHOTS}/07-settings.png` });
} catch (err) {
  check('脚本执行中断', false, String(err).slice(0, 300));
} finally {
  await browser.close();
}

console.log('\n===== M1 浏览器验收结果 =====');
for (const r of results) console.log(r);
console.log(`===== ${results.length - failed}/${results.length} 通过 =====`);
process.exit(failed ? 1 : 0);
