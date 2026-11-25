import { expect, test } from "@playwright/test";
import { sendMessage, signUp, waitForAnswer } from "./helpers";

test("memory: proposal from chat needs confirmation, can be edited and deleted", async ({ page }) => {
  await signUp(page);
  await sendMessage(page, "Запомни, что я работаю дизайнером");
  await expect(page.getByTestId("memory-proposal")).toContainText("я работаю дизайнером");
  await waitForAnswer(page);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("memory-proposal")).toContainText("Сохранено в памяти");

  await page.goto("/memory");
  await expect(page.getByTestId("memory-item")).toHaveCount(1);
  await page.getByTestId("memory-input").fill("Люблю зелёный чай");
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await expect(page.getByTestId("memory-item")).toHaveCount(2);

  await page.getByTestId("memory-item").filter({ hasText: "зелёный чай" }).getByRole("button", { name: "Изменить" }).click();
  await page.getByRole("textbox", { name: "Изменить" }).fill("Люблю улун");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Люблю улун")).toBeVisible();

  await page.getByTestId("memory-item").filter({ hasText: "улун" }).getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByTestId("memory-item")).toHaveCount(1);

  await page.getByRole("switch").uncheck();
  await page.reload();
  await expect(page.getByRole("switch")).not.toBeChecked();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Удалить всю память" }).click();
  await expect(page.getByTestId("memory-item")).toHaveCount(0);
});

test("projects: create with instructions and chat inside the project", async ({ page }) => {
  await signUp(page);
  await page.goto("/projects");
  await page.getByTestId("new-project").click();
  await page.getByLabel("Название").fill("Мобильная игра");
  await page.getByLabel("Инструкции для Auden в этом проекте").fill("Жанр — стратегия");
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByTestId("project-new-chat").click();
  await expect(page.getByText("Проекты: Мобильная игра")).toBeVisible();
  await sendMessage(page, "Идеи механик");
  await waitForAnswer(page);
  await page.getByRole("tab", { name: "Проекты" }).click();
  await expect(page.getByTestId("conversation-list").getByText("Идеи механик")).toBeVisible();
  await expect(page.getByTestId("conversation-list").getByText("Мобильная игра")).toBeVisible();

  await page.goto("/projects");
  await page.getByTestId("project-row").first().click();
  await expect(page.getByRole("link", { name: /Идеи механик/ })).toBeVisible();
});

test("settings: theme and language persist", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Тёмная" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(21, 21, 21)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Usage today")).toBeVisible();
  await expect(page.getByTestId("model-routes")).toContainText("Mock (demo)");
});

test("account export and deletion", async ({ page }) => {
  const email = await signUp(page);
  await sendMessage(page, "hello");
  await waitForAnswer(page);
  const exp = await page.request.get("/api/account/export");
  const data = await exp.json();
  expect(data.profile.email).toBe(email);
  expect(data.conversations).toHaveLength(1);

  await page.goto("/settings");
  page.once("dialog", (d) => d.accept("DELETE"));
  await page.getByRole("button", { name: "Удалить аккаунт" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.getByTestId("auth-submit").click();
  await expect(page.locator(".alert")).toContainText("Неверный email или пароль");
});
