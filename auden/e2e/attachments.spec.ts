import { expect, test } from "@playwright/test";
import { makePdf } from "../tests/fixtures";
import { sendMessage, signUp, waitForAnswer } from "./helpers";

test("attach a PDF and a text file, send, and see them after reload", async ({ page }) => {
  await signUp(page);
  await page.getByTestId("file-input").setInputFiles([
    { name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf(["Codename Aurora"])) },
    { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Заметки\nсрок — март") },
  ]);
  const chips = page.getByTestId("attachment-chips");
  await expect(chips.getByText("plan.pdf")).toBeVisible();
  await expect(chips.getByText("notes.md")).toBeVisible();
  await expect(page.locator(".spin")).toHaveCount(0);

  // Remove one before sending
  await page.getByRole("button", { name: "Убрать файл: notes.md" }).click();
  await expect(chips.getByText("notes.md")).toHaveCount(0);

  await sendMessage(page, "Что в документе?");
  await waitForAnswer(page);
  await expect(page.getByTestId("msg-ai")).toContainText("Документы в контексте: plan.pdf");
  await expect(page.getByTestId("msg-user").getByText("plan.pdf")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("msg-user").getByText("plan.pdf")).toBeVisible();
});

test("unsupported files are rejected with a clear message", async ({ page }) => {
  await signUp(page);
  await page.getByTestId("file-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]) });
  await expect(page.locator(".alert")).toContainText("не поддерживается");
  await expect(page.getByTestId("attachment-chips")).toHaveCount(0);
  await sendMessage(page, "Без файла");
  await waitForAnswer(page);
});
