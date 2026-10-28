import { test, expect, type Page } from "@playwright/test";
const email = process.env.BOOTSTRAP_EMAIL!,
  password = process.env.BOOTSTRAP_PASSWORD!;
async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "公司入口01", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/session") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "登录工作台" }).click();
  await (await responsePromise).finished();
  await expect
    .poll(async () => (await page.context().cookies()).map((c) => c.name))
    .toContain("session");
  await expect(page.getByRole("heading", { name: "经营工作台" })).toBeVisible();
}
async function navigate(page: Page, label: string) {
  const nav = page.getByRole("navigation", { name: "功能导航" });
  const target = nav.getByRole("button", { name: label, exact: true });
  if (!(await target.isVisible()))
    await nav.getByRole("textbox", { name: "找功能" }).fill(label);
  await target.click();
}
test("桌面两条获客链：活动、采集、核实、客户、公共留资持久保存", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await navigate(page, "展会与推广");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("活动名称").fill("虚构 E2E 展会");
  await page.getByLabel("活动类型").selectOption("exhibition");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.locator("td").getByText("虚构 E2E 展会", { exact: true }),
  ).toBeVisible();
  await navigate(page, "线索处理");
  await page.getByRole("button", { name: "现场采集", exact: true }).click();
  await page.getByLabel("来源活动").selectOption({ label: "虚构 E2E 展会" });
  await page.getByLabel("客户公司").fill("虚构 E2E 进口商");
  await page.getByText("补充联系人、国家与联系许可", { exact: true }).click();
  await page.getByLabel("联系人", { exact: true }).fill("Fictional Buyer");
  await page.getByLabel("邮箱", { exact: true }).fill("browser@example.com");
  await page
    .getByLabel("会谈 / 原始需求")
    .fill("Interested in filters. 请先提供目录，进口能力待核实。");
  await page.getByLabel("联系许可").selectOption("unknown");
  await page.getByRole("button", { name: "提交到服务器" }).click();
  await expect(
    page.locator("td").getByText("虚构 E2E 进口商", { exact: true }),
  ).toBeVisible();
  await page
    .locator("td")
    .getByText("虚构 E2E 进口商", { exact: true })
    .click();
  await page.getByRole("button", { name: "确认归属并转客户" }).click();
  await page.getByLabel("负责人").selectOption({ label: "负责人" });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "打开客户档案" }).click();
  await expect(
    page.getByRole("heading", { name: "联系人与许可" }),
  ).toBeVisible();
  await page.reload();
  await navigate(page, "客户资产");
  await expect(
    page.locator("td").getByText("虚构 E2E 进口商", { exact: true }),
  ).toBeVisible();
  await navigate(page, "展会与推广");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("活动名称").fill("虚构 E2E 线上");
  await page.getByLabel("活动类型").selectOption("online");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator("td").getByText("虚构 E2E 线上", { exact: true }).click();
  const [publicPage] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "打开英文留资表单" }).click(),
  ]);
  await publicPage
    .getByLabel("Company", { exact: true })
    .fill("虚构 E2E 线上买家");
  await publicPage.getByLabel("Business email").fill("online@example.com");
  await publicPage
    .getByLabel("Your enquiry")
    .fill("Please send the catalogue.");
  await publicPage.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(
    publicPage.getByRole("heading", { name: "Thank you." }),
  ).toBeVisible();
  await navigate(page, "线索处理");
  await expect(
    page.locator("td").getByText("虚构 E2E 线上买家", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
});
test("手机弱网：文字草稿明确未上传，恢复后提交；导航不溢出", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "打开导航" }).click();
  await navigate(page, "线索处理");
  await page.getByRole("button", { name: "现场采集", exact: true }).click();
  await page.getByLabel("来源活动").selectOption({ label: "虚构 E2E 展会" });
  await page.getByLabel("客户公司").fill("虚构弱网采集");
  await page.getByLabel("邮箱", { exact: true }).fill("offline@example.com");
  await page.getByLabel("会谈 / 原始需求").fill("离线文字保留，未上传。");
  await page.getByText("补充联系人、国家与联系许可", { exact: true }).click();
  await page.getByLabel("联系许可").selectOption("unknown");
  await context.setOffline(true);
  await page.getByRole("button", { name: "提交到服务器" }).click();
  await expect(page.getByText(/未上传成功，已保留本机文字草稿/)).toBeVisible();
  await page.getByRole("button", { name: "保留未上传草稿" }).click();
  await context.setOffline(false);
  await page.getByRole("button", { name: "现场采集", exact: true }).click();
  await expect(page.getByLabel("客户公司")).toHaveValue("虚构弱网采集");
  await page.getByRole("button", { name: "提交到服务器" }).click();
  await expect(
    page.locator("td").getByText("虚构弱网采集", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("采购报价到订单：真实数据库计算、界面审批与确认订单", async ({ page }) => {
  await login(page);
  const sr = await page.request.get("/api/v1/session");
  expect(sr.status(), await sr.text()).toBe(200);
  const session = (await sr.json()).data;
  const entity = session.entities[0].id;
  const post = async (url: string, data: any) => {
    const r = await page.request.post("/api/v1/" + url, {
      headers: { "X-Entity-Id": entity },
      data,
    });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).data;
  };
  const source = await post("sources", {
    name: "合成客户确认与货源证据",
    kind: "document",
    body: "Synthetic test: OE TEST-1234, 100 pieces. CNY72 cost, 1USD=7.2CNY, confirmed fitment. Customer confirms independent purchase.",
  });
  const activity = await post("activities", {
    name: "虚构交易链来源",
    type: "exhibition",
  });
  const lead = await post("leads", {
    activity_id: activity.id,
    event_id: "commercial-browser",
    company: "虚构交易链买家",
    email: "trade@example.com",
    notes: "合成采购需求",
  });
  const converted = await post(`leads/${lead.id}/convert`, {});
  const product = await post("products", {
    sku: "BROWSER-FILTER",
    name: "合成交易滤芯",
    category: "filter",
    oe: "TEST-1234",
    fitment_status: "confirmed",
    source_id: source.id,
  });
  const rfq = await post("rfqs", {
    account_id: converted.account_id,
    source_id: source.id,
    title: "虚构100件滤芯采购",
    destination: "Mombasa",
    lines: [
      {
        oe: "TEST-1234",
        description: "Filter",
        quantity: "100",
        unit: "piece",
      },
    ],
  });
  const rfqData = (
    await (
      await page.request.get("/api/v1/rfqs/" + rfq.id, {
        headers: { "X-Entity-Id": entity },
      })
    ).json()
  ).data;
  const line = rfqData.lines[0];
  await post(`rfqs/${rfq.id}/match`, {
    line_id: line.id,
    product_id: product.id,
  });
  const supplier = await post("suppliers", {
    name: "虚构浏览器货源",
    email: "source@example.com",
    evidence_id: source.id,
  });
  const purchase = await post("purchase-rfqs", {
    rfq_id: rfq.id,
    name: "浏览器采购任务",
  });
  const offer = await post(`purchase-rfqs/${purchase.id}/responses`, {
    rfq_line_id: line.id,
    supplier_id: supplier.id,
    product_id: product.id,
    source_id: source.id,
    price: "72",
    currency: "CNY",
    pack_qty: "1",
    unit: "piece",
    quality: "Q1",
    fee_scope: "包装已含",
    moq: "1",
    valid_until: "2035-01-01T00:00:00Z",
  });
  await post(`supplier-responses/${offer.id}/select`, {
    reason: "合成质量与交期确认",
  });
  await navigate(page, "报价与审批");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("客户采购需求").selectOption(rfq.id);
  await page.getByLabel("收件联系人").selectOption(converted.contact_id);
  await page.getByLabel("报价币种").fill("USD");
  await page.getByLabel("贸易条款", { exact: true }).fill("FOB");
  await page.getByLabel("条款地点").fill("Guangzhou");
  await page.getByLabel("有效至", { exact: true }).fill("2035-01-01T00:00");
  await page.getByLabel("付款条件").fill("合成测试预付款条件");
  await page.getByLabel("供货方案").selectOption(offer.id);
  await page.getByLabel("目标毛利率").fill("0.2");
  await page.getByLabel("汇率数值").fill("7.2");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/quotes") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "计算并保存报价草稿" }).click();
  const revision = (await (await saved).json()).data;
  expect(revision.amount).toBe("1250.000000");
  await page
    .locator("td")
    .getByText(revision.quote_id, { exact: true })
    .click();
  await expect(page.getByText(/1250.000000 USD/)).toBeVisible();
  await page.getByRole("button", { name: "审核批准（不发送）" }).click();
  await page
    .getByLabel("审批理由与已核对条件")
    .fill("来源、适配、毛利、条款均按合成案例核对");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已批准", { exact: true })).toBeVisible();
  await navigate(page, "订单与回款");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("已批准报价").selectOption(revision.quote_id);
  await page.getByLabel("原件 / 依据").selectOption(source.id);
  await page.getByLabel("客户独立采购编号").fill("BROWSER-INDEPENDENT-PO");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/commercial.png",
    fullPage: true,
  });
});

test("少填资料采集：折叠菜单、功能搜索、粘贴截图和原文持久保存", async ({
  page,
}) => {
  await login(page);
  const nav = page.getByRole("navigation", { name: "功能导航" });
  await expect(
    nav.getByRole("button", { name: "团队与权限", exact: true }),
  ).not.toBeVisible();
  await nav.getByRole("textbox", { name: "找功能" }).fill("员工");
  await nav.getByRole("button", { name: "团队与权限", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "团队与权限", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "经营工作台", exact: true }).click();
  await page.getByRole("button", { name: /先收集资料/ }).click();
  await expect(page.getByRole("heading", { name: "先收集资料" })).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX8sAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    data.items.add(
      new File([bytes], "合成测试截图.png", { type: "image/png" }),
    );
    document
      .querySelector(".collection-modal")!
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
  });
  await expect(page.getByAltText("待保存资料预览")).toBeVisible();
  const upload = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/files") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存到资料箱", exact: true }).click();
  const uploaded = await (await upload).json();
  expect(uploaded.data.storage_key).toBeTruthy();
  await expect(
    page.locator("td").getByText("合成测试截图.png", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收集资料", exact: true }).click();
  await page.getByRole("button", { name: "粘贴原文", exact: true }).click();
  const original = "合成测试客户原话：先留住需求，尚未核实公司和联系方式。";
  await page.getByRole("textbox", { name: "采集原文" }).fill(original);
  await page.getByRole("button", { name: "保存到资料箱", exact: true }).click();
  await expect(
    page.locator("td").getByText(original.slice(0, 40), { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation", { name: "功能导航" })
    .getByRole("button", { name: "采集资料箱", exact: true })
    .click();
  await page
    .locator("td")
    .getByText(original.slice(0, 40), { exact: true })
    .click();
  await expect(
    page.locator("article").getByText(original, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/collection-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("navigation", { name: "功能导航" })
    .getByRole("button", { name: "采集资料箱", exact: true })
    .click();
  await page.getByRole("button", { name: "收集资料", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "手机拍照", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("拍摄资料")).toHaveAttribute(
    "capture",
    "environment",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/collection-mobile.png",
    fullPage: true,
  });
});

test("首界面：九个留空公司入口、个人家庭入口、公司登录与手机布局", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "选择你的公司" }),
  ).toBeVisible();
  await expect(page.locator(".company-card")).toHaveCount(9);
  await expect(page.locator(".company-name").first()).toHaveText("");
  await page.screenshot({
    path: "test-results/company-portal-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "公司入口02", exact: true }).click();
  await expect(page.getByText("公司入口 02", { exact: true })).toBeVisible();
  await page.getByLabel("用户名", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("账号不属于此公司");
  await page.getByRole("link", { name: "返回公司选择" }).click();
  await page.getByRole("button", { name: /个人修炼＋家庭修炼/ }).click();
  await expect(
    page.getByRole("heading", { name: "个人修炼＋家庭修炼" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/company-portal-mobile.png",
    fullPage: true,
  });
});
