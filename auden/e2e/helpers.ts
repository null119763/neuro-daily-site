import { expect, type Page } from "@playwright/test";

let n = 0;
export function uniqueEmail(prefix = "user") {
  return `${prefix}-${Date.now()}-${n++}@e2e.test`;
}

export async function signUp(page: Page, name = "Тест", email = uniqueEmail()) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Создать аккаунт" }).first().click();
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.getByRole("checkbox").check();
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

export async function sendMessage(page: Page, text: string) {
  await page.getByTestId("composer").fill(text);
  await page.getByTestId("send").click();
}

export async function waitForAnswer(page: Page, count = 1) {
  await expect(page.getByTestId("model-label")).toHaveCount(count, { timeout: 15_000 });
}
