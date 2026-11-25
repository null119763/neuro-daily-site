import { expect, test } from "@playwright/test";
import { sendMessage, signUp, uniqueEmail, waitForAnswer } from "./helpers";

test("sign up, chat with streaming, history survives reload", async ({ page }) => {
  await signUp(page, "Лев");
  await expect(page.getByRole("heading", { name: /Здравствуйте, Лев/ })).toBeVisible();
  await sendMessage(page, "Помоги спланировать разработку игры");
  await expect(page.getByTestId("stop")).toBeVisible();
  await waitForAnswer(page);
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("model-label")).toContainText("Mock (demo)");
  await expect(page.getByText("Реальная модель не подключена").first()).toBeVisible();
  await expect(page.getByTestId("chat-title")).toHaveText("Помоги спланировать разработку игры");

  // Keyboard: Enter sends
  await page.getByTestId("composer").fill("Продолжай");
  await page.getByTestId("composer").press("Enter");
  await waitForAnswer(page, 2);

  await page.reload();
  await expect(page.getByTestId("msg-user")).toHaveCount(2);
  await expect(page.getByTestId("msg-ai")).toHaveCount(2);
  await expect(page.getByTestId("conversation-list").getByText("Помоги спланировать разработку игры")).toBeVisible();

  // New chat resets the view
  await page.getByTestId("new-chat").click();
  await expect(page.getByRole("heading", { name: /Здравствуйте/ })).toBeVisible();
  await expect(page.getByTestId("msg-user")).toHaveCount(0);
});

test("stop button cancels streaming and keeps partial text", async ({ page }) => {
  await signUp(page);
  await sendMessage(page, "/mock-slow длинный ответ");
  await expect(page.getByTestId("msg-ai").locator(".prose")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("stop").click();
  await expect(page.getByText("Ответ остановлен.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("send")).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText("Ответ остановлен.")).toBeVisible();
});

test("provider errors are shown clearly; retry does not duplicate the message", async ({ page }) => {
  await signUp(page);
  await sendMessage(page, "/mock-error unavailable");
  await expect(page.locator(".alert")).toContainText("временно недоступен");
  await page.locator(".alert").getByRole("button", { name: "Повторить" }).click();
  await expect(page.locator(".alert")).toContainText("временно недоступен");
  await page.reload();
  await expect(page.getByTestId("msg-user")).toHaveCount(1);
});

test("regenerate replaces the answer instead of repeating the question", async ({ page }) => {
  await signUp(page);
  await sendMessage(page, "Первый вопрос");
  await waitForAnswer(page);
  await page.getByTestId("msg-ai").getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByTestId("send")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("msg-user")).toHaveCount(1);
  await expect(page.getByTestId("msg-ai")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("msg-user")).toHaveCount(1);
  await expect(page.getByTestId("msg-ai")).toHaveCount(1);
});

test("rename, favourite and delete a chat", async ({ page }) => {
  await signUp(page);
  await sendMessage(page, "Чат для удаления");
  await waitForAnswer(page);
  page.once("dialog", (d) => d.accept("Переименованный"));
  await page.getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Переименовать" }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("Переименованный");
  await page.getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "В избранное" }).click();
  await page.getByRole("tab", { name: "Избранные" }).click();
  await expect(page.getByTestId("conversation-list").getByText("Переименованный")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Удалить чат" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("tab", { name: "Все" }).click();
  await expect(page.getByTestId("conversation-list").getByText("Переименованный")).toHaveCount(0);
});

test("two accounts cannot see each other's chats", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await signUp(pa, "Алиса", uniqueEmail("alice"));
  await sendMessage(pa, "Секрет Алисы");
  await waitForAnswer(pa);
  const url = pa.url();

  await signUp(pb, "Боб", uniqueEmail("bob"));
  await expect(pb.getByTestId("conversation-list").getByText("Секрет Алисы")).toHaveCount(0);
  await pb.goto(url);
  await expect(pb.getByText("Чат не найден или был удалён.")).toBeVisible();
  await pb.getByPlaceholder("Поиск в чатах…").fill("Секрет");
  await expect(pb.getByText("Ничего не найдено")).toBeVisible();
  await a.close();
  await b.close();
});

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.get("/api/conversations");
  expect(res.status()).toBe(401);
});
