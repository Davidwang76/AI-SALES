import { test, expect } from "@playwright/test";

test("门户 V1.1：桌面 2:1 分栏与两列公司卡片，手机上下排列", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".company-card")).toHaveCount(9);
  await expect(page.getByRole("heading", { name: "公司与服务" })).toBeVisible();
  const links = page.getByRole("navigation", { name: "商务服务入口" });
  await expect(links.getByRole("link")).toHaveCount(3);
  for (const [name, path] of [
    ["服务介绍", "services"],
    ["产品介绍", "products"],
    ["商务报价", "quotes"],
  ]) {
    await expect(
      links.getByRole("link", { name: new RegExp(name) }),
    ).toHaveAttribute("href", `/business/${path}`);
  }
  const left = (await page
    .getByRole("region", { name: "公司与服务" })
    .boundingBox())!;
  const right = (await page
    .getByRole("complementary", { name: "商务服务中心" })
    .boundingBox())!;
  expect(left.width / right.width).toBeCloseTo(2, 1);
  expect(right.x).toBeGreaterThan(left.x + left.width);
  const cards = page.locator(".company-card");
  const boxes = await Promise.all(
    [0, 1, 2].map((i) => cards.nth(i).boundingBox()),
  );
  expect(boxes[0]!.y).toBe(boxes[1]!.y);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
  await page.screenshot({
    path: "test-results/business-home-desktop.png",
    fullPage: true,
  });
  for (const width of [900, 701, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const companyArea = (await page
      .locator(".portal-companies")
      .boundingBox())!;
    const businessArea = (await page
      .locator(".business-center")
      .boundingBox())!;
    expect(businessArea.y).toBeGreaterThanOrEqual(
      companyArea.y + companyArea.height,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/business-home-mobile.png",
    fullPage: true,
  });
});

test("公共服务与产品可匿名浏览、展开详情、直接访问及刷新", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/business/services");
  await expect(
    page.getByRole("heading", { name: "服务介绍", exact: true }),
  ).toBeVisible();
  for (const title of [
    "企业经营系统搭建",
    "AI+企业赋能",
    "企业培训及咨询",
    "案例介绍",
    "服务咨询",
  ]) {
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("link", { name: "咨询此项服务" }).first().click();
  await expect(page).toHaveURL(/#consultation$/);
  await page
    .getByRole("navigation", { name: "商务服务导航" })
    .getByRole("link", { name: "产品介绍" })
    .click();
  await expect(
    page.getByRole("heading", { name: "产品介绍", exact: true }),
  ).toBeVisible();
  await page.getByText("适用企业与交付范围", { exact: true }).click();
  await expect(page.getByText(/具体服务内容、参与人员/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "软件产品", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "产品目录整理中" }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/session")).status()).toBe(401);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "返回首页" }).click();
  await expect(page.locator(".company-card")).toHaveCount(9);
  expect(errors).toEqual([]);
});

test("商务报价复用公司登录：拒绝错误公司、独立全宽页面、刷新与退出鉴权", async ({
  page,
}) => {
  await page.goto("/business/quotes");
  await expect(
    page.getByRole("heading", { name: "选择报价所属公司" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^02 · LTMC/ }).click();
  await expect(page).toHaveURL(/\/company\/02\?tool=business-quotes$/);
  await page
    .getByLabel("用户名", { exact: true })
    .fill(process.env.BOOTSTRAP_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.BOOTSTRAP_PASSWORD!);
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("账号不属于此公司");
  await expect(
    page.getByRole("heading", { name: "商务报价工作台" }),
  ).toHaveCount(0);

  await page.goto("/business/quotes");
  await page.getByRole("link", { name: /^01 · SRR/ }).click();
  await page
    .getByLabel("用户名", { exact: true })
    .fill(process.env.BOOTSTRAP_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.BOOTSTRAP_PASSWORD!);
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "商务报价工作台" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "当前尚不能在此创建、审批或发送商务报价。原公司业务中的报价与审批继续保留。",
    ),
  ).toBeVisible();
  expect((await page.locator("main").boundingBox())!.width).toBeGreaterThan(
    1000,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "商务报价工作台" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/business-quotes-authenticated.png",
    fullPage: true,
  });

  await page.goto("/company/02?tool=business-quotes");
  await expect(
    page.getByRole("heading", { name: "登录经营工作台" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "商务报价工作台" }),
  ).toHaveCount(0);
  await page.goto("/company/01?tool=business-quotes");
  await expect(
    page.getByRole("heading", { name: "商务报价工作台" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登录经营工作台" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "商务报价工作台" }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/v1/quotes")).status()).toBe(401);
});

test("公司列表不截断，三位数入口可路由（隔离的未来接口数据，不修改数据库）", async ({
  page,
}) => {
  const companies = [...Array.from({ length: 12 }, (_, i) => i + 1), 100].map(
    (slot) => ({
      slot,
      display_name: `测试公司${slot}`,
      subtitle: "用于验证新增公司的长名称与业务说明不会被裁切",
      entity_id: null,
    }),
  );
  await page.route("**/api/v1/public/company-portals", (route) =>
    route.fulfill({ json: { data: companies } }),
  );
  await page.goto("/");
  await expect(page.locator(".company-card")).toHaveCount(13);
  await page.getByRole("button", { name: /^公司入口100/ }).click();
  await expect(page).toHaveURL(/\/company\/100$/);
  await expect(
    page.getByRole("heading", { name: "登录经营工作台" }),
  ).toBeVisible();
  await page.goto("/business/quotes");
  await expect(page.locator(".business-company-link")).toHaveCount(13);
  await page.getByRole("link", { name: /^100 · 测试公司100/ }).click();
  await expect(page).toHaveURL(/\/company\/100\?tool=business-quotes$/);
  await expect(
    page.getByRole("heading", { name: "登录经营工作台" }),
  ).toBeVisible();
});

test("公司接口失败时保留商务入口与公共介绍，报价选择可重试", async ({
  page,
}) => {
  await page.route("**/api/v1/public/company-portals", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "测试：公司列表暂时不可用" } },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "测试：公司列表暂时不可用",
  );
  await page
    .getByRole("navigation", { name: "商务服务入口" })
    .getByRole("link", { name: /服务介绍/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "企业经营系统搭建" }),
  ).toBeVisible();
  await page.goto("/business/quotes");
  await expect(page.getByRole("alert")).toContainText(
    "测试：公司列表暂时不可用",
  );
  await page.unroute("**/api/v1/public/company-portals");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator(".business-company-link")).toHaveCount(9);
});
