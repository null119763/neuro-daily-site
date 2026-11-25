import { expect, test } from "@playwright/test";
import { sendMessage, signUp, waitForAnswer } from "./helpers";

const sizes = [
  { name: "phone", width: 360, height: 760 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const size of sizes) {
  test(`layout has no horizontal overflow at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/login");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await signUp(page);
    await sendMessage(page, "Длинное сообщение ".repeat(20) + "https://example.com/" + "x".repeat(120));
    await waitForAnswer(page);
    for (const path of ["", "/projects", "/memory", "/settings", "/chats"]) {
      if (path) await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `overflow on ${path || "chat"}`).toBeLessThanOrEqual(0);
    }
    const mobile = size.width < 1024;
    await page.goto("/");
    if (mobile) {
      await expect(page.getByRole("navigation", { name: "Bottom" })).toBeVisible();
      await page.getByRole("button", { name: "Меню" }).click();
      const drawer = page.getByRole("dialog", { name: "Меню" });
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    } else {
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Bottom" })).toBeHidden();
    }
    await page.screenshot({ path: `test-results/screens/${size.name}-home.png` });
  });
}

test("primary actions are reachable by keyboard", async ({ page }) => {
  await signUp(page);
  await page.getByTestId("composer").focus();
  await page.keyboard.type("Через клавиатуру");
  await page.keyboard.press("Enter");
  await waitForAnswer(page);
  await expect(page.getByTestId("msg-user")).toContainText("Через клавиатуру");
});
