import { test, expect } from "@playwright/test";
/**
 * End-to-end acceptance test (§65). Drives the full lending lifecycle through
 * the real UI against the real API: create customer -> application -> risk +
 * limit + pricing -> approve -> loan + schedule -> disburse -> payment ->
 * customer 360 -> audit trail.
 */
const PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";
const unique = Date.now().toString().slice(-8);
async function login(page, email) {
    await page.goto("/login");
    await page.getByLabel("電子郵件").fill(email);
    await page.getByLabel("密碼").fill(PASSWORD);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
}
test.describe("Lending operations", () => {
    test("dashboard shows portfolio KPIs computed from real records", async ({ page }) => {
        await login(page, "admin@lending.local");
        await expect(page.getByRole("heading", { name: "放款營運總覽" })).toBeVisible();
        await expect(page.getByText("放款本金餘額")).toBeVisible();
        await expect(page.getByText("PAR30")).toBeVisible();
        // KPIs must be real currency values, not placeholders.
        const outstanding = page.locator("text=放款本金餘額").locator("..").locator(".tabular");
        await expect(outstanding).toContainText("$");
    });
    test("full lifecycle: customer to disbursed loan to payment", async ({ page }) => {
        await login(page, "admin@lending.local");
        // --- Create a customer -------------------------------------------------
        await page.goto("/customers/new");
        const customerName = `E2E測試客戶${unique}`;
        await page.getByLabel("姓名 *").fill(customerName);
        await page.getByLabel("身分證字號 *").fill(`E${unique}9`);
        await page.getByLabel("出生日期 *").fill("1990-06-15");
        await page.getByLabel("手機 *").fill("0912000111");
        await page.getByLabel("月收入").fill("80000");
        await page.getByRole("button", { name: "建立客戶" }).click();
        await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
        await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
        // --- Originate a loan through the wizard -------------------------------
        await page.goto("/loans/new");
        await page.getByPlaceholder("搜尋客戶姓名、編號或電話").fill(customerName);
        await page.getByRole("button", { name: new RegExp(customerName) }).click();
        // Step 2: application details
        await expect(page.getByText("放款申請內容")).toBeVisible();
        await page.locator("select").first().selectOption({ index: 1 });
        await page.getByLabel("申請金額 *").fill("50000");
        await page.getByLabel("期數 *").fill("3");
        await page.getByLabel("月收入").fill("80000");
        await page.getByRole("button", { name: "送出並執行風控" }).click();
        // Step 3: risk + limit, produced by the engines
        await expect(page.getByRole("heading", { name: "風險評估結果" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("heading", { name: "放款額度" })).toBeVisible();
        await page.getByRole("button", { name: "查看放款條件" }).click();
        // Step 4: priced offer
        await expect(page.getByRole("heading", { name: "放款條件" })).toBeVisible();
        await expect(page.getByText("總應還")).toBeVisible();
        await page.getByRole("button", { name: "下一步：審核" }).click();
        // Step 5: approve
        await page.getByRole("button", { name: "核准此申請" }).click();
        // Step 6: create loan + snapshot + schedule
        await page.getByRole("button", { name: "建立放款與還款期程" }).click();
        // Step 7: schedule is shown and the loan can be disbursed
        await expect(page.getByRole("heading", { name: /還款期程/ })).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: "確認撥款" }).click();
        await expect(page).toHaveURL(/\/loans\/[0-9a-f-]{36}$/);
        const loanUrl = page.url();
        // --- The disbursed loan is live with a real balance --------------------
        await expect(page.getByText("放款中").first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText("剩餘本金")).toBeVisible();
        // Snapshot locks the terms
        await expect(page.getByText(/放款條件快照/)).toBeVisible();
        // Schedule tab shows the installments the engine produced
        await page.getByRole("button", { name: "還款期程" }).click();
        await expect(page.locator("tbody tr")).toHaveCount(3);
        // Balance tab reconciles from the ledger
        await page.getByRole("button", { name: "餘額" }).click();
        await expect(page.getByText("由金流事件帳本重新計算")).toBeVisible();
        // Money events are recorded. Scoped to main: the desktop sidebar also
        // contains a "待撥款" link, which is present but hidden on mobile.
        await page.getByRole("button", { name: "金流事件" }).click();
        const events = page.locator("main");
        await expect(events.getByText("撥款", { exact: true }).first()).toBeVisible();
        await expect(events.getByText("計息", { exact: true }).first()).toBeVisible();
        // --- Take a payment ----------------------------------------------------
        await page.goto(`/payments/new?loanId=${loanUrl.split("/").pop()}`);
        await page.getByLabel("收款金額 *").fill("1250");
        await expect(page.getByText("本次分配")).toBeVisible({ timeout: 15_000 });
        await page.getByRole("button", { name: "確認收款" }).click();
        await expect(page).toHaveURL(/\/loans\/[0-9a-f-]{36}$/);
        await page.getByRole("button", { name: "收款紀錄" }).click();
        await expect(page.locator("tbody tr")).toHaveCount(1);
        // --- Customer 360 reflects the whole relationship ----------------------
        await page.goto("/customers");
        await page.getByPlaceholder(/搜尋姓名/).fill(customerName);
        await page.getByRole("button", { name: "搜尋" }).click();
        await page.getByRole("link", { name: /CUS-/ }).first().click();
        await expect(page.getByText("目前總欠款")).toBeVisible();
        await page.getByRole("button", { name: "放款" }).click();
        await expect(page.getByRole("link", { name: /LN-/ })).toBeVisible();
    });
    test("audit trail records the lifecycle", async ({ page }) => {
        await login(page, "admin@lending.local");
        await page.goto("/settings/audit-logs");
        await expect(page.getByRole("heading", { name: "操作紀錄" })).toBeVisible();
        await expect(page.locator("main").getByText("撥款", { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/稽核紀錄僅供追加/)).toBeVisible();
    });
    test("overdue loans and collection cases are visible", async ({ page }) => {
        await login(page, "admin@lending.local");
        await page.goto("/loans/overdue");
        await expect(page.getByRole("heading", { name: "逾期管理" })).toBeVisible();
        await page.goto("/collections");
        await expect(page.getByRole("heading", { name: "催收" })).toBeVisible();
        await expect(page.getByText("催收案件")).toBeVisible();
    });
    test("product repricing is versioned, not edited in place", async ({ page }) => {
        await login(page, "admin@lending.local");
        await page.goto("/products");
        await expect(page.getByText(/修改利率或費用會建立新版本/)).toBeVisible();
        await expect(page.getByRole("link", { name: "標準小額信貸" }).first()).toBeVisible();
    });
});
test.describe("Permissions", () => {
    test("a loan officer cannot see user management", async ({ page }) => {
        await login(page, "officer@lending.local");
        // The nav hides it...
        await expect(page.getByRole("link", { name: "使用者" })).toHaveCount(0);
    });
    test("an auditor cannot create a customer", async ({ page }) => {
        await login(page, "auditor@lending.local");
        await page.goto("/customers");
        await expect(page.getByRole("link", { name: "新增客戶" })).toHaveCount(0);
    });
});
