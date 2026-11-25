import { expect, test } from "@playwright/test";
import { sendMessage, signUp, waitForAnswer } from "./helpers";

test("thumbs up/down are saved and toggle", async ({ page }) => {
  await signUp(page);
  await sendMessage(page, "Оцени меня");
  await waitForAnswer(page);
  const up = page.getByTestId("msg-ai").getByRole("button", { name: "Хороший ответ" });
  const down = page.getByTestId("msg-ai").getByRole("button", { name: "Плохой ответ" });
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "true");
  await expect(up).toHaveAttribute("aria-pressed", "false");
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "false");
});

test("metrics page is visible to admins only", async ({ browser }) => {
  const userCtx = await browser.newContext();
  const user = await userCtx.newPage();
  await signUp(user, "Пользователь");
  await sendMessage(user, "Привет");
  await waitForAnswer(user);
  await user.getByTestId("msg-ai").getByRole("button", { name: "Хороший ответ" }).click();
  await expect(user.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Метрики" })).toHaveCount(0);
  await user.goto("/admin");
  await expect(user.getByText("Страница доступна только администраторам.")).toBeVisible();
  expect((await user.request.get("/api/admin/metrics")).status()).toBe(403);

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signUp(admin, "Админ", "admin@e2e.test");
  await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Метрики" }).click();
  await expect(admin).toHaveURL(/\/admin$/);
  await expect(admin.getByTestId("kpis")).toContainText("Запросы");
  await expect(admin.getByTestId("by-model")).toContainText("Mock (demo)");
  await expect(admin.getByTestId("daily")).toBeVisible();
  await admin.getByRole("button", { name: "30 дн." }).click();
  await expect(admin.getByText(/—\s\d{4}-\d{2}-\d{2}\./)).toBeVisible();
  await admin.screenshot({ path: "test-results/screens/metrics.png", fullPage: true });
  await userCtx.close();
  await adminCtx.close();
});
